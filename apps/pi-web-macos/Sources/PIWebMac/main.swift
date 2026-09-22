import AppKit
import UserNotifications
import WebKit

private struct PIWebConfiguration {
    let cliURL: URL
    let checkoutURL: URL
    let serverURL: URL

    static func load() -> PIWebConfiguration? {
        let environment = ProcessInfo.processInfo.environment
        let bundleValues: [String: Any] = {
            guard
                let url = Bundle.main.url(forResource: "PIWebConfig", withExtension: "plist"),
                let values = NSDictionary(contentsOf: url) as? [String: Any]
            else { return [:] }
            return values
        }()
        let cliPath = environment["PI_WEB_CLI"] ?? bundleValues["CLIPath"] as? String
        let checkoutPath = environment["PI_WEB_DIR"] ?? bundleValues["CheckoutPath"] as? String
        let urlValue = environment["PI_WEB_URL"] ?? bundleValues["ServerURL"] as? String ?? "http://127.0.0.1:8505"
        guard
            let cliPath, !cliPath.isEmpty,
            let checkoutPath, !checkoutPath.isEmpty,
            let serverURL = URL(string: urlValue),
            let scheme = serverURL.scheme?.lowercased(),
            ["http", "https"].contains(scheme),
            serverURL.host != nil
        else { return nil }
        return PIWebConfiguration(
            cliURL: URL(fileURLWithPath: cliPath),
            checkoutURL: URL(fileURLWithPath: checkoutPath, isDirectory: true),
            serverURL: serverURL
        )
    }
}

private enum LifecycleAction {
    case retry
    case logs
    case doctor
}

private final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private let configuration = PIWebConfiguration.load()
    private lazy var browser = BrowserCoordinator(serverURL: configuration?.serverURL) { [weak self] action in
        self?.handle(action)
    }
    private lazy var lifecycle = LifecycleController(configuration: configuration, browser: browser)

    func applicationDidFinishLaunching(_ notification: Notification) {
        currentUserNotificationCenter()?.delegate = self
        buildMainMenu()
        browser.openWindow()
        NSApp.activate(ignoringOtherApps: true)
        lifecycle.start()
    }

    /// Dock click, `open -a`, or Raycast: give the current desktop its own window instead of jumping to one elsewhere.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag || !browser.hasWindowOnActiveSpace { browser.openWindow() }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in
            activateFromNotificationClick(
                activateApplication: { NSApp.activate(ignoringOtherApps: true) },
                bringWindowForward: { self?.browser.bringExistingWindowForward() },
                complete: completionHandler
            )
        }
    }

    @objc private func newWindow(_ sender: Any?) { browser.openWindow() }
    @objc private func reload(_ sender: Any?) { browser.reloadKeyWindow() }
    @objc private func goBack(_ sender: Any?) { browser.goBackInKeyWindow() }
    @objc private func goForward(_ sender: Any?) { browser.goForwardInKeyWindow() }
    @objc private func showRestartHelp(_ sender: Any?) { lifecycle.showRestartHelp() }
    @objc private func openLifecycleStatus(_ sender: Any?) { lifecycle.showStatus() }

    private func handle(_ action: LifecycleAction) {
        switch action {
        case .retry: lifecycle.start()
        case .logs: openLogs()
        case .doctor: lifecycle.showDoctor()
        }
    }

    private func openLogs() {
        let logs = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".pi-web", isDirectory: true)
            .appendingPathComponent("logs", isDirectory: true)
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        NSWorkspace.shared.open(logs)
    }

    private func buildMainMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Pi Workbench", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Pi Workbench", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let fileItem = NSMenuItem()
        mainMenu.addItem(fileItem)
        let fileMenu = NSMenu(title: "File")
        fileItem.submenu = fileMenu
        fileMenu.addItem(withTitle: "New Window", action: #selector(newWindow(_:)), keyEquivalent: "n")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit")
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redoItem = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        viewItem.submenu = viewMenu
        viewMenu.addItem(withTitle: "Back", action: #selector(goBack(_:)), keyEquivalent: "[")
        viewMenu.addItem(withTitle: "Forward", action: #selector(goForward(_:)), keyEquivalent: "]")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reload(_:)), keyEquivalent: "r")
        viewMenu.addItem(.separator())
        let fullScreen = viewMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.control, .command]

        let lifecycleItem = NSMenuItem()
        mainMenu.addItem(lifecycleItem)
        let lifecycleMenu = NSMenu(title: "PI WEB")
        lifecycleItem.submenu = lifecycleMenu
        lifecycleMenu.addItem(withTitle: "About Service Restarts…", action: #selector(showRestartHelp(_:)), keyEquivalent: "")
        lifecycleMenu.addItem(.separator())
        lifecycleMenu.addItem(withTitle: "Open Lifecycle Status", action: #selector(openLifecycleStatus(_:)), keyEquivalent: "")

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = mainMenu
    }
}

private struct CommandResult {
    let output: String
    let status: Int32
}

private final class LifecycleController {
    private let configuration: PIWebConfiguration?
    private weak var browser: BrowserCoordinator?
    private let queue = DispatchQueue(label: "works.pi.workbench.lifecycle", qos: .userInitiated)
    // Owned by the serial lifecycle queue; a retry supersedes scheduled probes.
    private var generation = 0

    init(configuration: PIWebConfiguration?, browser: BrowserCoordinator) {
        self.configuration = configuration
        self.browser = browser
    }

    func start() {
        onMain { self.browser?.showStartup("Checking installed PI WEB services…") }
        queue.async { [weak self] in
            guard let self else { return }
            self.generation += 1
            self.prepareStack(generation: self.generation, startedAt: Date())
        }
    }

    func showStatus() { showReport(command: ["status"], title: "PI WEB Lifecycle Status") }
    func showDoctor() { showReport(command: ["doctor"], title: "PI WEB Doctor") }

    func showRestartHelp() {
        // The current CLI ignores --component and restarts the entire stack. Fail closed.
        onMain {
            self.browser?.showReport(title: "Component restart unavailable", text:
                "This PI WEB CLI does not support component-only restarts. No services were restarted.\n\nUse pi-web restart in a terminal only when interrupting all active sessions is acceptable.")
        }
    }

    private func prepareStack(generation: Int, startedAt: Date, attempt: Int = 0) {
        guard generation == self.generation else { return }
        do {
            guard let configuration else { throw LifecycleError.configuration }
            switch PIWebReadiness.check(serverURL: configuration.serverURL, checkoutURL: configuration.checkoutURL) {
            case .ready:
                showReady()
                return
            case .failed(let message):
                showFailure(message)
                return
            case .waiting(let message):
                // Status is display text; only its exit code reports whether services are running.
                // `start` starts missing services without replacing a running session daemon.
                if attempt % 10 == 0 {
                    let status = try runCLI(["status"])
                    if status.status != 0 {
                        onMain { self.browser?.showStartup("Starting installed PI WEB services…") }
                        let start = try runCLI(["start"])
                        guard start.status == 0 else { throw LifecycleError.command(start.output) }
                    }
                }
                report(message, Int(Date().timeIntervalSince(startedAt)))
            }
            // Yield the queue so doctor/status and explicit retries still work while unhealthy.
            queue.asyncAfter(deadline: .now() + 1) { [weak self] in
                self?.prepareStack(generation: generation, startedAt: startedAt, attempt: attempt + 1)
            }
        } catch {
            showFailure(error.localizedDescription)
        }
    }

    private func report(_ message: String, _ elapsedSeconds: Int) {
        if elapsedSeconds > 60 {
            showFailure("\(message)\n\nStill unhealthy after \(elapsedSeconds) seconds. This page reloads by itself once PI WEB reports healthy again.")
        } else {
            onMain { self.browser?.showStartup(message) }
        }
    }

    private func runCLI(_ arguments: [String]) throws -> CommandResult {
        guard let configuration else { throw LifecycleError.configuration }
        let process = Process()
        if FileManager.default.isExecutableFile(atPath: configuration.cliURL.path) {
            process.executableURL = configuration.cliURL
            process.arguments = arguments
        } else {
            // ponytail: a tsc rebuild drops the exec bit on dist/cli.js, so run the script through node.
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = ["node", configuration.cliURL.path] + arguments
        }
        process.currentDirectoryURL = configuration.checkoutURL
        var environment = ProcessInfo.processInfo.environment
        let executablePaths = [
            configuration.cliURL.deletingLastPathComponent().path,
            configuration.checkoutURL.appendingPathComponent("node_modules/.bin", isDirectory: true).path,
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin", isDirectory: true).path,
            "/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
            environment["PATH"] ?? "",
        ]
        environment["PATH"] = executablePaths.filter { !$0.isEmpty }.joined(separator: ":")
        process.environment = environment
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        do { try process.run() }
        catch { throw LifecycleError.launch(error.localizedDescription) }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return CommandResult(output: String(decoding: data, as: UTF8.self), status: process.terminationStatus)
    }

    private func showReport(command: [String], title: String) {
        queue.async { [weak self] in
            guard let self else { return }
            do {
                let result = try self.runCLI(command)
                let text = result.output.isEmpty ? "The lifecycle command returned no output." : result.output
                self.onMain { self.browser?.showReport(title: title, text: text) }
            } catch {
                self.showFailure(error.localizedDescription)
            }
        }
    }

    private func showReady() {
        onMain { self.browser?.showReady() }
    }

    private func showFailure(_ message: String) {
        onMain { self.browser?.showFailure(message) }
    }

    private func onMain(_ work: @escaping () -> Void) {
        DispatchQueue.main.async(execute: work)
    }
}

private enum LifecycleError: LocalizedError {
    case configuration
    case command(String)
    case launch(String)

    var errorDescription: String? {
        switch self {
        case .configuration: return "The generated PI WEB bundle configuration is missing or invalid. Re-run the Pi Workbench installer."
        case .command(let output): return output.isEmpty ? "The PI WEB lifecycle command failed." : output
        case .launch(let message): return "The configured PI WEB CLI could not be launched: \(message)"
        }
    }
}

private final class BrowserCoordinator {
    private let serverURL: URL?
    private let actionHandler: (LifecycleAction) -> Void
    private var controllers: [ObjectIdentifier: BrowserWindowController] = [:]
    private var ready = false

    init(serverURL: URL?, actionHandler: @escaping (LifecycleAction) -> Void) {
        self.serverURL = serverURL
        self.actionHandler = actionHandler
    }

    var hasWindowOnActiveSpace: Bool {
        controllers.values.contains { $0.window?.isVisible == true && $0.window?.isOnActiveSpace == true }
    }

    @discardableResult
    func openWindow(url: URL? = nil) -> BrowserWindowController {
        let controller = BrowserWindowController(serverURL: serverURL, actionHandler: actionHandler) { [weak self] controller in
            self?.controllers.removeValue(forKey: ObjectIdentifier(controller))
        }
        controllers[ObjectIdentifier(controller)] = controller
        controller.showWindow(nil)
        if ready, let target = url ?? serverURL { controller.load(target) }
        else { controller.showStartup("Checking installed PI WEB services…") }
        return controller
    }

    func showStartup(_ message: String) {
        ready = false
        controllers.values.forEach { $0.showStartup(message) }
    }

    func showFailure(_ message: String) {
        ready = false
        controllers.values.forEach { $0.showFailure(message) }
    }

    func showReady() {
        ready = true
        guard let serverURL else { return }
        controllers.values.forEach { $0.resume(fallback: serverURL) }
    }

    func reloadKeyWindow() { keyController?.reload() }
    func goBackInKeyWindow() { keyController?.goBack() }
    func goForwardInKeyWindow() { keyController?.goForward() }

    func bringExistingWindowForward() {
        guard let window = (keyController ?? controllers.values.first)?.window else { return }
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
    }

    func showReport(title: String, text: String) {
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 720, height: 480))
        scroll.hasVerticalScroller = true
        scroll.hasHorizontalScroller = true
        let textView = NSTextView(frame: scroll.bounds)
        textView.isEditable = false
        textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        textView.string = text
        textView.autoresizingMask = [.width]
        scroll.documentView = textView
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 480), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = title
        window.contentView = scroll
        window.center()
        window.isReleasedWhenClosed = false
        window.makeKeyAndOrderFront(nil)
    }

    private var keyController: BrowserWindowController? {
        guard let window = NSApp.keyWindow else { return nil }
        return controllers.values.first { $0.window === window }
    }
}

private final class DirectoryPickerMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame else {
            replyHandler(nil, "The folder picker is only available to the main page")
            return
        }
        let panel = NSOpenPanel()
        panel.title = "Add Project"
        panel.message = "Choose a project folder"
        panel.prompt = "Choose"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.resolvesAliases = true
        let complete: (NSApplication.ModalResponse) -> Void = { response in
            replyHandler(response == .OK ? panel.url?.path : NSNull(), nil)
        }
        if let window = message.webView?.window { panel.beginSheetModal(for: window, completionHandler: complete) }
        else { complete(panel.runModal()) }
    }
}

private final class NotificationMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    private let command: NativeNotificationCommand
    private let notifications: NativeNotificationBridge

    init(_ command: NativeNotificationCommand, notifications: NativeNotificationBridge = NativeNotificationBridge()) {
        self.command = command
        self.notifications = notifications
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping NativeNotificationReply) {
        handleNativeNotificationMessage(command, isMainFrame: message.frameInfo.isMainFrame, value: message.body, notifications: notifications, reply: replyHandler)
    }
}

private final class BrowserWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let serverURL: URL?
    private let actionHandler: (LifecycleAction) -> Void
    private let webView: WKWebView
    private let onClose: (BrowserWindowController) -> Void
    private var lastApplicationURL: URL?

    init(serverURL: URL?, actionHandler: @escaping (LifecycleAction) -> Void, onClose: @escaping (BrowserWindowController) -> Void) {
        self.serverURL = serverURL
        self.actionHandler = actionHandler
        self.onClose = onClose
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.isElementFullscreenEnabled = true
        let userContentController = WKUserContentController()
        userContentController.addScriptMessageHandler(DirectoryPickerMessageHandler(), contentWorld: .page, name: "piWebDirectoryPicker")
        userContentController.addScriptMessageHandler(NotificationMessageHandler(.requestPermission), contentWorld: .page, name: "piWebRequestNotificationPermission")
        userContentController.addScriptMessageHandler(NotificationMessageHandler(.notify), contentWorld: .page, name: "piWebNotification")
        userContentController.addUserScript(WKUserScript(source: piWebNativeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController = userContentController
        webView = WKWebView(frame: .zero, configuration: configuration)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Pi Workbench"
        window.tabbingMode = .disallowed
        // New windows open on the desktop the owner is looking at and may become their own full-screen Space.
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenPrimary]
        window.center()
        window.contentView = webView
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func load(_ url: URL) {
        if isAllowed(url) { lastApplicationURL = url }
        webView.load(URLRequest(url: url))
    }
    func resume(fallback: URL) {
        if let current = webView.url, isAllowed(current) { lastApplicationURL = current }
        load(lastApplicationURL ?? fallback)
    }
    func reload() { webView.reload() }
    func goBack() { if webView.canGoBack { webView.goBack() } }
    func goForward() { if webView.canGoForward { webView.goForward() } }
    func windowWillClose(_ notification: Notification) { onClose(self) }

    func showStartup(_ message: String) {
        showLifecyclePage(title: "Starting Pi Workbench", message: message, actions: "")
    }

    func showFailure(_ message: String) {
        showLifecyclePage(
            title: "PI WEB could not start",
            message: message,
            actions: """
              <a href="pi-workbench://logs">Open logs</a>
              <a href="pi-workbench://doctor">Run doctor</a>
              <a class="primary" href="pi-workbench://retry">Retry</a>
            """
        )
    }

    private func showLifecyclePage(title: String, message: String, actions: String) {
        if let current = webView.url, isAllowed(current) { lastApplicationURL = current }
        let html = """
        <!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          :root { color-scheme: light dark; font: 15px -apple-system, BlinkMacSystemFont, sans-serif; }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
          main { width: min(560px, calc(100% - 48px)); } h1 { font-size: 26px; margin: 0 0 10px; }
          p { line-height: 1.55; white-space: pre-wrap; color: color-mix(in srgb, CanvasText 72%, transparent); }
          nav { display: flex; gap: 10px; margin-top: 24px; flex-wrap: wrap; }
          a { color: ButtonText; background: ButtonFace; border: 1px solid ButtonBorder; border-radius: 7px; padding: 9px 14px; text-decoration: none; }
          a.primary { background: AccentColor; color: white; border-color: transparent; }
        </style><main><h1>\(escapeHTML(title))</h1><p>\(escapeHTML(message))</p><nav>\(actions)</nav></main>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let current = webView.url, isAllowed(current) { lastApplicationURL = current }
        window?.title = webView.title?.isEmpty == false ? webView.title! : "Pi Workbench"
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = prompt
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")

        let input = NSTextField(string: defaultText ?? "")
        input.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        alert.accessoryView = input

        let complete: (NSApplication.ModalResponse) -> Void = { response in
            completionHandler(response == .alertFirstButtonReturn ? input.stringValue : nil)
        }
        guard let window = webView.window else {
            complete(alert.runModal())
            return
        }
        alert.beginSheetModal(for: window, completionHandler: complete)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        let lines = message.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
        alert.messageText = lines.first.map(String.init) ?? "Confirm"
        alert.informativeText = lines.count > 1 ? String(lines[1]) : ""
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Confirm")
        alert.addButton(withTitle: "Cancel")
        guard let window = webView.window else { completionHandler(alert.runModal() == .alertFirstButtonReturn); return }
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "pi-workbench" {
            switch url.host {
            case "retry": actionHandler(.retry)
            case "logs": actionHandler(.logs)
            case "doctor": actionHandler(.doctor)
            default: break
            }
            decisionHandler(.cancel)
        } else if isAllowed(url) || url.scheme == "about" {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if isAllowed(url) { (NSApp.delegate as? AppDelegate)?.browserOpenWindow(url) }
        else { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // The dev server restarts whenever its own code is edited, so treat an unreachable server
        // as transient: show progress and let the lifecycle gate reload the window once it is back.
        showStartup("PI WEB is unavailable at \(serverURL?.absoluteString ?? "the configured URL"). Reconnecting\u{2026}\n\n\(error.localizedDescription)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.actionHandler(.retry) }
    }

    private func isAllowed(_ url: URL) -> Bool {
        guard let serverURL else { return false }
        return url.scheme?.lowercased() == serverURL.scheme?.lowercased()
            && url.host?.lowercased() == serverURL.host?.lowercased()
            && effectivePort(url) == effectivePort(serverURL)
    }

    private func effectivePort(_ url: URL) -> Int? { url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80) }
}

private func escapeHTML(_ value: String) -> String {
    value.replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
        .replacingOccurrences(of: "\"", with: "&quot;")
        .replacingOccurrences(of: "'", with: "&#39;")
}

private extension AppDelegate {
    func browserOpenWindow(_ url: URL) { browser.openWindow(url: url) }
}

NSWindow.allowsAutomaticWindowTabbing = false
private let application = NSApplication.shared
private let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
if let iconPath = ProcessInfo.processInfo.environment["PI_WEB_ICON"] {
    application.applicationIconImage = NSImage(contentsOfFile: iconPath)
} else if let iconURL = Bundle.main.url(forResource: "AppIcon", withExtension: "icns") {
    application.applicationIconImage = NSImage(contentsOf: iconURL)
}
application.run()
