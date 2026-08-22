#!/usr/bin/env node
// Closes the F1 DoD without guesswork: plant a sentinel in the clipboard, then
// watch for it to be replaced. If the tablet's Copy button really drove ⌘C on
// the Mac, the clipboard changes; if nothing happened, it stays the sentinel.
import { execFileSync } from 'node:child_process';

const read = () => {
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' });
  } catch {
    return '';
  }
};

const sentinel = `SWITCHDECK-BELUM-KE-COPY-${Date.now()}`;
execFileSync('pbcopy', { input: sentinel });

console.log('Clipboard di-set ke penanda (isi clipboard lama ketimpa).');
console.log('');
console.log('Sekarang, di Mac ini:');
console.log('  1. Seleksi teks di app apa saja — biarkan app itu yang paling depan.');
console.log('  2. Tap tombol Copy di tablet.');
console.log('');
console.log('Nunggu clipboard berubah (maks 90 detik, Ctrl-C buat batal)...');

const started = Date.now();
const timer = setInterval(() => {
  const now = read();
  if (now && now !== sentinel) {
    clearInterval(timer);
    const preview = now.length > 120 ? now.slice(0, 120) + '…' : now;
    console.log('');
    console.log('LULUS — clipboard berubah. Isinya sekarang:');
    console.log('  ' + JSON.stringify(preview));
    console.log('');
    console.log('Rantai penuh kebukti: tap di tablet -> WebSocket -> deckd -> deckd-input -> ⌘C di macOS.');
    process.exit(0);
  }
  if (Date.now() - started > 90_000) {
    clearInterval(timer);
    console.log('');
    console.log('Clipboard nggak berubah dalam 90 detik.');
    console.log('Yang perlu dicek, urut dari yang paling sering jadi biang:');
    console.log('  - Ada teks yang beneran keseleksi? ⌘C tanpa seleksi memang nggak ngapa-ngapain.');
    console.log('  - App yang keseleksi itu yang paling depan pas tombol ditap?');
    console.log('  - Terminal yang jalanin `make deckd` dapat izin Accessibility? Cek `make doctor`.');
    console.log('  - Tombolnya nyala hijau sebentar pas ditap? Kalau nggak, WebSocket-nya yang putus.');
    process.exit(1);
  }
}, 300);
