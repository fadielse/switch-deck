/// The tablet sends a macro id and nothing else. It can never send a raw key
/// sequence or a shell string — that is what keeps the attack surface equal to
/// "the macros the user defined" rather than "anything at all" (risk R5).
///
/// Empty until F4, which is the phase that designs the deck properly: config
/// file, action types, pages. The placeholder Copy button that proved the chain
/// in F1 has done its job and been removed.
export const MACROS = {};

export function describeMacros() {
  return Object.entries(MACROS).map(([id, m]) => ({ id, label: m.label, hint: m.hint }));
}
