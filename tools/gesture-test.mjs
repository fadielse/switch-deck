#!/usr/bin/env node
// Asks you what you saw, because nothing here can see it.
//
// Earlier versions of this test judged Mission Control by whether lsappinfo
// reported the Dock as frontmost. It does not: Mission Control is a Dock-owned
// overlay and the front application is unchanged, so the probe reported failure
// for `open -a "Mission Control"` — a command that cannot fail. Screen
// Recording permission is not granted, so there is no way to look at the screen
// from here either. You are sitting in front of it; you are the instrument.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const BIN = 'mac/deckd-input/.build/release/deckd-input';
const CTRL = 59, UP = 126, ESC = 53;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim().toLowerCase())));

function open(env) {
  const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
  return { send: (f) => child.stdin.write(JSON.stringify(f) + '\n'), kill: () => child.kill() };
}

async function fire(env) {
  const io = open(env);
  await wait(350);
  io.send({ t: 'k', code: CTRL, d: 1 }); await wait(70);
  io.send({ t: 'k', code: UP, d: 1, flags: ['ctrl'] }); await wait(60);
  io.send({ t: 'k', code: UP, d: 0, flags: ['ctrl'] }); await wait(60);
  io.send({ t: 'k', code: CTRL, d: 0 });
  await wait(1200);
  io.send({ t: 'k', code: ESC, d: 1 });
  io.send({ t: 'k', code: ESC, d: 0 });
  await wait(600);
  io.kill();
}

const CASES = [
  { label: 'source hid      + tap hid  (dipakai client sekarang)', env: {} },
  { label: 'source combined + tap hid',       env: { DECKD_SOURCE: 'combined' } },
  { label: 'source none     + tap hid',       env: { DECKD_SOURCE: 'none' } },
  { label: 'source hid      + tap session',   env: { DECKD_TAP: 'session' } },
  { label: 'source combined + tap session',   env: { DECKD_SOURCE: 'combined', DECKD_TAP: 'session' } },
  { label: 'source hid      + tap annotated', env: { DECKD_TAP: 'annotated' } }
];

(async () => {
  console.log('\n  LIHAT LAYAR MAC, jangan terminal ini.');
  console.log('  Tiap percobaan: Control+Up dikirim, ditunggu sedetik, lalu ditutup Esc.');
  console.log('  Yang dicari: semua window melebar jadi grid (Mission Control).\n');
  await ask('  Enter kalau siap... ');

  for (const c of CASES) {
    console.log(`\n  -> ${c.label}`);
    await wait(700);
    await fire(c.env);
    const answer = await ask('     Mission Control kebuka? (y/n) ');
    if (answer.startsWith('y')) {
      console.log('\n  ' + '-'.repeat(60));
      console.log(`  KETEMU: ${c.label.trim()}`);
      console.log('  Chord-nya sampai. Kalau gesture di tablet masih diam,');
      console.log('  masalahnya di sisi client — baca badge di pojok trackpad.');
      if (Object.keys(c.env).length) {
        console.log('\n  Kombinasi ini BUKAN default. Jalankan deckd dengan:');
        console.log('    ' + Object.entries(c.env).map(([k, v]) => `${k}=${v}`).join(' ') + ' make deckd');
      }
      console.log('');
      rl.close(); process.exit(0);
    }
  }

  console.log('\n  ' + '-'.repeat(60));
  console.log('  Tidak ada kombinasi keystroke yang jalan.');
  console.log('  Berarti macOS memang mengabaikan event sintetis untuk hotkey ini,');
  console.log('  dan gesture harus lewat jalur lain — bukan lewat shortcut.');
  console.log('');
  rl.close(); process.exit(1);
})();
