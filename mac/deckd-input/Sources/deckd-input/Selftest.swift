import CoreGraphics
import Foundation

/// Collects what an event tap actually observed, so the self-test can assert on
/// the real event stream rather than on "the cursor looked like it moved".
final class TapObserver {
    static let shared = TapObserver()
    var probeKeySeen = false
    var observedDeltas: [(Int64, Int64)] = []
    var typedText = ""
}

private let tapCallback: CGEventTapCallBack = { _, type, event, _ in
    let observer = TapObserver.shared
    switch type {
    case .keyDown:
        // F13 (105) is the probe: harmless, and we swallow it so no app sees it.
        let keycode = event.getIntegerValueField(.keyboardEventKeycode)
        if keycode == 105 {
            observer.probeKeySeen = true
            return nil
        }
        // Text typed via keyboardSetUnicodeString rides on keycode 0. Capture the
        // payload and swallow it, so the probe never lands in whatever window has
        // focus.
        if keycode == 0 {
            var length = 0
            var buffer = [UniChar](repeating: 0, count: 64)
            event.keyboardGetUnicodeString(maxStringLength: buffer.count,
                                           actualStringLength: &length,
                                           unicodeString: &buffer)
            if length > 0 {
                observer.typedText += String(utf16CodeUnits: buffer, count: length)
                return nil
            }
        }
    case .mouseMoved:
        observer.observedDeltas.append((
            event.getIntegerValueField(.mouseEventDeltaX),
            event.getIntegerValueField(.mouseEventDeltaY)
        ))
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

enum Selftest {
    private static func pump(_ seconds: Double) {
        CFRunLoopRunInMode(.defaultMode, seconds, false)
    }

    static func run() -> Int32 {
        guard Injector.isTrusted() else {
            print("SKIP — belum ada izin Accessibility. Jalanin: make doctor")
            return 2
        }

        let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.mouseMoved.rawValue)
        guard let tap = CGEvent.tapCreate(tap: .cghidEventTap,
                                          place: .headInsertEventTap,
                                          options: .defaultTap,
                                          eventsOfInterest: CGEventMask(mask),
                                          callback: tapCallback,
                                          userInfo: nil) else {
            print("FAIL — tidak bisa bikin event tap")
            return 1
        }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        pump(0.2)

        let injector = Injector()
        var failures = 0

        // --- 1. cursor actually moves, by the amount we asked for ---
        guard let origin = CGEvent(source: nil)?.location else {
            print("FAIL — tidak bisa baca posisi kursor")
            return 1
        }
        let step = (dx: 7.0, dy: 5.0)
        let repeats = 10
        for _ in 0 ..< repeats {
            injector.move(dx: step.dx, dy: step.dy)
            usleep(4_000)
        }
        pump(0.3)
        let after = CGEvent(source: nil)?.location ?? origin
        let movedX = after.x - origin.x
        let movedY = after.y - origin.y
        let wantX = step.dx * Double(repeats)
        let wantY = step.dy * Double(repeats)
        let moveOK = abs(movedX - wantX) < 2 && abs(movedY - wantY) < 2

        print("[\(moveOK ? "PASS" : "FAIL")] kursor pindah — minta (\(Int(wantX)), \(Int(wantY))), dapat (\(Int(movedX)), \(Int(movedY)))")
        if !moveOK { failures += 1 }

        // --- 2. R1: the delta fields survive into the event stream ---
        let deltaOK = TapObserver.shared.observedDeltas.contains {
            $0.0 == Int64(step.dx) && $0.1 == Int64(step.dy)
        }
        print("[\(deltaOK ? "PASS" : "FAIL")] R1 — field mouseEventDeltaX/Y kebaca di event stream sebagai (\(Int(step.dx)), \(Int(step.dy)))")
        if !deltaOK {
            failures += 1
            print("         delta yang keliatan: \(TapObserver.shared.observedDeltas.prefix(5))")
        }

        CGWarpMouseCursorPosition(origin)

        // --- 3. keyboard events reach the system event stream ---
        injector.key(code: 105, down: true, flags: [])
        injector.key(code: 105, down: false, flags: [])
        pump(0.3)
        let keyOK = TapObserver.shared.probeKeySeen
        print("[\(keyOK ? "PASS" : "FAIL")] key event nyampe ke event stream (F13 probe, ditelan biar nggak kena app manapun)")
        if !keyOK { failures += 1 }

        // --- 4. the text path uses a different API than keycodes, so prove it too ---
        let probe = "SDprobe42"
        injector.type(probe)
        pump(0.3)
        let textOK = TapObserver.shared.typedText.contains(probe)
        print("[\(textOK ? "PASS" : "FAIL")] teks unicode nyampe utuh (\"\(probe)\", ditelan di tap biar nggak ngetik ke mana-mana)")
        if !textOK {
            failures += 1
            print("         yang kebaca: \"\(TapObserver.shared.typedText)\"")
        }

        CGEvent.tapEnable(tap: tap, enable: false)

        print("")
        if failures == 0 {
            print("SEMUA LULUS.")
            print("Jalur injeksi kebukti lengkap: mouse, delta relatif, keycode, dan teks unicode.")
            print("Sisa yang masih butuh mata manusia: gerakan kerasa BENAR di app yang baca raw")
            print("delta (Blender / game / pan Figma). Field-nya sudah kebukti ada di event stream,")
            print("tapi apakah app-nya menafsirkan dengan benar cuma bisa dilihat langsung.")
        } else {
            print("\(failures) tes GAGAL.")
        }
        return failures == 0 ? 0 : 1
    }
}
