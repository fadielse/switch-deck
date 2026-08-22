/// The tablet sends a macro id and nothing else. It can never send a raw key
/// sequence or a shell string — that is what keeps the attack surface equal to
/// "the macros the user defined" rather than "anything at all" (risk R5).
export const MACROS = {
  copy: {
    label: 'Copy',
    hint: '⌘C',
    frames: [
      { t: 'k', code: 8, d: 1, flags: ['cmd'] },
      { t: 'k', code: 8, d: 0, flags: ['cmd'] },
    ],
  },
};

export function describeMacros() {
  return Object.entries(MACROS).map(([id, m]) => ({ id, label: m.label, hint: m.hint }));
}
