import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const FILE = join(homedir(), '.config', 'switchdeck', 'deck.json');

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
      { name: 'App', keys: appPage() }
    ]
  };
}

function normalise(deck) {
  const pages = Array.isArray(deck?.pages) ? deck.pages : [];
  return {
    pages: pages.map((p, i) => ({
      name: String(p?.name ?? `Halaman ${i + 1}`),
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
        keys: p.keys.map((k) => ({ id: k.id, label: k.label ?? k.id, hint: k.hint, color: k.color }))
      })),
      error: this.error ?? null
    };
  }

  find(id) {
    for (const page of this.deck.pages) {
      const key = page.keys.find((k) => k.id === id);
      if (key) return key;
    }
    return null;
  }
}
