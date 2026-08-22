// Chain test for F1: browser -> WebSocket -> deckd -> deckd-input.
// Uses a stub in place of the Swift binary, so it asserts the wiring rather
// than the injection (which `make selftest` covers separately).
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';



const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8799;
const STUB_OUT = join(tmpdir(), `switchdeck-chain-${process.pid}.jsonl`);


let failures = 0;
function check(ok, label, detail = '') {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
}

const server = spawn(process.execPath, [join(here, '..', 'src', 'server.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    // Its own config directory: the real one holds real device tokens and the
    // pairing code the user is reading.
    SWITCHDECK_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'switchdeck-test-')),
    DECKD_INPUT: join(here, 'stub-input.js'),
    STUB_OUT,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

// The pairing code lives only in the server process, so read it back off its
// own output — which also means the test walks the real pairing path rather
// than reaching around it.
let serverOut = '';
server.stdout.on('data', (chunk) => { serverOut += chunk; });
const pairingCode = async () => {
  for (let i = 0; i < 50; i += 1) {
    const m = serverOut.match(/Kode pairing:\s*(\d{6})/);
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};

async function pair(code) {
  const res = await fetch(`http://127.0.0.1:${PORT}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code })
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

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

  const code = await pairingCode();
  check(!!code, 'server mencetak kode pairing 6 digit', code ?? 'tidak ketemu');

  const wrong = await pair(code === '000000' ? '111111' : '000000');
  check(wrong.status === 401, 'kode pairing salah DITOLAK');

  const paired = await pair(code);
  check(paired.status === 200 && !!paired.body.token, 'kode benar ditukar jadi token device',
        'kode 6 digit cuma dipakai sekali; token panjang yang jaga koneksinya');

  const bad = await open('salah-token-banget');
  check(bad.rejected, 'token device palsu DITOLAK', 'ini yang bikin K5 bukan cuma slogan');

  const good = await open(paired.body.token);
  check(!good.rejected, 'token device diterima');
  if (good.rejected) done(1);

  await wait(200);
  const hello = good.frames.find((f) => f.t === 'hello');
  check(!!hello, 'dapat frame hello');
  const pages = hello?.deck?.pages ?? [];
  const totalKeys = pages.reduce((n, p) => n + p.keys.length, 0);
  check(pages.length > 0 && totalKeys > 0, 'hello bawa deck berhalaman',
        `${pages.length} halaman, ${totalKeys} tombol`);
  check(pages.every((p) => p.keys.every((k) => k.action === undefined)),
        'tablet TIDAK dikasih action-nya', 'cuma id + label, jadi tidak ada yang bisa dieksekusi dari sana');

  good.ws.send(JSON.stringify({ t: 'ping', ts: 12345 }));
  await wait(150);
  check(good.frames.some((f) => f.t === 'pong' && f.ts === 12345), 'ping dibalas pong');

  good.ws.send(JSON.stringify({ t: 'macro', id: 'rm-rf-slash' }));
  await wait(200);
  check(good.frames.some((f) => f.t === 'err' && f.id === 'rm-rf-slash'),
        'macro tak dikenal ditolak', 'tablet cuma boleh kirim id yang sudah didefinisikan');

  const readSent = () => (existsSync(STUB_OUT)
    ? readFileSync(STUB_OUT, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
    : []);

  good.ws.send(JSON.stringify({ t: 'macro', id: 'copy' }));
  await wait(400);
  check(good.frames.some((f) => f.t === 'ack' && f.id === 'copy'), 'tombol deck di-ack');

  const sent = readSent();
  const down = sent.find((f) => f.t === 'k' && f.code === 8 && f.d === 1);
  check(sent.some((f) => f.t === 'k' && f.code === 55 && f.d === 1),
        'modifier ditahan sebagai key beneran', 'bukan cuma flag — itu yang bikin chord kebaca');
  check(down?.flags?.includes('cmd'), 'chord ⌘C utuh sampai deckd-input');

  // --- F2: trackpad frames lewat jalur pass-through yang divalidasi ---
  const before = readSent().length;
  good.ws.send(JSON.stringify({ t: 'm', dx: 5, dy: -3 }));
  good.ws.send(JSON.stringify({ t: 's', dx: 0, dy: 4 }));
  good.ws.send(JSON.stringify({ t: 'b', btn: 'r', d: 1 }));
  await wait(250);
  const passed = readSent().slice(before);
  check(passed.some((f) => f.t === 'm' && f.dx === 5 && f.dy === -3), 'frame gerak diteruskan');
  check(passed.some((f) => f.t === 's' && f.dy === 4), 'frame scroll diteruskan');
  check(passed.some((f) => f.t === 'b' && f.btn === 'r'), 'frame klik kanan diteruskan');

  // --- F3: keyboard ---
  const beforeKb = readSent().length;
  good.ws.send(JSON.stringify({ t: 'txt', s: 'halo' }));
  good.ws.send(JSON.stringify({ t: 'k', code: 55, d: 1 }));
  good.ws.send(JSON.stringify({ t: 'k', code: 48, d: 1, flags: ['cmd'] }));
  await wait(250);
  const kb = readSent().slice(beforeKb);
  check(kb.some((f) => f.t === 'txt' && f.s === 'halo'), 'frame teks diteruskan');
  check(kb.some((f) => f.t === 'k' && f.code === 55 && f.d === 1),
        'modifier dikirim sebagai key beneran', 'ini yang bikin Cmd+Tab kelakuannya kayak hardware');
  check(kb.some((f) => f.t === 'k' && f.code === 48 && f.flags?.includes('cmd')), 'chord diteruskan utuh');

  // --- aksi sistem: id dari tabel tetap, bukan perintah dari tablet ---
  good.ws.send(JSON.stringify({ t: 'sys', id: 'mission-control' }));
  await wait(250);
  check(good.frames.some((f) => f.t === 'ack' && f.id === 'mission-control'),
        'aksi sistem yang dikenal di-ack');
  good.ws.send(JSON.stringify({ t: 'sys', id: 'rm -rf /' }));
  await wait(200);
  check(good.frames.some((f) => f.t === 'err' && f.id === 'rm -rf /'),
        'aksi sistem ngawur ditolak', 'tablet cuma boleh kirim id, bukan perintah');

  // --- deck ikut app aktif ---
  const xcodePage = pages.findIndex((p) => (p.match || []).some((m) => m === 'xcode'));
  check(xcodePage >= 0, 'ada halaman yang minta app tertentu', `Xcode di index ${xcodePage}`);
  check(hello?.front?.page === xcodePage,
        'hello memetakan app depan ke halamannya',
        `front="${hello?.front?.app}" -> halaman ${hello?.front?.page}`);

  // --- cabut device ---
  const helloDevices = hello?.devices ?? [];
  check(helloDevices.length > 0 && helloDevices.some((d) => d.current),
        'hello bawa daftar device, dan menandai yang sedang dipakai');
  check(helloDevices.every((d) => !/^[0-9a-f]{40,}$/.test(d.id)),
        'device dikenali lewat id pendek, BUKAN token', 'tablet tidak pernah lihat token device lain');

  // Pair a second device so there is one to revoke that is not this connection.
  await pair(code);
  await wait(250);
  const latest = () => (good.frames.filter((f) => f.t === 'devices').pop() ?? { devices: helloDevices }).devices;
  const listBefore = latest();
  const victim = listBefore.find((d) => !d.current);
  check(!!victim, 'ada device kedua untuk dicabut', `${listBefore.length} device terdaftar`);
  if (victim) {
    good.ws.send(JSON.stringify({ t: 'revoke', id: victim.id }));
    await wait(350);
    const listAfter = latest();
    check(listAfter.length < listBefore.length && !listAfter.some((d) => d.id === victim.id),
          'device dicabut hilang dari daftar', `${listBefore.length} -> ${listAfter.length}`);
  }
  good.ws.send(JSON.stringify({ t: 'revoke', id: 'tidakada' }));
  await wait(200);
  check(good.frames.some((f) => f.t === 'err' && f.id === 'tidakada'), 'cabut id ngawur ditolak');

  // --- yang HARUS ditolak ---
  const beforeBad = readSent().length;
  good.ws.send('{"t":"m","dx":null,"dy":1}');           // NaN di sisi Swift = crash
  good.ws.send(JSON.stringify({ t: 'm', dx: 0, dy: 0 })); // no-op, buang saja
  good.ws.send(JSON.stringify({ t: 'b', btn: 'evil', d: 1 }));
  good.ws.send(JSON.stringify({ t: 'k', code: 999, d: 1 }));           // di luar jangkauan
  good.ws.send(JSON.stringify({ t: 'k', code: 8, d: 1, flags: ['evil'] })); // flag ngawur
  good.ws.send(JSON.stringify({ t: 'txt', s: 'x'.repeat(300) }));      // kepanjangan
  good.ws.send(JSON.stringify({ t: 'txt', s: '' }));                   // kosong
  good.ws.send(JSON.stringify({ t: 'shell', cmd: 'rm -rf /' }));
  await wait(250);
  const leaked = readSent().slice(beforeBad);
  check(leaked.length === 0, 'frame cacat/terlarang TIDAK diteruskan',
        leaked.length ? `bocor: ${JSON.stringify(leaked)}` : 'NaN, keycode di luar jangkauan, flag ngawur, teks kepanjangan, shell');

  const huge = readSent().length;
  good.ws.send(JSON.stringify({ t: 'm', dx: 1e12, dy: 0 }));
  await wait(200);
  const clamped = readSent().slice(huge);
  check(clamped.length === 1 && Math.abs(clamped[0].dx) <= 400, 'nilai gila diclamp, bukan diteruskan mentah',
        clamped.length ? `dx=${clamped[0].dx}` : 'nggak ada frame');

  // Throttle: the free tries are spent above, so this should be refused outright.
  for (let i = 0; i < 4; i += 1) await pair('999999');
  const throttled = await pair('999999');
  check(throttled.status === 429, 'tebakan beruntun kena rate limit',
        `${throttled.body.retryAfter ?? '?'} detik — inilah yang bikin 6 digit aman`);

  console.log('');
  console.log(failures === 0
    ? 'RANTAI UTUH: WebSocket -> deckd -> deckd-input (macro F1, trackpad F2, keyboard F3).'
    : `${failures} cek GAGAL.`);
  done(failures === 0 ? 0 : 1);
})();
