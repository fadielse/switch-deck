import { readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { forgetDevice, isTailscaleAddress, lanAddress, loadConfig, rememberDevice } from './config.js';
import { Throttle, newCode, newToken, publicId, sameSecret } from './pairing.js';
import { InputBridge } from './input.js';
import { Deck } from './deck.js';
import { runAction } from './actions.js';
import { toInputFrame } from './sanitize.js';
import { runSystemAction } from './system.js';
import { loadTls, serveCaAndRedirect } from './tls.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

const binary = process.env.DECKD_INPUT
  ?? join(here, '..', '..', 'deckd-input', '.build', 'release', 'deckd-input');

const deck = new Deck({
  onChange: (description) => {
    // Edited config reaches every connected tablet without a reconnect.
    const payload = JSON.stringify({ t: 'deck', deck: description });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }
});

const input = new InputBridge(binary, {
  onStatus: (frame) => {
    if (frame.trusted) return;
    console.error('\n!! deckd-input TIDAK punya izin Accessibility.');
    console.error('!! Tombol bakal kelihatan sukses tapi nggak ada yang kejadian.');
    console.error('!! Jalanin: make doctor\n');
  },
});
input.start();

// Regenerated every time the server starts, so a code left on a screen
// somewhere stops working once deckd is restarted.
const pairingCode = newCode();
const throttle = new Throttle();

// Under launchd there is no terminal to print to, so the code goes to a file
// that `make code` reads. Same 0600 as config.json — it is a credential until
// it is used, and this is the only way to see it once deckd starts at login.
// Written only after the port is actually held: a server that loses the bind
// race used to overwrite the file with a code that dies with it, which left
// `make code` reporting a code no listening server would accept.
const CODE_FILE = join(dirname(config.path), 'pairing-code');

function knownDevice(token) {
  return Object.keys(config.devices).some((known) => sameSecret(known, token));
}

function matchingToken(token) {
  return Object.keys(config.devices).find((known) => sameSecret(known, token)) ?? null;
}

function describeDevices(currentToken) {
  return Object.entries(config.devices).map(([token, info]) => ({
    id: publicId(token),
    name: info.name,
    pairedAt: info.pairedAt,
    current: token === currentToken
  }));
}

function broadcastDevices() {
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    client.send(JSON.stringify({ t: 'devices', devices: describeDevices(client.deckToken) }));
  }
}

const pagePath = join(here, '..', 'web', 'index.html');

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy();   // nothing legitimate is this big
    });
    req.on('end', () => resolve(body));
  });
}

const tls = loadTls(config.path);

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // The tablet loads its page from one host but must be able to pair with the
  // others, which is a cross-origin request. Opening this up is safe because
  // the code is the guard and it is throttled: a page that tried to guess would
  // get three attempts and then be made to wait, from a single address.
  if (url.pathname === '/pair' && req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600'
    });
    res.end();
    return;
  }

  if (url.pathname === '/pair' && req.method === 'POST') {
    const address = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const wait = throttle.retryAfter(address);
    if (wait > 0) {
      res.writeHead(429, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ retryAfter: Math.ceil(wait / 1000) }));
      return;
    }
    let code = '';
    try { code = JSON.parse(await readBody(req)).code; } catch { /* below */ }

    if (!sameSecret(code, pairingCode)) {
      const failures = throttle.fail(address);
      console.log(`[deckd] pairing gagal dari ${address} (percobaan ke-${failures})`);
      res.writeHead(401, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ error: 'kode salah' }));
      return;
    }

    throttle.succeed(address);
    const token = newToken();
    rememberDevice(config, token, address);
    console.log(`[deckd] device baru dipasangkan dari ${address}`);
    // Tell anyone already connected, or the settings list stays stale until
    // they happen to reconnect.
    broadcastDevices();
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ token, host: config.hostName }));
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, trusted: input.trusted }));
    return;
  }
  if (url.pathname === '/') {
    // Read per request, and forbid caching. Reading once at startup meant every
    // client tweak needed a server restart, and without no-store the tablet
    // happily kept serving the previous build back to itself — between them
    // that is a long time spent testing code that is not running.
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, must-revalidate',
    });
    res.end(readFileSync(pagePath));
    return;
  }
  res.writeHead(404).end('not found');
};

const server = tls ? createHttps(tls.options, handler) : createHttp(handler);

const wss = new WebSocketServer({ noServer: true });

deck.load();
deck.watch();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws' || !knownDevice(url.searchParams.get('t'))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  // Blueprint K2: mouse frames are tiny and frequent, so Nagle would batch them
  // into visible lag. Set from day one rather than as an F2 optimisation.
  socket.setNoDelay(true);
  const token = matchingToken(url.searchParams.get('t'));
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.deckToken = token;   // so this socket can be hung up when it is revoked
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  // Printed so the link itself can be measured with ping, independently of
  // anything in this process.
  const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const viaTailscale = isTailscaleAddress(peer);
  console.log(`[deckd] tablet nyambung dari ${peer}${viaTailscale ? ' (lewat Tailscale)' : ''}`);
  if (viaTailscale) {
    console.log(`[deckd] ! kalau tablet ada di jaringan yang sama, pakai http://${lanAddress()}:${port}/`);
    console.log('[deckd] ! Tailscale bisa merelai lewat server di negara lain — puluhan ms tiap paket');
  }
  ws.send(JSON.stringify({
    t: 'hello',
    host: config.hostName,
    // Told to the client so it can say so, rather than leaving the latency to
    // be blamed on the wifi.
    lanUrl: viaTailscale ? `http://${lanAddress()}:${port}/` : null,
    devices: describeDevices(ws.deckToken),
    trusted: input.trusted,
    refreshHz: input.refreshHz,
    deck: deck.describe(),
  }));

  ws.on('message', (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (frame.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', ts: frame.ts }));
      return;
    }

    // Trackpad and keyboard traffic: high rate, no ack. An ack per keystroke
    // would double the traffic for no benefit — the character appearing is the
    // feedback.
    if (frame.t === 'm' || frame.t === 's' || frame.t === 'b'
        || frame.t === 'k' || frame.t === 'txt' || frame.t === 'media') {
      const clean = toInputFrame(frame);
      if (clean) input.send(clean);
      return;
    }

    // Like macros: an id from a fixed table, never a command from the tablet.
    if (frame.t === 'sys') {
      const ok = runSystemAction(frame.id);
      ws.send(JSON.stringify(ok
        ? { t: 'ack', id: frame.id }
        : { t: 'err', id: frame.id, msg: 'aksi sistem tidak dikenal' }));
      return;
    }

    if (frame.t === 'revoke') {
      const dropped = forgetDevice(config, (token) => publicId(token) === frame.id);
      if (!dropped) {
        ws.send(JSON.stringify({ t: 'err', id: frame.id, msg: 'device tidak dikenal' }));
        return;
      }
      console.log(`[deckd] device dicabut: ${frame.id}`);
      // Hang up anything that device still has open, or it would keep working
      // until it happened to reconnect.
      for (const client of wss.clients) {
        if (client.deckToken === dropped) client.close(4001, 'revoked');
      }
      broadcastDevices();
      ws.send(JSON.stringify({ t: 'ack', id: frame.id }));
      return;
    }

    if (frame.t === 'macro') {
      const key = deck.find(frame.id);
      if (!key) {
        ws.send(JSON.stringify({ t: 'err', id: frame.id, msg: 'tombol tidak dikenal' }));
        return;
      }
      runAction(key.action, (f) => input.send(f))
        .then(() => ws.send(JSON.stringify({ t: 'ack', id: frame.id, trusted: input.trusted })))
        .catch((err) => {
          console.error('[deckd] action gagal:', frame.id, err.message);
          ws.send(JSON.stringify({ t: 'err', id: frame.id, msg: err.message }));
        });
      return;
    }

    ws.send(JSON.stringify({ t: 'err', msg: 'frame tidak dikenal', type: frame.t }));
  });

  ws.on('close', () => console.log('[deckd] tablet putus'));
});

const port = Number(process.env.PORT) || config.port;

server.listen(port, () => {
  try {
    writeFileSync(CODE_FILE, pairingCode + '\n', { mode: 0o600 });
  } catch (err) {
    console.error('[deckd] tidak bisa menulis kode pairing:', err.message);
  }
  const scheme = tls ? 'https' : 'http';
  const url = `${scheme}://${lanAddress()}:${port}/`;
  console.log(`\n  SwitchDeck — ${config.hostName}`);
  if (config.isNew) console.log(`  config baru dibuat di ${config.path}`);
  const total = deck.describe().pages.reduce((n, p) => n + p.keys.length, 0);
  console.log(`  deck: ${total} tombol dari ${deck.path}${deck.isNew ? ' (baru dibuat)' : ''}`);
  if (tls) {
    serveCaAndRedirect({
      port: port + 1, httpsPort: port, caPath: tls.caPath, address: lanAddress()
    });
    console.log(`  HTTPS aktif. Sertifikat CA: http://${lanAddress()}:${port + 1}/ca.crt`);
  } else {
    console.log('  HTTP biasa — layar tablet bakal tidur sendiri (butuh HTTPS).');
    console.log('  Jalankan `make cert` lalu restart untuk mengaktifkan HTTPS.');
  }

  const paired = Object.keys(config.devices).length;
  console.log(`\n  Buka di tablet:  ${url}`);
  console.log(`  Kode pairing:    ${pairingCode}`);
  console.log(`\n  Kode ini ganti tiap server dinyalakan, dan cuma dipakai sekali —`);
  console.log('  setelah itu device dapat token sendiri dan tidak ditanya lagi.');
  console.log(`  Device yang sudah terpasang: ${paired}\n`);
});
