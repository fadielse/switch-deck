import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { lanAddress, loadConfig, rememberDevice } from './config.js';
import { Throttle, newCode, newToken, sameSecret } from './pairing.js';
import { InputBridge } from './input.js';
import { Deck } from './deck.js';
import { runAction } from './actions.js';
import { toInputFrame } from './sanitize.js';
import { runSystemAction } from './system.js';

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
const CODE_FILE = join(dirname(config.path), 'pairing-code');
try {
  writeFileSync(CODE_FILE, pairingCode + '\n', { mode: 0o600 });
} catch (err) {
  console.error('[deckd] tidak bisa menulis kode pairing:', err.message);
}

function knownDevice(token) {
  return Object.keys(config.devices).some((known) => sameSecret(known, token));
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/pair' && req.method === 'POST') {
    const address = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const wait = throttle.retryAfter(address);
    if (wait > 0) {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ retryAfter: Math.ceil(wait / 1000) }));
      return;
    }
    let code = '';
    try { code = JSON.parse(await readBody(req)).code; } catch { /* below */ }

    if (!sameSecret(code, pairingCode)) {
      const failures = throttle.fail(address);
      console.log(`[deckd] pairing gagal dari ${address} (percobaan ke-${failures})`);
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'kode salah' }));
      return;
    }

    throttle.succeed(address);
    const token = newToken();
    rememberDevice(config, token, address);
    console.log(`[deckd] device baru dipasangkan dari ${address}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ token }));
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
});

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
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  // Printed so the link itself can be measured with ping, independently of
  // anything in this process.
  const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  console.log(`[deckd] tablet nyambung dari ${peer}`);
  console.log(`[deckd] ukur jaringannya langsung:  ping -c 50 ${peer}`);
  ws.send(JSON.stringify({
    t: 'hello',
    host: config.hostName,
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
  const url = `http://${lanAddress()}:${port}/`;
  console.log(`\n  SwitchDeck — ${config.hostName}`);
  if (config.isNew) console.log(`  config baru dibuat di ${config.path}`);
  const total = deck.describe().pages.reduce((n, p) => n + p.keys.length, 0);
  console.log(`  deck: ${total} tombol dari ${deck.path}${deck.isNew ? ' (baru dibuat)' : ''}`);
  const paired = Object.keys(config.devices).length;
  console.log(`\n  Buka di tablet:  ${url}`);
  console.log(`  Kode pairing:    ${pairingCode}`);
  console.log(`\n  Kode ini ganti tiap server dinyalakan, dan cuma dipakai sekali —`);
  console.log('  setelah itu device dapat token sendiri dan tidak ditanya lagi.');
  console.log(`  Device yang sudah terpasang: ${paired}\n`);
});
