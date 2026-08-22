BIN := mac/deckd-input/.build/release/deckd-input
PORT ?= 8000

.PHONY: build doctor selftest wait-trust r1 deckd e2e verify-copy latency check prompt type move click cmd-c serve ip clean

build:
	swift build -c release --package-path mac/deckd-input

## Explain exactly which app needs the Accessibility grant, and why.
doctor: build
	@$(BIN) --doctor || true

## Automated proof that events really reach macOS. Restores the cursor and
## swallows its own probes, so it is safe to run any time.
selftest: build
	@$(BIN) --selftest

## Blocks until the permission is granted, so you get a clear confirmation.
wait-trust: build
	@$(BIN) --wait-trust

## Report whether this binary is allowed to inject input.
check: build
	@$(BIN) --check || (echo ">> Accessibility BELUM dikasih. Jalanin: make prompt"; exit 1)

## Opens the system permission dialog. Grant it to the terminal app you run this from.
prompt: build
	@$(BIN) --prompt || true

## F0 DoD #1 — text must appear in whatever window has focus.
type: build
	@echo '>> Fokus ke TextEdit dalam 3 detik...'
	@sleep 3
	@printf '{"t":"txt","s":"halo dari SwitchDeck"}\n' | $(BIN)

## F0 DoD #2 — cursor traces a square.
move: build
	@printf '%s\n' \
	  $$(for i in $$(seq 1 20); do echo '{"t":"m","dx":10,"dy":0}'; done) \
	  $$(for i in $$(seq 1 20); do echo '{"t":"m","dx":0,"dy":10}'; done) \
	  $$(for i in $$(seq 1 20); do echo '{"t":"m","dx":-10,"dy":0}'; done) \
	  $$(for i in $$(seq 1 20); do echo '{"t":"m","dx":0,"dy":-10}'; done) \
	  | $(BIN)

## R1 check — opens the pointer-lock page, then feeds it known deltas.
## Lock the pointer during the countdown; the page grades itself.
r1: build
	@open tools/delta-check/index.html
	@echo ">> Klik halaman yang kebuka buat KUNCI POINTER. Ada 6 burst, santai."
	@$(BIN) --r1-emit

click: build
	@printf '{"t":"b","btn":"l","d":1}\n{"t":"b","btn":"l","d":0}\n' | $(BIN)

## Keycode 8 = "c". Proves the modifier-flag path before F3 needs it.
cmd-c: build
	@printf '{"t":"k","code":8,"d":1,"flags":["cmd"]}\n{"t":"k","code":8,"d":0,"flags":["cmd"]}\n' | $(BIN)

## Run the SwitchDeck server (F1). Prints the URL to open on the tablet.
deckd: build
	@cd mac/deckd && npm start

## Chain test: does a macro sent over the WebSocket reach deckd-input?
e2e: build
	@cd mac/deckd && node test/chain.js

## F1 DoD — plant a sentinel, then watch the clipboard actually change.
## Run this in a second terminal while `make deckd` is up.
verify-copy:
	@node tools/watch-clipboard.mjs

## Measure what the server itself costs, over loopback and under load.
latency:
	@cd mac/deckd && node test/latency.js

## Serve the browser capability page to the tablet.
serve:
	@echo ">> Buka di tablet: http://$$(ipconfig getifaddr en0):$(PORT)/"
	@cd tools/browser-check && python3 -m http.server $(PORT)

ip:
	@ipconfig getifaddr en0

clean:
	rm -rf mac/deckd-input/.build
