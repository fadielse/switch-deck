#!/usr/bin/env node
// Settles what three-finger gestures actually need, by trying the three ways a
// chord can be built and reporting which one macOS acts on. Mission Control is
// the probe because it is observable: when it opens, the frontmost app becomes
// the Dock.
import { spawn, execSync } from 'node:child_process';

const BIN = 'mac/deckd-input/.build/release/deckd-input';
const CTRL = 59, UP = 126, ESC = 53;

const front = () => {
  try {
    const asn = execSync('lsappinfo front', { encoding: 'utf8' }).trim();
    return execSync(`lsappinfo info -only name ${asn}`, { encoding: 'utf8' })
      .trim().replace(/.*=/, '').replace(/"/g, '');
  } catch { return '?'; }
};

const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = (f) => child.stdin.write(JSON.stringify(f) + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const VARIANTS = [
  {
    name: 'A  modifier ditahan + flags di panah',
    note: 'yang dipakai client sekarang',
    run: async () => {
      send({ t: 'k', code: CTRL, d: 1 }); await wait(70);
      send({ t: 'k', code: UP, d: 1, flags: ['ctrl'] }); await wait(60);
      send({ t: 'k', code: UP, d: 0, flags: ['ctrl'] }); await wait(60);
      send({ t: 'k', code: CTRL, d: 0 });
    }
  },
  {
    name: 'B  modifier ditahan, panah TANPA flags',
    note: 'kalau ini yang jalan, berarti set flags manual justru merusak',
    run: async () => {
      send({ t: 'k', code: CTRL, d: 1 }); await wait(70);
      send({ t: 'k', code: UP, d: 1 }); await wait(60);
      send({ t: 'k', code: UP, d: 0 }); await wait(60);
      send({ t: 'k', code: CTRL, d: 0 });
    }
  },
  {
    name: 'C  flags saja, modifier tidak ditekan',
    note: 'cara paling sederhana; kalau ini jalan, semua kerumitan tadi sia-sia',
    run: async () => {
      send({ t: 'k', code: UP, d: 1, flags: ['ctrl'] }); await wait(60);
      send({ t: 'k', code: UP, d: 0, flags: ['ctrl'] });
    }
  }
];

(async () => {
  await wait(400);
  console.log('');
  console.log('  Menguji 3 cara membentuk Control+Up. Jangan sentuh Mac selama ~10 detik.');
  console.log('');

  const results = [];
  for (const variant of VARIANTS) {
    const before = front();
    await variant.run();
    await wait(1100);
    const after = front();
    const opened = after !== before && /dock/i.test(after);
    results.push(opened);

    console.log(`  ${opened ? 'JALAN     ' : 'tidak     '} ${variant.name}`);
    console.log(`             ${before} -> ${after}`);
    console.log(`             ${variant.note}`);
    console.log('');

    // close Mission Control again before the next attempt
    send({ t: 'k', code: ESC, d: 1 });
    send({ t: 'k', code: ESC, d: 0 });
    await wait(900);
  }

  console.log('  ' + '-'.repeat(64));
  if (results.some(Boolean)) {
    console.log('  Chord-nya SAMPAI. Berarti masalahnya di sisi client (deteksi gesture),');
    console.log('  dan badge di trackpad yang akan menunjukkan di mana.');
  } else {
    console.log('  Tidak satu pun jalan. Berarti bukan cara membentuk chord-nya:');
    console.log('  shortcut Mission Control kemungkinan dinonaktifkan atau dipetakan ulang');
    console.log('  di System Settings > Keyboard > Shortcuts > Mission Control.');
  }
  console.log('');
  child.kill();
  process.exit(0);
})();
