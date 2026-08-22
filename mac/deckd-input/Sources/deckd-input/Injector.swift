import AppKit
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

    /// Where we believe the cursor is. Reading the live position before every
    /// move looks safer but is a race: posting faster than the window server
    /// updates makes two consecutive moves read the same stale point, and one
    /// of them is lost. At trackpad rates that shows up as motion that sticks.
    private var virtualPosition: CGPoint?
    private var lastMoveAt: TimeInterval = 0
    private var bounds: CGRect?

    /// Long enough that a continuous drag never resyncs mid-stroke, short
    /// enough that picking up the physical mouse resyncs before the next one.
    private static let resyncAfter: TimeInterval = 0.2

    /// Spacing between keystrokes. Note what this is NOT: characters going
    /// missing while typing ("fadilah hasan" arriving as "fdila hsan") was
    /// traced to the client, not here — an event tap sees every character with
    /// or without this pacing, so nothing was being lost at the posting layer.
    /// It stays as cheap insurance against a receiving app that cannot keep up,
    /// since typing is low rate and 9 ms per keystroke costs nothing. Mouse
    /// motion is deliberately NOT paced: it must never block the stdin reader.
    private var lastKeyEventAt: TimeInterval = 0
    private static let minKeyGap: TimeInterval = 0.009

    private func paceKeyEvent() {
        let elapsed = Date().timeIntervalSince1970 - lastKeyEventAt
        if elapsed < Injector.minKeyGap {
            usleep(useconds_t((Injector.minKeyGap - elapsed) * 1_000_000))
        }
        lastKeyEventAt = Date().timeIntervalSince1970
    }

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

    /// Union of every active display, so an accumulated position can be clamped
    /// to somewhere the cursor can actually be.
    private func displayBounds() -> CGRect {
        if let bounds { return bounds }
        var count: UInt32 = 0
        CGGetActiveDisplayList(0, nil, &count)
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        CGGetActiveDisplayList(count, &ids, &count)
        var union = CGRect.null
        for id in ids { union = union.union(CGDisplayBounds(id)) }
        let result = union.isNull ? CGDisplayBounds(CGMainDisplayID()) : union
        bounds = result
        return result
    }

    func move(dx: Double, dy: Double) {
        // Int64(Double.nan) is a runtime trap in Swift, so a single malformed
        // frame would take the whole binary down. The server validates too, but
        // this side must not depend on that.
        guard dx.isFinite, dy.isFinite else { return }
        let now = Date().timeIntervalSince1970
        if virtualPosition == nil || now - lastMoveAt > Injector.resyncAfter {
            // Idle long enough that the physical mouse may have moved; trust the
            // system again before starting a new stroke.
            virtualPosition = CGEvent(source: nil)?.location
            bounds = nil
        }
        guard var target = virtualPosition else { return }

        target.x += dx
        target.y += dy

        // Clamp, otherwise pushing into an edge keeps accumulating off-screen
        // and the cursor appears stuck until the movement is undone.
        let area = displayBounds()
        target.x = min(max(target.x, area.minX), area.maxX - 1)
        target.y = min(max(target.y, area.minY), area.maxY - 1)

        virtualPosition = target
        lastMoveAt = now

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

    /// Pixel-unit scrolling, which is what gives smooth trackpad-style motion
    /// rather than the notched jumps a classic wheel produces.
    func scroll(dx: Double, dy: Double) {
        guard dx.isFinite, dy.isFinite else { return }
        guard let event = CGEvent(scrollWheelEvent2Source: source,
                                  units: .pixel,
                                  wheelCount: 2,
                                  wheel1: Int32(dy.rounded()),
                                  wheel2: Int32(dx.rounded()),
                                  wheel3: 0) else { return }
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

        virtualPosition = current
        if down {
            heldButtons.insert(button)
        } else {
            heldButtons.remove(button)
        }
    }

    // MARK: - Keyboard

    func key(code: CGKeyCode, down: Bool, flags: CGEventFlags) {
        paceKeyEvent()
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
            paceKeyEvent()
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
            index += chunkSize
        }
    }

    /// The function row on an Apple keyboard is media keys, not F-keys. Those
    /// travel as NSSystemDefined events with subtype 8 rather than as virtual
    /// keycodes — posting keycode 111 sends F12, which does nothing to the
    /// volume. Codes are the NX_KEYTYPE_* constants.
    func media(_ code: Int32, down: Bool) {
        let state = down ? 0xA : 0xB
        let data1 = Int((code << 16) | Int32(state << 8))
        guard let event = NSEvent.otherEvent(with: .systemDefined,
                                             location: .zero,
                                             modifierFlags: NSEvent.ModifierFlags(rawValue: UInt(state << 8)),
                                             timestamp: 0,
                                             windowNumber: 0,
                                             context: nil,
                                             subtype: 8,
                                             data1: data1,
                                             data2: -1) else { return }
        event.cgEvent?.post(tap: .cghidEventTap)
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
