#!/usr/bin/env node
// Sweeps the two variables that could explain why system hotkeys ignore our
// synthetic events — which state the event claims to come from, and where it is
// injected — and finishes with a shell fallback that does not use keystrokes at
// all. Mission Control is the probe because it is observable without Screen
// Recording permission: when it opens, the frontmost app becomes the Dock.
import { spawn, execSync } from 'node:child_process';

const BIN = 'mac/deckd-input/.build/release/deckd-input';
const CTRL = 59, UP = 126, ESC = 53;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const front = () => {
  try {
    const asn = execSync('lsappinfo front', { encoding: 'utf8' }).trim();
    return execSync(`lsappinfo info -only name ${asn}`, { encoding: 'utf8' })
      .trim().replace(/.*=/, '').replace(/"/g, '');
  } catch { return '?'; }
};

function openChild(env) {
  const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
  return {
    child,
    send: (f) => child.stdin.write(JSON.stringify(f) + '\n'),
    kill: () => child.kill()
  };
}

async function tryChord(env) {
  const io = openChild(env);
  await wait(350);
  io.send({ t: 'k', code: CTRL, d: 1 }); await wait(70);
  io.send({ t: 'k', code: UP, d: 1, flags: ['ctrl'] }); await wait(60);
  io.send({ t: 'k', code: UP, d: 0, flags: ['ctrl'] }); await wait(60);
  io.send({ t: 'k', code: CTRL, d: 0 });
  await wait(1100);
  const result = front();
  io.send({ t: 'k', code: ESC, d: 1 });
  io.send({ t: 'k', code: ESC, d: 0 });
  await wait(800);
  io.kill();
  return result;
}

const CASES = [
  { label: 'source hid      + tap hid       (dipakai sekarang)', env: {} },
  { label: 'source combined + tap hid',       env: { DECKD_SOURCE: 'combined' } },
  { label: 'source none     + tap hid',       env: { DECKD_SOURCE: 'none' } },
  { label: 'source hid      + tap session',   env: { DECKD_TAP: 'session' } },
  { label: 'source combined + tap session',   env: { DECKD_SOURCE: 'combined', DECKD_TAP: 'session' } },
  { label: 'source hid      + tap annotated', env: { DECKD_TAP: 'annotated' } }
];

(async () => {
  console.log('\n  Menyapu kombinasi sumber event x titik suntik.');
  console.log('  Jangan sentuh Mac selama ~25 detik.\n');

  let winner = null;
  for (const c of CASES) {
    const after = await tryChord(c.env);
    const ok = /dock/i.test(after);
    if (ok && !winner) winner = c;
    console.log(`  ${ok ? 'JALAN  ' : 'tidak  '} ${c.label}   -> ${after}`);
  }

  // No keystroke involved at all: launch the app that IS Mission Control.
  console.log('');
  const before = front();
  try { execSync('open -a "Mission Control"'); } catch (e) { console.log('  (open gagal:', e.message.trim(), ')'); }
  await wait(1200);
  const afterOpen = front();
  const openWorks = /dock/i.test(afterOpen);
  console.log(`  ${openWorks ? 'JALAN  ' : 'tidak  '} open -a "Mission Control"   ${before} -> ${afterOpen}`);
  const io = openChild({});
  await wait(300);
  io.send({ t: 'k', code: ESC, d: 1 });
  io.send({ t: 'k', code: ESC, d: 0 });
  await wait(700);
  io.kill();

  console.log('\n  ' + '-'.repeat(66));
  if (winner) {
    console.log(`  Ketemu: ${winner.label.trim()}`);
    console.log('  Client tinggal dipindah ke kombinasi ini.');
  } else if (openWorks) {
    console.log('  Tidak ada kombinasi keystroke yang jalan — system hotkey macOS');
    console.log('  memang mengabaikan event sintetis. Tapi `open -a` JALAN, jadi');
    console.log('  gesture bisa memakai jalur itu untuk Mission Control.');
  } else {
    console.log('  Tidak ada yang jalan, termasuk `open -a`. Berarti bukan soal cara');
    console.log('  mengirim — ada yang lain di Mac ini yang memblokir Mission Control.');
  }
  console.log('');
  process.exit(0);
})();
