# SwitchDeck

Turn a tablet into a trackpad, keyboard and macro deck for the machines on your desk.
Currently targets macOS (MacBook + Mac mini); a mini PC is planned, which is why the
name is OS-neutral and all platform-specific code is confined to `deckd-input`.

Design docs live in the Obsidian vault, not here:

- `10-projects/SwitchDeck.md` — architecture, protocol, decisions K1-K10, risks R1-R5
- `10-projects/SwitchDeck - Roadmap Fase 0-9.md` — phases and their DoD
- `10-projects/SwitchDeck - Status.md` — read this first in a new session

## Layout

```
mac/deckd-input/    Swift binary — the only OS-specific piece (CGEvent injection)
tools/browser-check/  Standalone page to probe what the tablet's browser supports
```

`deckd` (the Bun/Node server) and the web client arrive in F1.

## Phase F1 — one button, end to end (done)

Closed 2026-08-22: `make verify-copy` watched a planted sentinel get replaced
by text selected on the Mac after a tap on the tablet.

```sh
make deckd      # start the server; prints the URL to open on the tablet
make e2e        # chain test: WebSocket -> deckd -> deckd-input
```

`deckd` serves the client, holds the WebSocket and drives `deckd-input` over a
pipe. A token is generated into `~/.config/switchdeck/config.json` (mode 0600)
on first run and required on every connection — there is no unauthenticated
mode, since this server types into your Mac.

The tablet sends a macro **id**, never a key sequence or a command string. That
is what bounds the damage an attacker on your LAN could do to "the macros you
defined" instead of "anything at all".

## Phase F0 — prove CGEvent works (done)

F0 deliberately produces nothing visual. Its whole job is to kill the biggest risk
before any UI exists: if relative mouse deltas can't be injected correctly, the
whole plan is void.

```sh
make build      # compile deckd-input
make doctor     # which app needs the Accessibility grant, and is it granted?
make selftest   # automated proof that events really reach macOS
```

### Permission gotcha

macOS attributes a CLI tool's permission request to the **app that launched it**,
not the binary itself. So grant Accessibility to your terminal (Terminal.app,
iTerm, VS Code — whichever you run `make` from), then fully quit and reopen it.
`make check` exits non-zero until that's done, and without it macOS drops every
event silently — no error, just nothing happening.

### Self-test

`make selftest` asserts against a `CGEventTap` rather than against eyeballs. It
checks that the cursor moves by exactly the requested amount, that
`mouseEventDeltaX/Y` survive into the event stream (risk R1), that keycode
events arrive, and that text sent via `keyboardSetUnicodeString` arrives intact.
Its probes are swallowed at the tap and the cursor is restored, so running it
never types into whatever window happens to be focused.

What it cannot prove: whether an app that reads raw deltas *interprets* them
correctly. That still needs a human with Blender or Figma open.

### F0 acceptance

```sh
make type       # focus TextEdit within 3s; text should appear
make move       # cursor traces a square
make click      # single left click
make cmd-c      # Cmd+C via modifier flags
make serve      # serve the browser check page to the tablet on your LAN
```

Still needs a human:

- [x] Injection path proven end to end — `make selftest`, 4/4
- [x] Browser check run on the Huawei tablet (Chrome/Android, `touch-action:
      none` holds, 5 touch points, fullscreen works)
- [ ] Re-run the browser check with a single finger — the first two runs used
      a rate counter that spanned multiple gestures, so the Hz figure is not
      trustworthy yet
- [x] **R1 closed** — `make r1` read 16 events at exactly 7/5, and the summed
      movement over an out-and-back probe was exactly (0, 0). A perfect
      cancellation means macOS passes our deltas through untouched; pointer
      acceleration would have made the two bursts disagree.

## Protocol (stdin, JSON Lines)

One frame per line. This is the contract a future Windows/Linux `deckd-input`
must also honour.

| Frame | Meaning |
|---|---|
| `{"t":"m","dx":3,"dy":-2}` | relative mouse move |
| `{"t":"b","btn":"l","d":1}` | button down/up — `l`/`r`/`m` |
| `{"t":"k","code":8,"d":1,"flags":["cmd"]}` | key by virtual keycode |
| `{"t":"txt","s":"halo"}` | type literal text |
| `{"t":"ping","ts":123}` | latency probe, answered with `pong` |

Scroll (`s`) lands in F2, the full keycode table in F3.
