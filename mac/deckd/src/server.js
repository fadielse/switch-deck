import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { lanAddress, loadConfig } from './config.js';
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

function tokenMatches(candidate) {
  const a = Buffer.from(String(candidate ?? ''));
  const b = Buffer.from(config.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const pagePath = join(here, '..', 'web', 'index.html');

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
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
  if (url.pathname !== '/ws' || !tokenMatches(url.searchParams.get('t'))) {
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
  const url = `http://${lanAddress()}:${port}/#t=${config.token}`;
  console.log(`\n  SwitchDeck — ${config.hostName}`);
  if (config.isNew) console.log(`  config baru dibuat di ${config.path}`);
  const total = deck.describe().pages.reduce((n, p) => n + p.keys.length, 0);
  console.log(`  deck: ${total} tombol dari ${deck.path}${deck.isNew ? ' (baru dibuat)' : ''}`);
  console.log(`\n  Buka di tablet:\n  ${url}\n`);
  console.log('  (link ini mengandung token — jangan disebar)\n');
});
