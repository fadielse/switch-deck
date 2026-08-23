# CLAUDE.md — rules for agents working on SwitchDeck

Read this before changing anything. Every rule here was paid for by a real
mistake in this repository, not copied from a template.

---

## 0. The one rule that is never optional

**Documentation is part of the change, not a follow-up.**

Any change that alters behaviour, a setting, a protocol frame, a `deck.json`
field, a `make` target, or anything a person can see **must** update the
documentation in the same commit:

1. `README.md` (English — the primary one)
2. `README.id.md` (Bahasa Indonesia — keep it in step, not a stale copy)
3. `make docs` to regenerate `docs/index.html` and `docs/id.html`

A commit that changes behaviour and leaves the README describing the old
behaviour is worse than no commit: the next person trusts the document and
is wrong because of it.

If a screenshot no longer matches what the app does, retake it. Instructions
in [CONTRIBUTING.md](CONTRIBUTING.md) under "Screenshots".

---

## 1. Boundaries that must not move

These are load-bearing. Breaking one is a redesign, not a patch — say so and
stop rather than working around it.

- **The tablet sends an id, never a command.** It never learns what a deck
  button's `action` contains. Anything new that reaches the OS goes through
  an allowlist (`src/system.js`) keyed by id.
- **`deckd` (Node) never touches an OS API.** Everything platform-specific
  lives in `deckd-input` (Swift). This is what makes a Windows host possible
  later without disturbing the other two layers. `pbpaste` in the server is
  the exact kind of shortcut that breaks it.
- **The tablet owns every connection; hosts never talk to each other.** One
  host going down must not take the others with it.
- **Validate every frame in `deckd` before passing it on.** Non-finite
  numbers, out-of-range keycodes, unknown modifier names, over-long text:
  rejected, not quietly repaired. `Int64(Double.nan)` is a hard trap in
  Swift, so the guard exists on both sides.
- **Never write to the user's real config from a test.** Honour
  `SWITCHDECK_CONFIG_DIR`. This leaked twice: once for `config.json` (real
  device tokens overwritten) and again months later for `deck.json`, because
  the first fix did not sweep the whole directory.

---

## 2. Tests

Run before every commit:

```bash
make client     # no Mac, no build, no permission needed
make e2e        # full chain through a stub injector
make dblclick   # needs Accessibility
```

- **A check that cannot fail for the intended reason is not a check.** Two
  checks once passed because `undefined?.host === undefined` is true — the
  deck under test had never loaded. When a new test passes on the first run,
  make it fail on purpose once before trusting it.
- **Prefer testing the real thing over a copy.** `test/idle.js` and
  `test/debugpanel.js` lift the actual functions out of `web/index.html`. A
  pasted copy of the logic keeps passing while the page rots.
- **Stubs prove routing; they do not prove behaviour.** Anything that touches
  macOS must also be tried against the real `deckd-input` binary at least
  once, by hand, and the result written down.

---

## 3. Verifying things on macOS

- **`timeout` does not exist on macOS.** Three verification runs once
  produced empty output that looked exactly like a clean negative result,
  because the command never ran and the error was swallowed by a pipe. Read
  what a command actually printed before drawing a conclusion from silence.
- **Reaching the event stream is not the same as being acted upon.** macOS
  ignores synthetic events for several of its own recognisers. Proven twice:
  Mission Control hotkeys, and magnify/rotate (47 events posted, zero
  reaction). Do not re-attempt pinch/zoom without new evidence.
- **When a probe fails, test the control too.** A negative result from an
  instrument that cannot measure is not a result. A Finder icon-size oracle
  once "disproved" a working mechanism because Finder does not respond to
  that input at all.
- **Anything visual must be looked at.** Screenshots have caught bugs reading
  the code did not: a keyboard that floated up instead of dropping down, a
  bar reading "SwitchDeck SwitchDeck", a settings value stuck in the old
  language. See CONTRIBUTING.md for how to drive the client for screenshots.
- **`file://` pages share one origin.** A preview that writes `localStorage`
  changes every other preview opened afterwards. Force the state you are
  testing; never inherit it.

---

## 4. Changes that reach further than they look

- **A shared CSS class is shared.** Making `.gear` a fixed square for the
  header flattened the settings buttons that reuse it. Scope to the place you
  mean (`header .gear`), or make a new class.
- **A feature spanning two machines spans two binaries.** A `git pull`
  without `make build` leaves an old injector that answers "unknown frame
  type" — which used to reach only that Mac's console. Version mismatch must
  be visible from the tablet, or the symptom lands halfway between "broken
  feature" and "no feature".
- **Anything that samples must sample only while it is being read.** A loop
  that runs for data nobody reads is how the tablet got warm with nothing
  wrong. The debug panel and the status view both stop when closed.

---

## 5. Language and text

- **Two complete dictionaries.** `I18N.id` and `I18N.en` must have identical
  key sets; `make debug-panel` fails otherwise. A half-filled fallback
  produces a screen in two languages, which is worse than one language.
- **Static text is marked in the markup** with `data-i18n`, so there is no
  second list of selectors to go stale.
- **Changing language redraws what is already on screen.** Anything not
  redrawn keeps the old language until something happens to touch it.
- **Never name a variable `t`.** It shadows the translation function and the
  failure is silent: the text comes out as raw keys.
- **What is ours versus what is theirs:** UI text is ours and is translated.
  `deck.json` labels are the user's and are never touched — *except* the
  starter deck, which we write, so it ships in English.
- Hosts are **devices**, not "Macs" — the next planned host is not a Mac.
  Paired tablets and phones are called that in full, because "device" cannot
  mean two things on one screen.

---

## 6. Style

- Comments explain **why**, especially where the obvious approach is wrong.
  Prefer one sentence of reasoning over three of description.
- Match the surrounding code: `var` and `function` in `web/index.html`, ES
  modules in `src/`, plain Swift in `deckd-input`.
- Indonesian is fine in comments and journal prose. **UI strings go through
  the dictionary**; user-facing docs exist in both languages.
- Do not delete a user's file. Back it up first and say where it went.

---

## 7. Where things live

```
mac/deckd/src/        server: routing, tokens, deck, validation (no OS calls)
mac/deckd/web/        the whole client, one file
mac/deckd/test/       chain + client tests
mac/deckd-input/      Swift injector — the only OS-specific code
scripts/build-docs.py README -> docs/*.html
docs/img/{en,id}/     screenshots, one set per language
```

Deeper history and the reasoning behind decisions live in the author's vault
(`SwitchDeck.md`, `SwitchDeck - Journal.md`), not in this repository.
