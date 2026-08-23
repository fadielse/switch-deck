#!/usr/bin/env node
// Stands in for deckd-input so the chain can be asserted without needing
// Accessibility. Records every frame it is handed.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const out = process.env.STUB_OUT;
process.stdout.write(JSON.stringify({ t: 'ready', trusted: true }) + '\n');
// Stand in for the workspace observer, so the deck-follows-app path is covered
// without needing a real application to come to the front.
process.stdout.write(JSON.stringify({
  t: 'front', app: 'Xcode', bundle: 'com.apple.dt.Xcode'
}) + '\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  if (out) appendFileSync(out, line + '\n');
  // The stub has no screen, so it pretends its own ends at the clamp: a move
  // that arrives at the maximum the sanitiser allows is exactly what pushing
  // into an edge looks like. That gives the chain test a deterministic way to
  // exercise the edge report without a display or Accessibility.
  let frame;
  try { frame = JSON.parse(line); } catch { return; }
  if (frame.t === 'clipget') {
    process.stdout.write(JSON.stringify({ t: 'clip', s: 'halo dari mesin sebelah — ünïcode ✓' }) + '\n');
  }
  if (frame.t === 'clipset') {
    process.stdout.write(JSON.stringify({ t: 'clipok', n: (frame.s || '').length }) + '\n');
  }
  // The stub deliberately does NOT know 'warp' — it stands in for a binary
  // that was pulled but never rebuilt, which is the failure this reporting
  // path exists to make visible.
  if (frame.t === 'warp') {
    process.stdout.write(JSON.stringify({
      t: 'err', msg: 'unknown frame type', type: frame.t
    }) + '\n');
  }
  if (frame.t === 'm' && Math.abs(frame.dx) >= 400) {
    process.stdout.write(JSON.stringify({
      t: 'edge', side: frame.dx > 0 ? 'r' : 'l', over: Math.abs(frame.dx), ry: 0.5
    }) + '\n');
  }
});
