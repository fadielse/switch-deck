import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

// Overridable so tests get their own directory. Without it every `make e2e`
// wrote device tokens into the real config and clobbered the pairing code file
// with a code belonging to a server that then exited.
const DIR = process.env.SWITCHDECK_CONFIG_DIR || join(homedir(), '.config', 'switchdeck');
const FILE = join(DIR, 'config.json');

/// Decision K5: there is no unauthenticated mode, not even for a first try.
/// A missing config is filled in with a fresh token rather than skipped.
export function loadConfig() {
  if (!existsSync(FILE)) {
    mkdirSync(DIR, { recursive: true });
    const created = {
      port: 8777,
      hostName: hostname().replace(/\.local$/, ''),
      devices: {},
    };
    // Device tokens are credentials: each one lets a device type into this Mac.
    writeFileSync(FILE, JSON.stringify(created, null, 2) + '\n', { mode: 0o600 });
    return { ...created, path: FILE, isNew: true };
  }
  const config = JSON.parse(readFileSync(FILE, 'utf8'));
  return { port: 8777, hostName: hostname(), devices: {}, ...config, path: FILE, isNew: false };
}

/// Records a freshly paired device. Rewrites the whole file because it is a few
/// lines and a partial write here would lock everything out.
export function rememberDevice(config, token, name) {
  config.devices[token] = { name, pairedAt: new Date().toISOString() };
  const { path, isNew, ...persisted } = config;
  writeFileSync(FILE, JSON.stringify(persisted, null, 2) + '\n', { mode: 0o600 });
}

export function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}
