# Contributing to SwitchDeck

Thanks for taking a look. This is a small, opinionated project: a tablet as a
control surface for a computer, not a remote desktop. Before proposing
something large, it is worth reading the anti-goals at the end of this file —
several obvious-looking features are deliberately absent.

## Getting set up

```bash
git clone https://github.com/fadielse/switch-deck.git
cd switch-deck
make build      # compile the Swift injector
make deps       # Node dependencies for the server
make doctor     # check Accessibility and print the process chain
make deckd      # run it
```

Full instructions, including macOS permissions, are in the
[README](README.md) ([Bahasa Indonesia](README.id.md)).

## The shape of the thing

```
Tablet (browser)  ──WebSocket──▶  deckd (Node)  ──stdin JSON──▶  deckd-input (Swift)  ──▶  macOS
```

| Layer | Responsibility | Rule |
|---|---|---|
| `mac/deckd/web/index.html` | the entire client | one file, no build step |
| `mac/deckd/src/` | routing, tokens, deck, validation | **must not call any OS API** |
| `mac/deckd-input/` | input injection | the only platform-specific code |

That middle rule is what will let a Windows host exist one day without
touching the other two layers. Reaching for `pbpaste` or `osascript` in the
server is the exact shortcut that breaks it.

Two more that are not negotiable:

- **The tablet sends an id, never a command.** It never learns what a deck
  button actually does. New capabilities go through an allowlist keyed by id.
- **Every frame is validated in `deckd`** before being passed on — bad
  numbers, out-of-range keycodes, unknown modifiers and over-long text are
  rejected rather than quietly repaired.

## Before you open a pull request

```bash
make client     # client checks: no Mac, no build, no permissions needed
make e2e        # the full chain, using a stub injector
make dblclick   # click-count check (needs Accessibility)
make docs       # regenerate the HTML documentation
```

All of them must pass, and `make docs` must leave no uncommitted changes.

### Documentation is part of the change

If your change alters behaviour, a setting, a protocol frame, a `deck.json`
field or a `make` target, update **both** READMEs in the same commit and run
`make docs`. `README.md` is English and primary; `README.id.md` is the
Indonesian version and should not be allowed to fall behind.

A commit that changes behaviour and leaves the README describing the old
behaviour is worse than no commit at all — the next person trusts the
document and is wrong because of it.

### Tests

New behaviour needs a test that would fail without it. Two things this
project cares about more than most:

- **Make a new test fail on purpose once** before trusting it. Two checks
  here once passed for months because `undefined?.host === undefined` is
  true and the fixture had never loaded.
- **Test the real code, not a copy of it.** `test/idle.js` and
  `test/debugpanel.js` lift the actual functions out of `web/index.html`
  rather than duplicating the logic, because a copy keeps passing while the
  original rots.

Anything that touches macOS should also be tried once against the real
`deckd-input` binary by hand — stubs prove routing, not behaviour.

### Translations

The UI ships in English and Bahasa Indonesia. Both dictionaries in
`web/index.html` must have **identical key sets**; `make debug-panel` fails
if they diverge or an English string is empty. A half-translated fallback
produces a screen in two languages at once, which is worse than one language
throughout.

Mark static text with `data-i18n` in the markup rather than adding it to a
list in JavaScript. Never name a variable `t` — it shadows the translation
function, and the failure is silent.

Deck page names and button labels in a user's `deck.json` are **not**
translated; they belong to whoever wrote them.

### Screenshots

`docs/img/en/` and `docs/img/id/` hold one set per language. If your change
alters what the client looks like, retake the affected ones.

They are taken from a genuinely running client — a `deckd` started against a
throwaway `SWITCHDECK_CONFIG_DIR`, paired for real, then driven from a copy
of `index.html` that forces the state being captured. Mockups are not
acceptable: they lie in the small details that confuse people most.

Do not let a preview inherit state. All `file://` pages share one origin, so
a preview that switched on the debug panel leaves it on for every screenshot
taken afterwards.

## Commit messages

Explain **why**, not what — the diff already says what. If you found a trap,
write it down; the next person will hit the same one. Reference the symptom
that led you there when a fix is not self-evident.

## Anti-goals

Deliberately out of scope. A pull request for one of these will be declined,
however well written:

- **Screen mirroring or remote desktop.** The computer's screen is never sent
  to the tablet. Use Universal Control or VNC for that.
- **Use over the internet.** This is built for one local network.
- **Accounts, cloud sync, multi-user.** It is one person's desk.
- **A home-grown encryption protocol.** If TLS is needed, use TLS.
- **Automatic clipboard sync.** Password managers put passwords on the
  clipboard; copying that between machines unasked is a leak nobody sees
  until it is too late. The clipboard courier stays manual, both ways.
- **A visual deck editor**, until hand-editing `deck.json` is genuinely in
  the way.

## Things already investigated — don't redo them without new evidence

- **Pinch to zoom and rotate.** macOS ignores synthetic magnify and rotate
  events. Measured: 47 magnify events posted with the cursor correctly placed
  and the target frontmost, zero reaction. The code was written, tested and
  removed.
- **Mission Control hotkeys via synthetic keystrokes.** Ignored the same way.
  Switching desktops and App Exposé go through AppleScript System Events
  instead, which works.
- **`timeout`** does not exist on macOS. Three verification runs once produced
  empty output that looked exactly like a clean negative result.

## Reporting a bug

Turn on **Settings → Debug → Debug panel** and include what it shows —
especially the `connection` group, and `crossing failed` or `injector
refused` if either appears. `injector refused` almost always means that
machine was pulled but not rebuilt (`make build`).
