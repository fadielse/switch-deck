import ApplicationServices
import CoreGraphics
import Foundation

enum MouseButton: String {
    case left = "l"
    case right = "r"
    case middle = "m"

    var cgButton: CGMouseButton {
        switch self {
        case .left: return .left
        case .right: return .right
        case .middle: return .center
        }
    }

    var downType: CGEventType {
        switch self {
        case .left: return .leftMouseDown
        case .right: return .rightMouseDown
        case .middle: return .otherMouseDown
        }
    }

    var upType: CGEventType {
        switch self {
        case .left: return .leftMouseUp
        case .right: return .rightMouseUp
        case .middle: return .otherMouseUp
        }
    }

    var dragType: CGEventType {
        switch self {
        case .left: return .leftMouseDragged
        case .right: return .rightMouseDragged
        case .middle: return .otherMouseDragged
        }
    }
}

/// Everything macOS-specific lives here. Per decision K10 in the vault note,
/// a future Windows/Linux port replaces this file (SendInput / uinput) and
/// nothing else — the stdin protocol is the cross-platform contract.
final class Injector {
    private let source: CGEventSource?
    private var heldButtons: Set<MouseButton> = []

    init() {
        source = CGEventSource(stateID: .hidSystemState)
        // Without this, every synthetic event suppresses real hardware input for
        // 0.25s — the Mac's own trackpad feels stuck while the tablet is moving
        // the cursor. Costs nothing to disable, painful to debug later.
        source?.localEventsSuppressionInterval = 0
    }

    // MARK: - Accessibility

    static func isTrusted(prompting: Bool = false) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue()
        let options = [key: prompting] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    // MARK: - Mouse

    /// Relative move. Reads the live cursor position every call so our idea of
    /// where the cursor is can never drift from the system's.
    func move(dx: Double, dy: Double) {
        guard let current = CGEvent(source: nil)?.location else { return }
        let target = CGPoint(x: current.x + dx, y: current.y + dy)

        let held = heldButtons.first
        let type = held?.dragType ?? .mouseMoved
        let button = held?.cgButton ?? .left

        guard let event = CGEvent(mouseEventSource: source,
                                  mouseType: type,
                                  mouseCursorPosition: target,
                                  mouseButton: button) else { return }

        // Risk R1 in the blueprint: without these two fields the cursor still
        // appears to move, but anything reading raw deltas (games, Blender,
        // Figma pan) gets it wrong. Setting the position alone is not enough.
        event.setIntegerValueField(.mouseEventDeltaX, value: Int64(dx.rounded()))
        event.setIntegerValueField(.mouseEventDeltaY, value: Int64(dy.rounded()))
        event.post(tap: .cghidEventTap)
    }

    func button(_ button: MouseButton, down: Bool) {
        guard let current = CGEvent(source: nil)?.location else { return }
        let type = down ? button.downType : button.upType

        guard let event = CGEvent(mouseEventSource: source,
                                  mouseType: type,
                                  mouseCursorPosition: current,
                                  mouseButton: button.cgButton) else { return }

        // Some apps ignore clicks whose click state is left at 0.
        event.setIntegerValueField(.mouseEventClickState, value: 1)
        event.post(tap: .cghidEventTap)

        if down {
            heldButtons.insert(button)
        } else {
            heldButtons.remove(button)
        }
    }

    // MARK: - Keyboard

    func key(code: CGKeyCode, down: Bool, flags: CGEventFlags) {
        guard let event = CGEvent(keyboardEventSource: source,
                                  virtualKey: code,
                                  keyDown: down) else { return }
        if !flags.isEmpty {
            event.flags = flags
        }
        event.post(tap: .cghidEventTap)
    }

    /// Types arbitrary text without needing a keycode table — this is the path
    /// deck macros and long strings use, so F3's keycode map only has to cover
    /// modifiers and non-printing keys.
    func type(_ text: String) {
        let units = Array(text.utf16)
        guard !units.isEmpty else { return }

        // keyboardSetUnicodeString stops being reliable past roughly 20 UTF-16
        // units per event, so send it in small chunks.
        let chunkSize = 16
        var index = 0
        while index < units.count {
            let chunk = Array(units[index ..< min(index + chunkSize, units.count)])
            for isDown in [true, false] {
                guard let event = CGEvent(keyboardEventSource: source,
                                          virtualKey: 0,
                                          keyDown: isDown) else { continue }
                chunk.withUnsafeBufferPointer { buffer in
                    event.keyboardSetUnicodeString(stringLength: buffer.count,
                                                   unicodeString: buffer.baseAddress)
                }
                event.post(tap: .cghidEventTap)
            }
            usleep(1_500)
            index += chunkSize
        }
    }

    static func parseFlags(_ names: [String]?) -> CGEventFlags {
        guard let names else { return [] }
        var flags: CGEventFlags = []
        for name in names {
            switch name.lowercased() {
            case "cmd", "command": flags.insert(.maskCommand)
            case "shift": flags.insert(.maskShift)
            case "opt", "option", "alt": flags.insert(.maskAlternate)
            case "ctrl", "control": flags.insert(.maskControl)
            case "fn", "function": flags.insert(.maskSecondaryFn)
            default: break
            }
        }
        return flags
    }
}
