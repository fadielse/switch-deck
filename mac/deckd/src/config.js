import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

const DIR = join(homedir(), '.config', 'switchdeck');
const FILE = join(DIR, 'config.json');

/// Decision K5: there is no unauthenticated mode, not even for a first try.
/// A missing config is filled in with a fresh token rather than skipped.
export function loadConfig() {
  if (!existsSync(FILE)) {
    mkdirSync(DIR, { recursive: true });
    const created = {
      token: randomBytes(16).toString('hex'),
      port: 8777,
      hostName: hostname().replace(/\.local$/, ''),
    };
    // The token is a credential: it lets anything on the LAN type into this Mac.
    writeFileSync(FILE, JSON.stringify(created, null, 2) + '\n', { mode: 0o600 });
    return { ...created, path: FILE, isNew: true };
  }
  const config = JSON.parse(readFileSync(FILE, 'utf8'));
  return { port: 8777, hostName: hostname(), ...config, path: FILE, isNew: false };
}

export function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}
