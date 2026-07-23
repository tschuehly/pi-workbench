// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PIWebMac",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "PIWebMac",
            path: "Sources/PIWebMac",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
