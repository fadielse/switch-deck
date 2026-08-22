import { execFile } from 'node:child_process';

/// System actions the tablet may ask for by id — never by command string. Same
/// rule as macros (risk R5): the reachable surface is this table, not the
/// shell.
///
/// These exist because macOS ignores synthetic keystrokes for its own hotkeys.
/// Control+Up demonstrably reaches the frontmost app — a terminal prints
/// ^[[1;5A for it — but Mission Control never intercepts it first. Launching
/// the app does work, so that is the route.
const ACTIONS = {
  'mission-control': ['open', ['-a', 'Mission Control']],
  'launchpad': ['open', ['-a', 'Launchpad']],
  // Verified: mission-control. The other two follow the same pattern and are
  // very likely fine, but have not been seen working — say so rather than
  // assume it.
  'spotlight': ['open', ['-a', '/System/Library/CoreServices/Spotlight.app']]
};

export function runSystemAction(id) {
  const action = ACTIONS[id];
  if (!action) return false;
  execFile(action[0], action[1], (err) => {
    if (err) console.error('[deckd] aksi sistem gagal:', id, err.message);
  });
  return true;
}
