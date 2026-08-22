import { execFile } from 'node:child_process';
import { KEYCODES, MODIFIERS, MODIFIER_FLAG, parseCombo } from './keycodes.js';

/// A chord has to be held, not just ordered. Sending press and release back to
/// back gives macOS a few milliseconds of the modifier being down, which is not
/// enough for it to read as a chord — the verified Cmd+Tab case held Command
/// for hundreds of milliseconds. So the frames are spread out in time.
const HOLD_BEFORE = 70;
const HOLD_KEY = 60;
const HOLD_AFTER = 60;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function shortcut(send, keys) {
  const combo = parseCombo(keys);
  if (!combo) throw new Error('kombinasi tombol tidak dikenal: ' + JSON.stringify(keys));
  const flags = combo.mods.map((m) => MODIFIER_FLAG[m]);
  const code = KEYCODES[combo.key];

  for (const m of combo.mods) send({ t: 'k', code: MODIFIERS[m], d: 1 });
  if (combo.mods.length) await delay(HOLD_BEFORE);
  send({ t: 'k', code, d: 1, ...(flags.length ? { flags } : {}) });
  await delay(HOLD_KEY);
  send({ t: 'k', code, d: 0, ...(flags.length ? { flags } : {}) });
  if (combo.mods.length) {
    await delay(HOLD_AFTER);
    for (const m of combo.mods.slice().reverse()) send({ t: 'k', code: MODIFIERS[m], d: 0 });
  }
}

function spawnQuiet(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, _out, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve();
    });
  });
}

/// Every action is a shape from the config file, never a string from the
/// tablet. `shell` takes a command and an argument array rather than a command
/// line, so nothing here is ever handed to a shell to re-parse.
export async function runAction(action, send) {
  switch (action?.type) {
    case 'shortcut':
      return shortcut(send, action.keys ?? []);
    case 'text':
      send({ t: 'txt', s: String(action.text ?? '') });
      return;
    case 'media':
      send({ t: 'media', media: Number(action.code), d: 1 });
      send({ t: 'media', media: Number(action.code), d: 0 });
      return;
    case 'open_app':
      return spawnQuiet('open', ['-a', String(action.app)]);
    case 'url':
      return spawnQuiet('open', [String(action.url)]);
    case 'applescript':
      return spawnQuiet('osascript', ['-e', String(action.script)]);
    case 'shell':
      return spawnQuiet(String(action.command), (action.args ?? []).map(String));
    default:
      throw new Error('tipe action tidak dikenal: ' + action?.type);
  }
}
