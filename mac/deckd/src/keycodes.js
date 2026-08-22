/// Name to macOS virtual keycode. Only what a deck shortcut plausibly needs —
/// the keyboard itself carries its own table in the client, because it types
/// characters rather than naming keys.
export const KEYCODES = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12,
  w: 13, e: 14, r: 15, y: 16, t: 17, o: 31, u: 32, i: 34, p: 35, l: 37, j: 38,
  k: 40, n: 45, m: 46,
  1: 18, 2: 19, 3: 20, 4: 21, 5: 23, 6: 22, 7: 26, 8: 28, 9: 25, 0: 29,
  '-': 27, '=': 24, '[': 33, ']': 30, '\\': 42, ';': 41, "'": 39, ',': 43,
  '.': 47, '/': 44, '`': 50,
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111
};

export const MODIFIERS = { cmd: 55, command: 55, shift: 56, opt: 58, option: 58, alt: 58, ctrl: 59, control: 59 };
export const MODIFIER_FLAG = { cmd: 'cmd', command: 'cmd', shift: 'shift', opt: 'opt', option: 'opt', alt: 'opt', ctrl: 'ctrl', control: 'ctrl' };

/// Splits ["cmd","shift","4"] into the modifiers to hold and the key to strike.
export function parseCombo(keys) {
  const mods = [];
  let key = null;
  for (const raw of keys) {
    const name = String(raw).toLowerCase();
    if (MODIFIERS[name] !== undefined) mods.push(name);
    else if (KEYCODES[name] !== undefined) key = name;
    else return null;
  }
  return key === null ? null : { mods, key };
}
