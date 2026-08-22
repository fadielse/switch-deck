/// A trackpad has to forward raw motion, which is a wider door than F1's
/// macro-id-only rule. Everything that goes through it is validated here:
/// unknown frame types are dropped, and numbers are checked before they reach
/// Swift, where converting a NaN to Int64 is a hard crash rather than an error.

const MAX_DELTA = 400; // A single batched frame beyond this is a bug, not a gesture.
const BUTTONS = new Set(['l', 'r', 'm']);

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
    default:
      return null;
  }
}
