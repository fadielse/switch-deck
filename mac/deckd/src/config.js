import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

// Overridable so tests get their own directory. Without it every `make e2e`
// wrote device tokens into the real config and clobbered the pairing code file
// with a code belonging to a server that then exited.
/// os.hostname() can be the IP address, depending on how the machine got its
/// name from DHCP — which is exactly what happened here, and why the tablet was
/// showing "192.168.1.213" as a host label. macOS keeps the friendly name
/// somewhere else.
function machineName() {
  for (const key of ['ComputerName', 'LocalHostName']) {
    try {
      const value = execFileSync('scutil', ['--get', key], { encoding: 'utf8' }).trim();
      if (value) return value;
    } catch { /* fall through */ }
  }
  return hostname();
}

const looksLikeAddress = (name) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(name ?? ''));

const DIR = process.env.SWITCHDECK_CONFIG_DIR || join(homedir(), '.config', 'switchdeck');
const FILE = join(DIR, 'config.json');

/// Decision K5: there is no unauthenticated mode, not even for a first try.
/// A missing config is filled in with a fresh token rather than skipped.
export function loadConfig() {
  if (!existsSync(FILE)) {
    mkdirSync(DIR, { recursive: true });
    // hostName is not persisted: it is derived every start, so a machine that
    // gets renamed does not keep announcing its old name forever. Setting it in
    // the file by hand still wins.
    const created = { port: 8777, devices: {} };
    // Device tokens are credentials: each one lets a device type into this Mac.
    writeFileSync(FILE, JSON.stringify(created, null, 2) + '\n', { mode: 0o600 });
    return { ...created, path: FILE, isNew: true };
  }
  const config = JSON.parse(readFileSync(FILE, 'utf8'));
  // An older config may have the IP baked in from when hostname() was trusted.
  if (looksLikeAddress(config.hostName)) delete config.hostName;
  return { port: 8777, devices: {}, ...config, hostName: config.hostName || machineName(), path: FILE, isNew: false };
}

/// Removes a device by its public handle. Returns the token that was dropped,
/// so the caller can hang up whatever that device still has open — a revoked
/// device that keeps its existing socket is not actually revoked.
export function forgetDevice(config, matches) {
  const token = Object.keys(config.devices).find(matches);
  if (!token) return null;
  delete config.devices[token];
  const { path, isNew, hostName, ...persisted } = config;
  writeFileSync(FILE, JSON.stringify(persisted, null, 2) + '\n', { mode: 0o600 });
  return token;
}

/// Records a freshly paired device. Rewrites the whole file because it is a few
/// lines and a partial write here would lock everything out.
export function rememberDevice(config, token, name) {
  config.devices[token] = { name, pairedAt: new Date().toISOString() };
  const { path, isNew, hostName, ...persisted } = config;
  writeFileSync(FILE, JSON.stringify(persisted, null, 2) + '\n', { mode: 0o600 });
}

/// Tailscale hands out addresses from the carrier-grade NAT range. A tablet
/// reaching deckd on one of those is going through Tailscale — and if the two
/// devices cannot reach each other directly, through a DERP relay that may be
/// in another country. That is worth saying out loud: it cost this project
/// hours of chasing wifi theories when every packet was going to Singapore and
/// back.
export function isTailscaleAddress(address) {
  const m = /^100\.(\d+)\./.exec(String(address ?? ''));
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

export function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}
