import Foundation

/// One line of the stdin protocol. Fields are optional because a single struct
/// decodes every frame type; `t` is the discriminator.
///
/// See the protocol table in the vault note `SwitchDeck.md`.
struct Frame: Decodable {
    let t: String

    // mouse move / scroll
    let dx: Double?
    let dy: Double?

    // mouse button: "l" | "r" | "m"
    let btn: String?

    // 1 = down, 0 = up (shared by "b" and "k")
    let d: Int?

    // virtual keycode
    let code: Int?
    let flags: [String]?

    // literal text to type
    let s: String?

    // latency probe echo value
    let ts: Double?
}
