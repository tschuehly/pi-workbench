import AppKit

@main struct WindowRestorationTest {
    static func main() {
        let server = URL(string: "http://127.0.0.1:8505/")!
        let chat = URL(string: "http://127.0.0.1:8505/?project=p&workspace=w&session=s&view=chat")!
        let chooser = server
        let selectedChooser = URL(string: "http://127.0.0.1:8505/?project=p&workspace=w")!
        let folderChat = URL(string: "http://127.0.0.1:8505/?session=s&view=chat")!
        assert(WindowRestoration.applicationURL(chat, server: server) != nil)
        assert(WindowRestoration.applicationURL(chooser, server: server) == chooser)
        assert(WindowRestoration.applicationURL(selectedChooser, server: server) != nil)
        assert(WindowRestoration.applicationURL(folderChat, server: server) != nil)
        for text in [
            "http://evil.test/?project=p&workspace=w&session=s",
            "http://127.0.0.1:8506/?project=p&workspace=w&session=s",
            "http://127.0.0.1:8505/other?project=p&workspace=w&session=s",
            "http://127.0.0.1:8505/?project=p&workspace=w&session=creating:token",
            "http://127.0.0.1:8505/?project=p&workspace=w&session=s&token=secret",
            "http://127.0.0.1:8505/?project=p&workspace=w&session=s&session=t",
            "http://127.0.0.1:8505/?project=p&session=s",
            "http://127.0.0.1:8505/?view=chat",
            "http://127.0.0.1:8505/?project=p&workspace=w&session=s#secret",
            "http://user:pass@127.0.0.1:8505/?project=p&workspace=w&session=s",
        ] {
            assert(WindowRestoration.applicationURL(URL(string: text)!, server: server) == nil, text)
        }
        let screen = NSRect(x: 0, y: 0, width: 1000, height: 700)
        assert(WindowRestoration.frame(NSRect(x: 2000, y: 2000, width: 1200, height: 900), screens: [screen]) == screen)
        assert(WindowRestoration.frame(NSRect(x: CGFloat.infinity, y: 0, width: 500, height: 400), screens: [screen]) == nil)
        let suite = "WindowRestorationTest-\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let windows = [RestoredWindow(url: chat, frame: NSRect(x: 20, y: 30, width: 800, height: 600)),
                       RestoredWindow(url: chooser, frame: NSRect(x: 40, y: 50, width: 600, height: 500))]
        WindowRestoration.save(windows, to: defaults)
        assert(WindowRestoration.read(from: defaults, server: server, screens: [screen]).count == 2)
        assert(WindowRestoration.read(from: defaults, server: server, screens: []).allSatisfy { $0.frame == nil })
        assert(WindowRestoration.read(from: defaults, server: URL(string: "http://127.0.0.1:8506/")!, screens: [screen]).isEmpty)
        WindowRestoration.save([windows[1]], to: defaults) // closing the Chat removes only its record
        assert(WindowRestoration.read(from: defaults, server: server, screens: [screen]).first?.url == chooser)
        defaults.set([["url": "https://evil.test/", "frame": NSStringFromRect(screen)]], forKey: WindowRestoration.key)
        assert(WindowRestoration.read(from: defaults, server: server, screens: [screen]).isEmpty)
        print("PASS: native window restoration")
    }
}
