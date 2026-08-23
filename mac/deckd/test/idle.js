// Does the client let the CPU sleep?
//
// The failure this guards against is invisible: nothing breaks, no test goes
// red, the tablet just runs warm because a requestAnimationFrame loop never
// stops. So the check has to be explicit, and it has to run against the real
// code — a copy of the loop pasted in here would keep passing while
// index.html rotted. The functions are lifted out of the page and run with a
// counted stand-in for requestAnimationFrame.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, '..', 'web', 'index.html'), 'utf8');

const START = '  function drain(pending, take) {';
const END = '  // ---------- keyboard ----------';
const a = page.indexOf(START), b = page.indexOf(END);
if (a < 0 || b < 0) {
  console.error('[FAIL] tidak menemukan blok flush di index.html — tes ini perlu diperbarui');
  process.exit(1);
}
const chunk = page.slice(a, b);

for (const name of ['function kick(', 'function flush(', 'flushing = false']) {
  if (!chunk.includes(name)) {
    console.error('[FAIL] blok flush tidak memuat ' + name + ' — bentuknya berubah');
    process.exit(1);
  }
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log((cond ? '[PASS] ' : '[FAIL] ') + msg); };

// ---- harness ----
let frames = 0, queue = [], clock = 0;
const raf = (fn) => { frames += 1; queue.push(fn); };
const tick = (ms = 11) => { clock += ms; const q = queue; queue = []; for (const fn of q) fn(clock); };

const pointers = new Set();
const cfg = { smooth: 0.6 };
let sent = [];
const send = (f) => sent.push(f);

const build = new Function('pointers', 'cfg', 'send', 'minSendGap', 'requestAnimationFrame', `
  var accX = 0, accY = 0, accSX = 0, accSY = 0;
  ${chunk}
  return {
    kick: kick,
    move: function (x, y) { accX += x; accY += y; },
    scroll: function (x, y) { accSX += x; accSY += y; },
    seed: function (x, y) { accX = x; accY = y; },
    acc: function () { return [accX, accY, accSX, accSY]; }
  };
`);
const pad = build(pointers, cfg, send, 1000 / 60, raf);

// 1. A page nobody is touching must schedule nothing at all.
for (let i = 0; i < 200; i += 1) tick();
ok(frames === 0, 'diam sejak load: 0 animation frame (dulu satu per frame, selamanya)');

// 2. A swipe still delivers every pixel.
pointers.add(1); pad.kick(); pad.move(100.4, 0);
for (let i = 0; i < 40; i += 1) tick();
pointers.delete(1);
for (let i = 0; i < 40; i += 1) tick();
const moved = sent.filter((f) => f.t === 'm').reduce((n, f) => n + f.dx, 0);
ok(moved === 100, 'usapan sampai utuh: 100 px terkirim, sisa 0.4 px dibuang');

// 3. And then it stops.
let mark = frames;
for (let i = 0; i < 300; i += 1) tick();
ok(frames === mark, 'jari diangkat → loop berhenti: 0 frame tambahan selama 300 tick');

// 4. The remainder must not hold the loop open. trunc() of anything below one
//    pixel is 0 forever, so a naive "masih ada sisa?" test spins for good.
pad.seed(0.4, -0.7); pad.kick();
mark = frames;
for (let i = 0; i < 200; i += 1) tick();
ok(frames - mark <= 3, 'sisa sub-piksel berhenti dalam <=3 frame, bukan spin abadi (aktual: ' + (frames - mark) + ')');
ok(pad.acc().every((v) => v === 0), 'sisa sub-piksel dibersihkan, tidak menumpuk antar usapan');

// 5. A loop that has slept must wake for the next swipe.
sent = [];
pointers.add(2); pad.kick(); pad.move(0, 50);
for (let i = 0; i < 40; i += 1) tick();
pointers.delete(2);
for (let i = 0; i < 20; i += 1) tick();
ok(sent.filter((f) => f.t === 'm').reduce((n, f) => n + f.dy, 0) === 50, 'usapan kedua utuh setelah loop sempat tidur');
mark = frames;
for (let i = 0; i < 200; i += 1) tick();
ok(frames === mark, 'dan tidur lagi sesudahnya');

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
