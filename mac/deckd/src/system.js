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
  'spotlight': ['open', ['-a', '/System/Library/CoreServices/Spotlight.app']],

  // Moving between desktops goes through System Events, not CGEvent. macOS
  // ignores synthetic keystrokes for its own Mission Control shortcuts — tried
  // with six combinations of event source and injection point, and confirmed by
  // hand — but AppleScript reaches the same shortcuts through the accessibility
  // path, which does work. It needs Automation permission for whatever runs
  // deckd, which is granted separately from Accessibility.
  // Waking the display is not a keystroke — it is a declaration of user
  // activity, which is what caffeinate -u does. Works because this Mac never
  // system-sleeps (pmset sleep 0), so deckd is still running and reachable
  // while the screen is off. On a Mac that does sleep entirely, nothing here
  // would be listening and this would need Wake-on-LAN instead.
  'wake-display': ['caffeinate', ['-u', '-t', '1']],

  'space-left': ['osascript', ['-e', 'tell application "System Events" to key code 123 using control down']],
  'space-right': ['osascript', ['-e', 'tell application "System Events" to key code 124 using control down']],
  'app-expose': ['osascript', ['-e', 'tell application "System Events" to key code 125 using control down']]
};

export function runSystemAction(id) {
  const action = ACTIONS[id];
  if (!action) return false;
  execFile(action[0], action[1], (err) => {
    if (err) console.error('[deckd] aksi sistem gagal:', id, err.message);
  });
  return true;
}
