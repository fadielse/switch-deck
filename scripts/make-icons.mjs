#!/usr/bin/env node
// Writes the PWA icons as real PNGs, encoded here rather than converted from
// SVG, because nothing on this machine converts SVG to PNG and an installed
// icon is not the place to find that out.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'mac', 'deckd', 'web', 'icons');

const BG = [20, 23, 29];      // matches the app's own background
const KEY = [61, 111, 209];
const PAD = [42, 48, 60];

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, draw) {
  const px = Buffer.alloc(size * size * 4);
  draw((x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  });
  // PNG wants a filter byte in front of every scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/// A trackpad under two rows of keys: the thing itself, at icon size.
function draw(size, maskable) {
  return (set) => {
    const inset = maskable ? Math.round(size * 0.14) : 0;  // safe area for circular masks
    const r = size * 0.22;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // rounded square background
        const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
        const corner = cx < r && cy < r && Math.hypot(r - cx, r - cy) > r;
        set(x, y, BG, maskable || !corner ? 255 : 0);
      }
    }
    const w = size - inset * 2;
    const gap = Math.round(w * 0.06);
    const keyW = Math.round((w - gap * 3) / 4);
    const keyH = Math.round(w * 0.13);
    const top = inset + Math.round(w * 0.16);

    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const x0 = inset + gap / 2 + col * (keyW + gap);
        const y0 = top + row * (keyH + gap);
        for (let y = y0; y < y0 + keyH; y += 1)
          for (let x = x0; x < x0 + keyW; x += 1)
            set(Math.round(x), Math.round(y), row === 0 && col === 1 ? KEY : PAD);
      }
    }
    // the trackpad
    const padW = Math.round(w * 0.52), padH = Math.round(w * 0.3);
    const px0 = inset + Math.round((w - padW) / 2);
    const py0 = top + 2 * (keyH + gap) + Math.round(w * 0.06);
    for (let y = py0; y < py0 + padH; y += 1)
      for (let x = px0; x < px0 + padW; x += 1)
        set(x, y, KEY);
  };
}

mkdirSync(OUT, { recursive: true });
for (const [size, maskable] of [[192, false], [512, false], [512, true]]) {
  const name = maskable ? 'icon-maskable-512.png' : `icon-${size}.png`;
  writeFileSync(join(OUT, name), png(size, draw(size, maskable)));
  console.log(`  ${name}`);
}
