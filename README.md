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

## Current phase: F0 — prove CGEvent works

F0 deliberately produces nothing visual. Its whole job is to kill the biggest risk
before any UI exists: if relative mouse deltas can't be injected correctly, the
whole plan is void.

```sh
make build      # compile deckd-input
make check      # is this binary allowed to inject input?
make prompt     # open the Accessibility permission dialog
```

### Permission gotcha

macOS attributes a CLI tool's permission request to the **app that launched it**,
not the binary itself. So grant Accessibility to your terminal (Terminal.app,
iTerm, VS Code — whichever you run `make` from), then fully quit and reopen it.
`make check` exits non-zero until that's done, and without it macOS drops every
event silently — no error, just nothing happening.

### F0 acceptance

```sh
make type       # focus TextEdit within 3s; text should appear
make move       # cursor traces a square
make click      # single left click
make cmd-c      # Cmd+C via modifier flags
make serve      # serve the browser check page to the tablet on your LAN
```

Still needs a human:

- [ ] `make type` puts text in TextEdit
- [ ] `make move` moves the cursor
- [ ] **R1** — open something that reads raw deltas (Blender, a game, Figma pan)
      and confirm the movement is correct there, not just that the cursor moves
- [ ] Run the browser check page on the Huawei tablet and record the summary in
      the vault Status note

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
