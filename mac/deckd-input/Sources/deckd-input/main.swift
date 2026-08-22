import CoreGraphics
import Foundation

// deckd-input — reads JSON Lines on stdin, injects input events into macOS.
//
// Phase F0 scope: frames "m" (relative move), "b" (button), "k" (keycode) and
// "txt" (literal text), plus "ping". Scroll and the full keycode table belong
// to F2/F3 — see the roadmap note in the vault.

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
}

let arguments = Set(CommandLine.arguments.dropFirst())

if arguments.contains("--prompt") {
    // Opens the system dialog that deep-links into Privacy & Security.
    let trusted = Injector.isTrusted(prompting: true)
    emit(["t": "trust", "trusted": trusted])
    exit(trusted ? 0 : 1)
}

if arguments.contains("--r1-emit") {
    // Repeating bursts, not one shot: the user needs time to click into the
    // page and grab the pointer lock, and a single burst makes that a race.
    let probe = Injector()
    let bursts = 6
    FileHandle.standardError.write("Kunci pointer di halaman delta-check sekarang.\n".data(using: .utf8)!)
    for burst in 1 ... bursts {
        FileHandle.standardError.write("  burst \(burst)/\(bursts) — 3 detik lagi...\n".data(using: .utf8)!)
        sleep(3)
        // Out and back, so the cursor ends where it started.
        for _ in 0 ..< 20 { probe.move(dx: 7, dy: 5); usleep(8_000) }
        for _ in 0 ..< 20 { probe.move(dx: -7, dy: -5); usleep(8_000) }
    }
    FileHandle.standardError.write("Selesai. Baca vonis di halaman itu.\n".data(using: .utf8)!)
    exit(0)
}

if arguments.contains("--selftest") {
    exit(Selftest.run())
}

if arguments.contains("--doctor") {
    Diagnostics.report()
    exit(Injector.isTrusted() ? 0 : 1)
}

if arguments.contains("--wait-trust") {
    Diagnostics.waitForTrust(timeout: 120)
}

if arguments.contains("--check") {
    let trusted = Injector.isTrusted()
    emit(["t": "trust", "trusted": trusted])
    exit(trusted ? 0 : 1)
}

let injector = Injector()
let trusted = Injector.isTrusted()

let refreshHz = CGDisplayCopyDisplayMode(CGMainDisplayID())?.refreshRate ?? 0

emit([
    "t": "ready",
    "trusted": trusted,
    "refreshHz": refreshHz > 0 ? refreshHz : 60,
    "hint": trusted
        ? "accessibility granted"
        : "no accessibility permission — events will be silently dropped by macOS; run with --prompt",
])

let decoder = JSONDecoder()

while let line = readLine(strippingNewline: true) {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { continue }

    guard let data = trimmed.data(using: .utf8),
          let frame = try? decoder.decode(Frame.self, from: data) else {
        emit(["t": "err", "msg": "bad frame", "raw": String(trimmed.prefix(120))])
        continue
    }

    switch frame.t {
    case "m":
        injector.move(dx: frame.dx ?? 0, dy: frame.dy ?? 0)

    case "s":
        injector.scroll(dx: frame.dx ?? 0, dy: frame.dy ?? 0)

    case "b":
        guard let raw = frame.btn, let button = MouseButton(rawValue: raw) else {
            emit(["t": "err", "msg": "unknown button", "btn": frame.btn ?? "nil"])
            continue
        }
        injector.button(button, down: (frame.d ?? 1) == 1)

    case "k":
        guard let code = frame.code else {
            emit(["t": "err", "msg": "missing keycode"])
            continue
        }
        injector.key(code: CGKeyCode(code),
                     down: (frame.d ?? 1) == 1,
                     flags: Injector.parseFlags(frame.flags))

    case "media":
        guard let code = frame.media else {
            emit(["t": "err", "msg": "missing media code"])
            continue
        }
        injector.media(Int32(code), down: (frame.d ?? 1) == 1)

    case "txt":
        injector.type(frame.s ?? "")

    case "ping":
        emit(["t": "pong", "ts": frame.ts ?? 0])

    default:
        emit(["t": "err", "msg": "unknown frame type", "type": frame.t])
    }
}
