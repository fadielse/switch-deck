// Chain test for F1: browser -> WebSocket -> deckd -> deckd-input.
// Uses a stub in place of the Swift binary, so it asserts the wiring rather
// than the injection (which `make selftest` covers separately).
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import { loadConfig } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8799;
const STUB_OUT = join(tmpdir(), `switchdeck-chain-${process.pid}.jsonl`);
const config = loadConfig();

let failures = 0;
function check(ok, label, detail = '') {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
}

const server = spawn(process.execPath, [join(here, '..', 'src', 'server.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DECKD_INPUT: join(here, 'stub-input.js'),
    STUB_OUT,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const done = (code) => {
  server.kill();
  if (existsSync(STUB_OUT)) rmSync(STUB_OUT);
  process.exit(code);
};

async function waitForHealth() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function open(token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?t=${token}`);
    const frames = [];
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    ws.on('open', () => resolve({ ws, frames, rejected: false }));
    ws.on('error', () => resolve({ ws: null, frames, rejected: true }));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  check(await waitForHealth(), 'server hidup dan /health jawab');

  const bad = await open('salah-token-banget');
  check(bad.rejected, 'token salah DITOLAK', 'ini yang bikin K5 bukan cuma slogan');

  const good = await open(config.token);
  check(!good.rejected, 'token benar diterima');
  if (good.rejected) done(1);

  await wait(200);
  const hello = good.frames.find((f) => f.t === 'hello');
  check(!!hello, 'dapat frame hello');
  check(Array.isArray(hello?.deck) && hello.deck.some((k) => k.id === 'copy'),
        'deck berisi tombol copy');

  good.ws.send(JSON.stringify({ t: 'ping', ts: 12345 }));
  await wait(150);
  check(good.frames.some((f) => f.t === 'pong' && f.ts === 12345), 'ping dibalas pong');

  good.ws.send(JSON.stringify({ t: 'macro', id: 'copy' }));
  await wait(300);
  check(good.frames.some((f) => f.t === 'ack' && f.id === 'copy'), 'macro di-ack');

  good.ws.send(JSON.stringify({ t: 'macro', id: 'rm-rf-slash' }));
  await wait(200);
  check(good.frames.some((f) => f.t === 'err' && f.id === 'rm-rf-slash'),
        'macro tak dikenal ditolak', 'tablet cuma boleh kirim id yang sudah didefinisikan');

  const sent = existsSync(STUB_OUT)
    ? readFileSync(STUB_OUT, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    : [];
  const downFrame = sent.find((f) => f.t === 'k' && f.code === 8 && f.d === 1);
  const upFrame = sent.find((f) => f.t === 'k' && f.code === 8 && f.d === 0);
  check(!!downFrame && !!upFrame, 'deckd-input nerima keydown + keyup untuk C');
  check(downFrame?.flags?.includes('cmd'), 'frame bawa modifier cmd', 'jadi beneran ⌘C');
  check(sent.length === 2, 'tepat 2 frame diteruskan', `dapat ${sent.length}`);

  console.log('');
  console.log(failures === 0
    ? 'RANTAI F1 UTUH: WebSocket -> deckd -> deckd-input.'
    : `${failures} cek GAGAL.`);
  done(failures === 0 ? 0 : 1);
})();
