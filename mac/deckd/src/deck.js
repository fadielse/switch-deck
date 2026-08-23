import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Same override as config.js. It was missing here, so every `make e2e` read —
// and on a fresh machine would have written — the user's real deck. config.js
// was given this override when the test harness was found trampling real
// device tokens; deck.json sat in the same directory and was left behind.
const DIR = process.env.SWITCHDECK_CONFIG_DIR || join(homedir(), '.config', 'switchdeck');
const FILE = join(DIR, 'deck.json');

/// Seeded with apps that are actually installed, so the starter deck has no
/// dead buttons. Anything missing is dropped rather than shipped as a key that
/// does nothing when pressed.
function appPage() {
  const candidates = [
    ['Warp', 'Warp'], ['Visual Studio Code', 'VS Code'], ['Xcode', 'Xcode'],
    ['Obsidian', 'Obsidian'], ['Dia', 'Dia'], ['Telegram', 'Telegram'],
    ['Safari', 'Safari'], ['iTerm', 'iTerm']
  ];
  return candidates
    .filter(([app]) => existsSync(`/Applications/${app}.app`))
    .slice(0, 6)
    .map(([app, label]) => ({
      id: 'app-' + app.toLowerCase().replace(/\s+/g, '-'),
      label,
      action: { type: 'open_app', app }
    }));
}

function defaultDeck() {
  return {
    pages: [
      {
        name: 'Umum',
        keys: [
          { id: 'copy', label: 'Copy', hint: '⌘C', action: { type: 'shortcut', keys: ['cmd', 'c'] } },
          { id: 'paste', label: 'Paste', hint: '⌘V', action: { type: 'shortcut', keys: ['cmd', 'v'] } },
          { id: 'undo', label: 'Undo', hint: '⌘Z', action: { type: 'shortcut', keys: ['cmd', 'z'] } },
          { id: 'shot', label: 'Screenshot', hint: '⌘⇧4', action: { type: 'shortcut', keys: ['cmd', 'shift', '4'] } },
          { id: 'mission', label: 'Mission Control', color: '#2c405c', action: { type: 'open_app', app: 'Mission Control' } },
          { id: 'sleep', label: 'Tidurkan Layar', color: '#3a2440', action: { type: 'shell', command: 'pmset', args: ['displaysleepnow'] } }
        ]
      },
      {
        name: 'Media',
        keys: [
          { id: 'prev', label: '⏮', action: { type: 'media', code: 18 } },
          { id: 'play', label: '⏯', color: '#1d5c37', action: { type: 'media', code: 16 } },
          { id: 'next', label: '⏭', action: { type: 'media', code: 17 } },
          { id: 'vol-down', label: '🔉', action: { type: 'media', code: 1 } },
          { id: 'mute', label: '🔇', action: { type: 'media', code: 7 } },
          { id: 'vol-up', label: '🔊', action: { type: 'media', code: 0 } }
        ]
      },
      {
        name: 'Xcode',
        // `match` is what makes the deck follow the Mac: an app name or bundle
        // id, matched case-insensitively against whatever is frontmost.
        match: ['Xcode'],
        keys: [
          { id: 'xc-build', label: 'Build', hint: '⌘B', action: { type: 'shortcut', keys: ['cmd', 'b'] } },
          { id: 'xc-run', label: 'Run', hint: '⌘R', color: '#10331f', action: { type: 'shortcut', keys: ['cmd', 'r'] } },
          { id: 'xc-stop', label: 'Stop', hint: '⌘.', color: '#34181b', action: { type: 'shortcut', keys: ['cmd', '.'] } },
          { id: 'xc-clean', label: 'Clean', hint: '⇧⌘K', action: { type: 'shortcut', keys: ['cmd', 'shift', 'k'] } },
          { id: 'xc-open', label: 'Open Quickly', hint: '⇧⌘O', action: { type: 'shortcut', keys: ['cmd', 'shift', 'o'] } },
          { id: 'xc-nav', label: 'Navigator', hint: '⌘0', action: { type: 'shortcut', keys: ['cmd', '0'] } }
        ]
      },
      { name: 'App', keys: appPage() }
    ]
  };
}

function normalise(deck) {
  const pages = Array.isArray(deck?.pages) ? deck.pages : [];
  return {
    pages: pages.map((p, i) => ({
      name: String(p?.name ?? `Halaman ${i + 1}`),
      match: (Array.isArray(p?.match) ? p.match : []).map((m) => String(m).toLowerCase()),
      keys: (Array.isArray(p?.keys) ? p.keys : []).filter((k) => k && k.id && k.action)
    }))
  };
}

export class Deck {
  constructor({ onChange } = {}) {
    this.onChange = onChange ?? (() => {});
    this.deck = { pages: [] };
    this.path = FILE;
  }

  load() {
    if (!existsSync(FILE)) {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(defaultDeck(), null, 2) + '\n');
      this.isNew = true;
    }
    try {
      this.deck = normalise(JSON.parse(readFileSync(FILE, 'utf8')));
      this.error = null;
    } catch (err) {
      // Keep serving the last good deck: a typo while editing should not empty
      // the tablet's screen.
      this.error = err.message;
      console.error('[deckd] deck.json tidak bisa dibaca:', err.message);
    }
    return this.deck;
  }

  watch() {
    let pending = null;
    watch(dirname(FILE), (_event, name) => {
      if (name !== 'deck.json') return;
      // Editors write in bursts; settle before re-reading.
      clearTimeout(pending);
      pending = setTimeout(() => {
        this.load();
        console.log('[deckd] deck.json dimuat ulang');
        this.onChange(this.describe());
      }, 150);
    });
  }

  /// What the tablet needs to draw. Actions stay on this side — the tablet gets
  /// ids and labels, never anything executable.
  describe() {
    return {
      pages: this.deck.pages.map((p) => ({
        name: p.name,
        match: p.match,
        // `host` names another machine this button should run on. It is not an
        // action and never becomes one: the tablet still sends nothing but an
        // id, and the machine it is sent to looks that id up in ITS OWN
        // deck.json. Each machine stays the authority on what its ids mean.
        keys: p.keys.map((k) => ({
          id: k.id,
          label: k.label ?? k.id,
          hint: k.hint,
          color: k.color,
          host: typeof k.host === 'string' && k.host.trim() ? k.host.trim() : undefined
        }))
      })),
      error: this.error ?? null
    };
  }

  /// Which page wants this application, or -1. Both the visible name and the
  /// bundle id are checked, since a config is easier to write with names but
  /// bundle ids are what actually disambiguate.
  pageFor(front) {
    if (!front) return -1;
    const name = String(front.app || '').toLowerCase();
    const bundle = String(front.bundle || '').toLowerCase();
    return this.deck.pages.findIndex((p) =>
      p.match.some((m) => m === name || m === bundle));
  }

  find(id) {
    for (const page of this.deck.pages) {
      const key = page.keys.find((k) => k.id === id);
      if (key) return key;
    }
    return null;
  }
}
