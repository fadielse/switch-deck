import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/// A six-digit code is a million possibilities, which is nothing to a machine
/// on the same wifi. It is only safe because of two things here: it is
/// exchanged ONCE for a long per-device token and then never used again, and
/// wrong guesses are throttled hard enough that sweeping the space would take
/// months.
export function newCode() {
  // Uniform over 000000-999999; the modulo bias of randomBytes % 1e6 is small
  // but there is no reason to accept it.
  let value;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= 4294000000);
  return String(value % 1000000).padStart(6, '0');
}

/// A stable public handle for a device, so the tablet can name one to revoke
/// without ever being shown another device's token.
export function publicId(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 10);
}

export function newToken() {
  return randomBytes(24).toString('hex');
}

/// Constant time, so a wrong guess reveals nothing through how long it took.
export function sameSecret(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

const FREE_TRIES = 3;        // typos happen
const BASE_DELAY = 2000;     // then it doubles
const MAX_DELAY = 5 * 60_000;

export class Throttle {
  constructor() { this.byAddress = new Map(); }

  /// Milliseconds the caller must still wait, or 0 if it may try now.
  retryAfter(address) {
    const entry = this.byAddress.get(address);
    if (!entry || entry.failures <= FREE_TRIES) return 0;
    const wait = Math.min(BASE_DELAY * 2 ** (entry.failures - FREE_TRIES - 1), MAX_DELAY);
    return Math.max(0, entry.last + wait - Date.now());
  }

  fail(address) {
    const entry = this.byAddress.get(address) ?? { failures: 0, last: 0 };
    entry.failures += 1;
    entry.last = Date.now();
    this.byAddress.set(address, entry);
    return entry.failures;
  }

  succeed(address) { this.byAddress.delete(address); }
}
