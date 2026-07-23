import AppKit
import WebKit

private enum PIWebConfiguration {
    static let defaultURL = URL(string: "http://127.0.0.1:8504")!

    static var serverURL: URL {
        guard
            let value = ProcessInfo.processInfo.environment["PI_WEB_URL"],
            let url = URL(string: value),
            let scheme = url.scheme?.lowercased(),
            ["http", "https"].contains(scheme),
            url.host != nil
        else {
            return defaultURL
        }
        return url
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let browser = BrowserCoordinator(serverURL: PIWebConfiguration.serverURL)

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()
        browser.openWindow()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(
        _ sender: NSApplication,
        hasVisibleWindows flag: Bool
    ) -> Bool {
        if !flag {
            browser.openWindow()
        }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    @objc private func newWindow(_ sender: Any?) {
        browser.openWindow()
    }

    @objc private func newTab(_ sender: Any?) {
        browser.openTab()
    }

    @objc private func reload(_ sender: Any?) {
        browser.reloadKeyWindow()
    }

    @objc private func goBack(_ sender: Any?) {
        browser.goBackInKeyWindow()
    }

    @objc private func goForward(_ sender: Any?) {
        browser.goForwardInKeyWindow()
    }

    private func buildMainMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(
            withTitle: "About PI WEB",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Quit PI WEB",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )

        let fileItem = NSMenuItem()
        mainMenu.addItem(fileItem)
        let fileMenu = NSMenu(title: "File")
        fileItem.submenu = fileMenu
        fileMenu.addItem(withTitle: "New Window", action: #selector(newWindow(_:)), keyEquivalent: "n")
        fileMenu.addItem(withTitle: "New Tab", action: #selector(newTab(_:)), keyEquivalent: "t")
        fileMenu.addItem(.separator())
        fileMenu.addItem(
            withTitle: "Close",
            action: #selector(NSWindow.performClose(_:)),
            keyEquivalent: "w"
        )

        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        viewItem.submenu = viewMenu
        viewMenu.addItem(withTitle: "Back", action: #selector(goBack(_:)), keyEquivalent: "[")
        viewMenu.addItem(withTitle: "Forward", action: #selector(goForward(_:)), keyEquivalent: "]")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reload(_:)), keyEquivalent: "r")
        viewMenu.addItem(.separator())
        viewMenu.addItem(
            withTitle: "Enter Full Screen",
            action: #selector(NSWindow.toggleFullScreen(_:)),
            keyEquivalent: "f"
        ).keyEquivalentModifierMask = [.control, .command]

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowItem.submenu = windowMenu
        windowMenu.addItem(
            withTitle: "Minimize",
            action: #selector(NSWindow.performMiniaturize(_:)),
            keyEquivalent: "m"
        )
        windowMenu.addItem(withTitle: "Show Previous Tab", action: #selector(NSWindow.selectPreviousTab(_:)), keyEquivalent: "{")
        windowMenu.addItem(withTitle: "Show Next Tab", action: #selector(NSWindow.selectNextTab(_:)), keyEquivalent: "}")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Move Tab to New Window", action: #selector(NSWindow.moveTabToNewWindow(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "Merge All Windows", action: #selector(NSWindow.mergeAllWindows(_:)), keyEquivalent: "")
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }
}

private final class BrowserCoordinator {
    private let serverURL: URL
    private var controllers: [ObjectIdentifier: BrowserWindowController] = [:]

    init(serverURL: URL) {
        self.serverURL = serverURL
    }

    @discardableResult
    func openWindow(url: URL? = nil) -> BrowserWindowController {
        let controller = BrowserWindowController(serverURL: serverURL) { [weak self] controller in
            self?.controllers.removeValue(forKey: ObjectIdentifier(controller))
        }
        controllers[ObjectIdentifier(controller)] = controller
        controller.showWindow(nil)
        controller.load(url ?? serverURL)
        return controller
    }

    func openTab(url: URL? = nil, relativeTo parent: NSWindow? = nil) {
        let parent = parent ?? NSApp.keyWindow
        let controller = openWindow(url: url)
        guard let parent, let child = controller.window, parent !== child else { return }
        parent.addTabbedWindow(child, ordered: .above)
        child.makeKeyAndOrderFront(nil)
    }

    func reloadKeyWindow() {
        keyController?.reload()
    }

    func goBackInKeyWindow() {
        keyController?.goBack()
    }

    func goForwardInKeyWindow() {
        keyController?.goForward()
    }

    private var keyController: BrowserWindowController? {
        guard let window = NSApp.keyWindow else { return nil }
        return controllers.values.first { $0.window === window }
    }
}

private final class BrowserWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let serverURL: URL
    private let webView: WKWebView
    private let onClose: (BrowserWindowController) -> Void

    init(serverURL: URL, onClose: @escaping (BrowserWindowController) -> Void) {
        self.serverURL = serverURL
        self.onClose = onClose

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.isElementFullscreenEnabled = true
        webView = WKWebView(frame: .zero, configuration: configuration)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "PI WEB"
        window.titleVisibility = .visible
        window.titlebarAppearsTransparent = false
        window.tabbingIdentifier = "pi-web-browser"
        window.tabbingMode = .preferred
        window.center()
        window.contentView = webView

        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func load(_ url: URL) {
        webView.load(URLRequest(url: url))
    }

    func reload() {
        webView.reload()
    }

    func goBack() {
        if webView.canGoBack { webView.goBack() }
    }

    func goForward() {
        if webView.canGoForward { webView.goForward() }
    }

    func windowWillClose(_ notification: Notification) {
        onClose(self)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        window?.title = webView.title?.isEmpty == false ? webView.title! : "PI WEB"
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if isAllowed(url) || url.scheme == "about" {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if isAllowed(url) {
            (NSApp.delegate as? AppDelegate)?.browserOpenTab(url)
        } else {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        showConnectionError(error)
    }

    private func isAllowed(_ url: URL) -> Bool {
        url.scheme?.lowercased() == serverURL.scheme?.lowercased()
            && url.host?.lowercased() == serverURL.host?.lowercased()
            && effectivePort(url) == effectivePort(serverURL)
    }

    private func effectivePort(_ url: URL) -> Int? {
        url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80)
    }

    private func showConnectionError(_ error: Error) {
        let address = escapeHTML(serverURL.absoluteString)
        let message = escapeHTML(error.localizedDescription)
        let html = """
        <!doctype html>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          :root { color-scheme: light dark; font: 15px -apple-system, BlinkMacSystemFont, sans-serif; }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
          main { width: min(520px, calc(100% - 48px)); }
          h1 { font-size: 24px; margin-bottom: 8px; }
          p { line-height: 1.5; color: color-mix(in srgb, CanvasText 72%, transparent); }
          code { overflow-wrap: anywhere; }
          a { display: inline-block; color: ButtonText; background: ButtonFace; border: 1px solid ButtonBorder;
              border-radius: 5px; padding: 8px 14px; text-decoration: none; }
        </style>
        <main>
          <h1>PI WEB is unavailable</h1>
          <p>Start PI WEB and make sure it is reachable at <code>\(address)</code>.</p>
          <p>\(message)</p>
          <a href="\(address)">Try again</a>
        </main>
        """
        webView.loadHTMLString(html, baseURL: serverURL)
    }

    private func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }
}

private extension AppDelegate {
    func browserOpenTab(_ url: URL) {
        browser.openTab(url: url)
    }
}

private let application = NSApplication.shared
private let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
