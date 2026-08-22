// Isolates how much of the measured latency belongs to our server rather than
// to the network: same code path, same frame, but over loopback.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import { loadConfig } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8801;
const config = loadConfig();

const server = spawn(process.execPath, [join(here, '..', 'src', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DECKD_INPUT: join(here, 'stub-input.js'),
         STUB_OUT: join(tmpdir(), 'switchdeck-latency.jsonl') },
  stdio: ['ignore', 'ignore', 'ignore'],
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function health() {
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return true; } catch {}
    await wait(100);
  }
  return false;
}

(async () => {
  if (!await health()) { console.log('server nggak hidup'); server.kill(); process.exit(1); }

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?t=${config.token}`);
  await new Promise((r) => ws.on('open', r));

  const rtts = [];
  ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString());
    if (f.t === 'pong') rtts.push(performance.now() - f.ts);
  });

  // Ping while also pushing trackpad traffic, so the server is measured under
  // the same load a real session puts on it rather than while idle.
  for (let i = 0; i < 200; i += 1) {
    ws.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
    for (let j = 0; j < 3; j += 1) ws.send(JSON.stringify({ t: 'm', dx: 4, dy: 2 }));
    await wait(11); // ~90 Hz, matching the tablet
  }
  await wait(400);

  rtts.sort((a, b) => a - b);
  const at = (q) => rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * q))].toFixed(2);
  console.log('');
  console.log(`  sampel      : ${rtts.length}`);
  console.log(`  min         : ${rtts[0].toFixed(2)} ms`);
  console.log(`  p50         : ${at(0.5)} ms`);
  console.log(`  p95         : ${at(0.95)} ms`);
  console.log(`  max         : ${rtts[rtts.length - 1].toFixed(2)} ms`);
  console.log('');
  console.log('  Ini biaya server + event loop saja, tanpa wifi.');
  console.log('  Kalau angka dari tablet jauh lebih besar, selisihnya milik jaringan.');
  ws.close(); server.kill(); process.exit(0);
})();
