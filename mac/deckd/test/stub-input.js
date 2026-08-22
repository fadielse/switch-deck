#!/usr/bin/env node
// Stands in for deckd-input so the chain can be asserted without needing
// Accessibility. Records every frame it is handed.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const out = process.env.STUB_OUT;
process.stdout.write(JSON.stringify({ t: 'ready', trusted: true }) + '\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  if (out) appendFileSync(out, line + '\n');
});
