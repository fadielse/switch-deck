/// A trackpad has to forward raw motion, which is a wider door than F1's
/// macro-id-only rule. Everything that goes through it is validated here:
/// unknown frame types are dropped, and numbers are checked before they reach
/// Swift, where converting a NaN to Int64 is a hard crash rather than an error.

const MAX_DELTA = 400; // A single batched frame beyond this is a bug, not a gesture.
const BUTTONS = new Set(['l', 'r', 'm']);
const MODIFIERS = new Set(['cmd', 'command', 'shift', 'opt', 'option', 'alt', 'ctrl', 'control', 'fn']);
const MAX_KEYCODE = 127;   // macOS virtual keycodes stop well below this
const MAX_TEXT = 256;      // a keystroke's worth, not a paste buffer

/// Absent means zero — `{t:'s',dy:4}` is a legitimate vertical-only scroll.
/// Present but not a finite number means the sender is broken, and the frame is
/// dropped: JSON.stringify turns NaN into null, so a null here is exactly the
/// bug this guard exists for, not a missing field.
function delta(frame, key) {
  if (!(key in frame)) return 0;
  const n = frame[key];
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(n)));
}

export function toInputFrame(frame) {
  switch (frame?.t) {
    case 'm':
    case 's': {
      const dx = delta(frame, 'dx');
      const dy = delta(frame, 'dy');
      if (dx === null || dy === null) return null;
      if (dx === 0 && dy === 0) return null;
      return { t: frame.t, dx, dy };
    }
    case 'b': {
      if (!BUTTONS.has(frame.btn)) return null;
      if (frame.d !== 0 && frame.d !== 1) return null;
      return { t: 'b', btn: frame.btn, d: frame.d };
    }
    // F3 widens this door: a keyboard can, by definition, type anything. The
    // boundary stays the token — but the frame itself is still checked, since a
    // keycode out of range is a bug and an unbounded string is a denial of
    // service against the pipe.
    case 'k': {
      if (!Number.isInteger(frame.code) || frame.code < 0 || frame.code > MAX_KEYCODE) return null;
      if (frame.d !== 0 && frame.d !== 1) return null;
      let flags;
      if (frame.flags !== undefined) {
        if (!Array.isArray(frame.flags)) return null;
        flags = frame.flags.filter((f) => typeof f === 'string' && MODIFIERS.has(f.toLowerCase()));
        if (flags.length !== frame.flags.length) return null;
      }
      return flags?.length ? { t: 'k', code: frame.code, d: frame.d, flags }
                           : { t: 'k', code: frame.code, d: frame.d };
    }

    case 'txt': {
      if (typeof frame.s !== 'string' || !frame.s.length) return null;
      if (frame.s.length > MAX_TEXT) return null;
      return { t: 'txt', s: frame.s };
    }

    default:
      return null;
  }
}
