// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "deckd-input",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "deckd-input", path: "Sources/deckd-input")
    ]
)
