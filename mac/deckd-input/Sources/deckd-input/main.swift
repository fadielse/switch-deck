import AppKit
import CoreGraphics
import Foundation

// deckd-input — reads JSON Lines on stdin, injects input events into macOS.
//
// Phase F0 scope: frames "m" (relative move), "b" (button), "k" (keycode) and
// "txt" (literal text), plus "ping". Scroll and the full keycode table belong
// to F2/F3 — see the roadmap note in the vault.

setvbuf(stdout, nil, _IOLBF, 0)

// stdout is written from the stdin reader and from the workspace observer on
// two different threads; interleaved writes would produce torn lines.
let outputQueue = DispatchQueue(label: "deckd-input.stdout")

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8) else { return }
    outputQueue.sync { print(line) }
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

if arguments.contains("--dblclick-test") {
    // macOS does not time clicks and decide for itself — the click count rides
    // IN the event, as kCGMouseEventClickState, and AppKit turns that field
    // into NSEvent.clickCount. An injector that always writes 1 can never
    // produce a double click, however fast the taps arrive. That was the bug.
    //
    // Reading the field back off the stream is what proves the fix, and it does
    // not depend on hunting for an icon's screen coordinates: the question is
    // what the event says, and the event is right here.
    // A class, not an inout Array: passing &array as userInfo hands the tap a
    // pointer to a value type whose buffer can move, and reinterpreting it is
    // undefined — it crashed outright the first time.
    final class Box { var states: [Int64] = [] }
    let box = Box()
    let mask = CGEventMask(1 << CGEventType.leftMouseDown.rawValue)
        | CGEventMask(1 << CGEventType.leftMouseUp.rawValue)
    guard let tap = CGEvent.tapCreate(
        tap: .cghidEventTap, place: .headInsertEventTap, options: .listenOnly,
        eventsOfInterest: mask,
        callback: { _, _, event, ctx in
            if let ctx {
                Unmanaged<Box>.fromOpaque(ctx).takeUnretainedValue()
                    .states.append(event.getIntegerValueField(.mouseEventClickState))
            }
            return Unmanaged.passUnretained(event)
        }, userInfo: Unmanaged.passUnretained(box).toOpaque()) else {
        FileHandle.standardError.write("tap gagal — butuh izin Accessibility\n".data(using: .utf8)!)
        exit(2)
    }
    let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    func pump(_ s: Double) { CFRunLoopRunInMode(.defaultMode, s, false) }

    let injector = Injector()
    // Somewhere harmless: the clicks must land on nothing in particular, since
    // this measures the event rather than an app's reaction to it.
    let screen = CGDisplayBounds(CGMainDisplayID())
    CGWarpMouseCursorPosition(CGPoint(x: screen.midX, y: screen.maxY - 2))
    pump(0.3)

    func tapOnce() {
        injector.button(.left, down: true); pump(0.03)
        injector.button(.left, down: false); pump(0.05)
    }

    var failures = 0
    func check(_ ok: Bool, _ label: String, _ detail: String = "") {
        if !ok { failures += 1 }
        let line = (ok ? "[PASS] " : "[FAIL] ") + label + (detail.isEmpty ? "" : " — " + detail)
        FileHandle.standardError.write((line + "\n").data(using: .utf8)!)
    }

    box.states.removeAll()
    tapOnce(); tapOnce()
    pump(0.4)
    let fast = box.states
    check(fast.count == 4, "dua tap cepat menghasilkan 4 event", "aktual \(fast.count)")
    check(fast.prefix(2).allSatisfy { $0 == 1 }, "tap pertama clickState = 1", "\(Array(fast.prefix(2)))")
    check(fast.dropFirst(2).allSatisfy { $0 == 2 }, "tap kedua clickState = 2 — INI yang bikin dobel klik",
          "\(Array(fast.dropFirst(2)))")

    // A third rapid tap is a triple click, and it should be — macOS counts to
    // three. Prove the counter climbs, then prove it resets.
    box.states.removeAll()
    tapOnce()
    pump(0.4)
    check(box.states.allSatisfy { $0 == 3 }, "tap ketiga cepat = triple click", "\(box.states)")

    // Slow enough to be two separate clicks, which must NOT become a double.
    pump(NSEvent.doubleClickInterval + 0.3)
    box.states.removeAll()
    tapOnce()
    pump(NSEvent.doubleClickInterval + 0.25)
    tapOnce()
    pump(0.4)
    check(box.states.allSatisfy { $0 == 1 }, "dua tap berjauhan tetap dua klik tunggal", "\(box.states)")

    FileHandle.standardError.write((failures == 0
        ? "\nclickState benar: 1,1 lalu 2,2.\n"
        : "\n\(failures) cek GAGAL.\n").data(using: .utf8)!)
    exit(failures == 0 ? 0 : 1)
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

// The clamp inside move() is the only thing that knows the screen ran out of
// room. Hand that upward as a frame so the tablet can decide it means "switch
// to the next machine".
injector.onEdge = { side, over, ratio in
    emit(["t": "edge", "side": side, "over": over, "ry": ratio])
}
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

/// Which application is in front, reported so the deck can follow it.
///
/// This is why the stdin loop moved off the main thread: NSWorkspace delivers
/// its notifications on a run loop, and readLine() blocks — so with both on
/// main, the notification would never arrive.
func reportFront(_ app: NSRunningApplication?) {
    guard let app else { return }
    emit([
        "t": "front",
        "app": app.localizedName ?? "",
        "bundle": app.bundleIdentifier ?? ""
    ])
}

NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification,
    object: nil,
    queue: .main
) { note in
    reportFront(note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
}

// Say what is in front now, so a client connecting later is not left blank
// until the next time the user switches apps.
reportFront(NSWorkspace.shared.frontmostApplication)

DispatchQueue.global(qos: .userInitiated).async {
    readStdin()
    exit(0)
}

RunLoop.main.run()

func readStdin() {
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

    case "clipget":
        // Never logged, here or anywhere upstream: the clipboard is where
        // password managers put passwords.
        if let text = injector.clipboardRead(limit: frame.limit ?? 16384) {
            emit(["t": "clip", "s": text])
        } else {
            emit(["t": "clip", "s": "", "empty": true])
        }

    case "clipset":
        injector.clipboardWrite(frame.s ?? "")
        emit(["t": "clipok", "n": (frame.s ?? "").count])

    case "warp":
        injector.warp(side: frame.side ?? "", ratio: frame.v ?? 0.5)

    case "txt":
        injector.type(frame.s ?? "")

    case "ping":
        emit(["t": "pong", "ts": frame.ts ?? 0])

    default:
        emit(["t": "err", "msg": "unknown frame type", "type": frame.t])
    }
}
}
