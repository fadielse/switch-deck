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

    /// Which state the synthesised events claim to come from, and where they are
    /// injected. Both are fixed in normal use; the environment overrides exist
    /// because system hotkeys (Mission Control, spaces) ignore our events and
    /// these are the two variables that could plausibly explain it.
    private static func configuredSource() -> CGEventSource? {
        switch ProcessInfo.processInfo.environment["DECKD_SOURCE"] {
        case "combined": return CGEventSource(stateID: .combinedSessionState)
        case "private": return CGEventSource(stateID: .privateState)
        case "none": return nil
        default: return CGEventSource(stateID: .hidSystemState)
        }
    }

    static let tap: CGEventTapLocation = {
        switch ProcessInfo.processInfo.environment["DECKD_TAP"] {
        case "session": return .cgSessionEventTap
        case "annotated": return .cgAnnotatedSessionEventTap
        default: return .cghidEventTap
        }
    }()

    init() {
        source = Injector.configuredSource()
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
        let wanted = target
        target.x = min(max(target.x, area.minX), area.maxX - 1)
        target.y = min(max(target.y, area.minY), area.maxY - 1)

        // The clamp above already knows something nobody has been told: motion
        // was asked for and the screen had nowhere to put it. That is exactly
        // what "the cursor is pressed against the right edge" means, and it is
        // what a handover to the next machine needs. Report it rather than
        // building a second edge detector on top of the same fact.
        reportEdge(wanted: wanted, clamped: target, area: area, dx: dx, dy: dy)

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
        event.post(tap: Injector.tap)
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
        event.post(tap: Injector.tap)
    }

    /// How far the cursor may drift between two taps and still be the same
    /// double click. Generous on purpose: a finger is allowed to wander up to
    /// the client's tap slop and that wander is multiplied by pointer gain
    /// before it reaches here, so a few pixels of tolerance would throw away
    /// double clicks that the user made correctly. Two clicks this close
    /// together in space AND inside the double-click interval are a double
    /// click by any reasonable reading.
    private static let doubleClickSlop: CGFloat = 24

    private var lastClickAt: [MouseButton: TimeInterval] = [:]
    private var lastClickPos: [MouseButton: CGPoint] = [:]
    private var clickState: [MouseButton: Int64] = [:]

    /// Called with the edge being pushed against and how much motion the clamp
    /// swallowed. Set by main.swift; the injector itself knows nothing about
    /// the protocol.
    var onEdge: ((String, Double, Double) -> Void)?

    private var edgeOverflow: Double = 0
    private var edgeSide: String?
    private var edgeReportedAt: TimeInterval = 0
    private static let edgeReportEvery: TimeInterval = 0.05

    private func reportEdge(wanted: CGPoint, clamped: CGPoint, area: CGRect,
                            dx: Double, dy: Double) {
        var side: String?
        var lost: Double = 0
        // Direction matters: sitting at the right edge while moving left is not
        // pushing against it.
        if dx > 0, wanted.x > clamped.x { side = "r"; lost = wanted.x - clamped.x }
        else if dx < 0, wanted.x < clamped.x { side = "l"; lost = clamped.x - wanted.x }
        else if dy > 0, wanted.y > clamped.y { side = "b"; lost = wanted.y - clamped.y }
        else if dy < 0, wanted.y < clamped.y { side = "t"; lost = clamped.y - wanted.y }

        guard let side else {
            edgeOverflow = 0
            edgeSide = nil
            return
        }
        if side != edgeSide { edgeOverflow = 0; edgeSide = side }
        edgeOverflow += lost

        // Batched: pressed against an edge this fires every frame, and ninety
        // messages a second down the socket is the shape of the problem the
        // client just finished removing.
        let now = Date().timeIntervalSince1970
        guard now - edgeReportedAt >= Injector.edgeReportEvery else { return }
        edgeReportedAt = now

        // Where along the edge, as a fraction. The next machine uses it to put
        // the cursor at the same height on its own screen, so the crossing
        // reads as continuous rather than as a jump.
        let ratio = side == "l" || side == "r"
            ? (area.height > 0 ? (clamped.y - area.minY) / area.height : 0.5)
            : (area.width > 0 ? (clamped.x - area.minX) / area.width : 0.5)
        onEdge?(side, edgeOverflow, ratio)
        edgeOverflow = 0
    }

    /// Place the cursor on one edge at a given fraction along it — the other
    /// half of a handover, run on the machine being handed to.
    func warp(side: String, ratio: Double) {
        guard ratio.isFinite else { return }
        let area = displayBounds()
        let r = min(max(ratio, 0), 1)
        var point: CGPoint
        switch side {
        case "l": point = CGPoint(x: area.minX + 2, y: area.minY + area.height * r)
        case "r": point = CGPoint(x: area.maxX - 3, y: area.minY + area.height * r)
        case "t": point = CGPoint(x: area.minX + area.width * r, y: area.minY + 2)
        case "b": point = CGPoint(x: area.minX + area.width * r, y: area.maxY - 3)
        default: return
        }
        virtualPosition = point
        lastMoveAt = Date().timeIntervalSince1970
        edgeOverflow = 0
        edgeSide = nil
        guard let event = CGEvent(mouseEventSource: source, mouseType: .mouseMoved,
                                  mouseCursorPosition: point, mouseButton: .left) else { return }
        event.post(tap: Injector.tap)
    }

    // MARK: - clipboard
    //
    // NSPasteboard rather than pbpaste/pbcopy in the server: reading the
    // clipboard is OS-specific, and K10 puts OS-specific code on this side of
    // the pipe. deckd stays a router that never learns what a pasteboard is.
    //
    // Text only, on purpose. Images and files are a different feature with
    // different limits, not a quiet widening of this one.
    func clipboardRead(limit: Int) -> String? {
        guard let text = NSPasteboard.general.string(forType: .string) else { return nil }
        return text.count > limit ? String(text.prefix(limit)) : text
    }

    func clipboardWrite(_ text: String) {
        let board = NSPasteboard.general
        board.clearContents()
        board.setString(text, forType: .string)
    }

    func button(_ button: MouseButton, down: Bool) {
        guard let current = CGEvent(source: nil)?.location else { return }
        let type = down ? button.downType : button.upType

        guard let event = CGEvent(mouseEventSource: source,
                                  mouseType: type,
                                  mouseCursorPosition: current,
                                  mouseButton: button.cgButton) else { return }

        // macOS does not time your clicks and decide for itself: the click
        // count travels IN the event, and an event that always says 1 is always
        // a single click no matter how fast the taps arrive. That is why double
        // tap never opened anything — two perfect single clicks, forever.
        //
        // The up event has to carry the same count as its down, or the pair
        // does not describe one click.
        var state: Int64 = 1
        if down {
            let now = Date().timeIntervalSince1970
            let elapsed = now - (lastClickAt[button] ?? -.greatestFiniteMagnitude)
            let previous = lastClickPos[button] ?? CGPoint(x: -9999, y: -9999)
            let moved = hypot(current.x - previous.x, current.y - previous.y)
            if elapsed <= NSEvent.doubleClickInterval, moved <= Injector.doubleClickSlop {
                // Capped at 3: macOS counts triple clicks and nothing beyond.
                state = min((clickState[button] ?? 1) + 1, 3)
            }
            clickState[button] = state
            lastClickAt[button] = now
            lastClickPos[button] = current
        } else {
            state = clickState[button] ?? 1
        }
        event.setIntegerValueField(.mouseEventClickState, value: state)
        event.post(tap: Injector.tap)

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
        event.post(tap: Injector.tap)
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

            // The text rides on the key DOWN only. Attaching it to the release
            // as well is what typed every character twice ("kketikk"): AppKit
            // inserts on key down, but an app that also reads the key up sees
            // the same string a second time and inserts it again. Whether it
            // did depended on the app and on timing, which is why it looked
            // intermittent rather than broken.
            paceKeyEvent()
            if let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true) {
                chunk.withUnsafeBufferPointer { buffer in
                    down.keyboardSetUnicodeString(stringLength: buffer.count,
                                                  unicodeString: buffer.baseAddress)
                }
                down.post(tap: Injector.tap)
            }

            // A bare release, and paced apart from its own press: a down and an
            // up landing in the same instant is what let the two be processed
            // out of order in the first place.
            paceKeyEvent()
            if let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) {
                up.post(tap: Injector.tap)
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
        event.cgEvent?.post(tap: Injector.tap)
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
