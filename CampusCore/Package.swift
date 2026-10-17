// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "CampusCore", platforms: [.iOS(.v17), .macOS(.v14)], products: [.library(name: "CampusCore", targets: ["CampusCore"])], targets: [.target(name: "CampusCore", resources: [.process("Resources")]), .testTarget(name: "CampusCoreTests", dependencies: ["CampusCore"])])
