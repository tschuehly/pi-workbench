import AppKit

// Only PI WEB's chooser and committed Chat routes belong in native preferences.
struct RestoredWindow {
    let url: URL
    let frame: NSRect?
}

enum WindowRestoration {
    static let key = "PiWorkbenchOpenWindowsV1"

    static func applicationURL(_ candidate: URL, server: URL) -> URL? {
        func port(_ url: URL) -> Int? { url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80) }
        guard candidate.scheme?.lowercased() == server.scheme?.lowercased(),
              candidate.host?.lowercased() == server.host?.lowercased(), port(candidate) == port(server),
              candidate.user == nil, candidate.password == nil, candidate.fragment == nil,
              candidate.path == server.path || (candidate.path == "/" && server.path.isEmpty),
              let parts = URLComponents(url: candidate, resolvingAgainstBaseURL: false),
              let serverParts = URLComponents(url: server, resolvingAgainstBaseURL: false) else { return nil }
        let items = parts.queryItems ?? []
        let values = Dictionary(grouping: items, by: \.name)
        guard values.values.allSatisfy({ $0.count == 1 }),
              values.keys.allSatisfy({ ["machine", "project", "workspace", "session", "view"].contains($0) }),
              (values["project"] == nil) == (values["workspace"] == nil),
              (values["session"] != nil || values["view"] == nil),
              values["view"] == nil || values["view"]?.first?.value == "chat",
              values["session"]?.first?.value?.hasPrefix("creating:") != true,
              items.allSatisfy({ let value = $0.value ?? ""; return !value.isEmpty && value.count <= 512 }) else { return nil }
        var result = serverParts
        result.user = nil
        result.password = nil
        result.fragment = nil
        result.queryItems = items.isEmpty ? nil : items.sorted { $0.name < $1.name }
        return result.url
    }

    static func frame(_ saved: NSRect, screens: [NSRect]) -> NSRect? {
        guard saved.origin.x.isFinite, saved.origin.y.isFinite,
              saved.width.isFinite, saved.height.isFinite, saved.width >= 400, saved.height >= 300,
              let screen = screens.max(by: { $0.intersection(saved).width * $0.intersection(saved).height < $1.intersection(saved).width * $1.intersection(saved).height }),
              screen.width >= 400, screen.height >= 300 else { return nil }
        let width = min(saved.width, screen.width)
        let height = min(saved.height, screen.height)
        return NSRect(x: min(max(saved.minX, screen.minX), screen.maxX - width),
                      y: min(max(saved.minY, screen.minY), screen.maxY - height),
                      width: width, height: height)
    }

    static func read(from defaults: UserDefaults, server: URL, screens: [NSRect]) -> [RestoredWindow] {
        guard let entries = defaults.array(forKey: key) as? [[String: String]] else { return [] }
        return entries.compactMap { entry in
            guard let text = entry["url"], let url = URL(string: text), let safeURL = applicationURL(url, server: server) else { return nil }
            let safeFrame = entry["frame"].flatMap { frame(NSRectFromString($0), screens: screens) }
            return RestoredWindow(url: safeURL, frame: safeFrame)
        }
    }

    static func save(_ windows: [RestoredWindow], to defaults: UserDefaults) {
        defaults.set(windows.map { ["url": $0.url.absoluteString, "frame": $0.frame.map(NSStringFromRect) ?? ""] }, forKey: key)
    }
}
