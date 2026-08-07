import AppKit
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

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private let configuration = PIWebConfiguration.load()
    private lazy var browser = BrowserCoordinator(serverURL: configuration?.serverURL) { [weak self] action in
        self?.handle(action)
    }
    private lazy var lifecycle = LifecycleController(configuration: configuration, browser: browser)

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()
        browser.openWindow()
        NSApp.activate(ignoringOtherApps: true)
        lifecycle.start()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { browser.openWindow() }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    @objc private func newWindow(_ sender: Any?) { browser.openWindow() }
    @objc private func newTab(_ sender: Any?) { browser.openTab() }
    @objc private func reload(_ sender: Any?) { browser.reloadKeyWindow() }
    @objc private func goBack(_ sender: Any?) { browser.goBackInKeyWindow() }
    @objc private func goForward(_ sender: Any?) { browser.goForwardInKeyWindow() }
    @objc private func restartUI(_ sender: Any?) { lifecycle.restartUI() }
    @objc private func openLifecycleStatus(_ sender: Any?) { lifecycle.showStatus() }

    @objc private func restartSessionRuntime(_ sender: Any?) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Restart the PI WEB session runtime?"
        alert.informativeText = "This can abort in-flight turns, asks, and terminals. The UI is restarted separately and normally does not require this action."
        alert.addButton(withTitle: "Restart Session Runtime")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        lifecycle.restartSessionRuntime()
    }

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
        fileMenu.addItem(withTitle: "New Tab", action: #selector(newTab(_:)), keyEquivalent: "t")
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
        lifecycleMenu.addItem(withTitle: "Restart PI WEB UI", action: #selector(restartUI(_:)), keyEquivalent: "")
        lifecycleMenu.addItem(withTitle: "Restart Session Runtime…", action: #selector(restartSessionRuntime(_:)), keyEquivalent: "")
        lifecycleMenu.addItem(.separator())
        lifecycleMenu.addItem(withTitle: "Open Lifecycle Status", action: #selector(openLifecycleStatus(_:)), keyEquivalent: "")

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Show Previous Tab", action: #selector(NSWindow.selectPreviousTab(_:)), keyEquivalent: "{")
        windowMenu.addItem(withTitle: "Show Next Tab", action: #selector(NSWindow.selectNextTab(_:)), keyEquivalent: "}")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Move Tab to New Window", action: #selector(NSWindow.moveTabToNewWindow(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "Merge All Windows", action: #selector(NSWindow.mergeAllWindows(_:)), keyEquivalent: "")
        NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = mainMenu
    }
}

private struct NativeStatusReport: Decodable {
    let schemaVersion: Int
    let installMode: InstallMode
    let components: [NativeComponentStatus]
}

private enum InstallMode: String, Decodable {
    case notInstalled = "not-installed"
    case development
    case developmentIncomplete = "development-incomplete"
    case production
    case productionIncomplete = "production-incomplete"
    case mixed
    case partial
}

private struct NativeComponentStatus: Decodable {
    let component: Component
    let ownership: Ownership
    let health: Health
}

private enum Component: String, Decodable { case sessiond, web, uiDev }
private enum Ownership: String, Decodable { case managed, unmanaged, conflict, absent }
private enum Health: String, Decodable { case healthy, starting, unhealthy, unknown }

private enum StackState {
    case ready
    case stopped
    case waiting(String)
    case failed(String)
}

private struct CommandResult {
    let output: String
    let status: Int32
}

private final class LifecycleController {
    private let configuration: PIWebConfiguration?
    private weak var browser: BrowserCoordinator?
    private let queue = DispatchQueue(label: "works.pi.workbench.lifecycle", qos: .userInitiated)

    init(configuration: PIWebConfiguration?, browser: BrowserCoordinator) {
        self.configuration = configuration
        self.browser = browser
    }

    func start() {
        onMain { self.browser?.showStartup("Checking installed PI WEB services…") }
        queue.async { [weak self] in self?.prepareStack(reload: false) }
    }

    func restartUI() {
        runRestart(component: "ui", message: "Restarting PI WEB UI…")
    }

    func restartSessionRuntime() {
        runRestart(component: "sessiond", message: "Restarting session runtime…")
    }

    func showStatus() { showReport(command: ["status", "--json"], title: "PI WEB Lifecycle Status") }
    func showDoctor() { showReport(command: ["doctor", "--json"], title: "PI WEB Doctor") }

    private func runRestart(component: String, message: String) {
        onMain { self.browser?.showStartup(message) }
        queue.async { [weak self] in
            guard let self else { return }
            do {
                let result = try self.runCLI(["restart", "--component", component])
                guard result.status == 0 else { throw LifecycleError.command(result.output) }
                self.prepareStack(reload: true)
            } catch {
                self.showFailure(error.localizedDescription)
            }
        }
    }

    private func prepareStack(reload: Bool) {
        do {
            var status = try typedStatus()
            switch stackState(status) {
            case .ready:
                showReady(reload: reload)
                return
            case .stopped:
                onMain { self.browser?.showStartup("Starting installed PI WEB services…") }
                let start = try runCLI(["start"])
                guard start.status == 0 else { throw LifecycleError.command(start.output) }
            case .waiting(let message):
                onMain { self.browser?.showStartup(message) }
            case .failed(let message):
                throw LifecycleError.status(message)
            }

            for _ in 0..<60 {
                Thread.sleep(forTimeInterval: 1)
                status = try typedStatus()
                switch stackState(status) {
                case .ready:
                    showReady(reload: reload)
                    return
                case .waiting(let message):
                    onMain { self.browser?.showStartup(message) }
                case .stopped:
                    throw LifecycleError.status("Installed services stopped again before becoming healthy.")
                case .failed(let message):
                    throw LifecycleError.status(message)
                }
            }
            throw LifecycleError.status("PI WEB services did not report healthy UI and session runtime components within 60 seconds.")
        } catch {
            showFailure(error.localizedDescription)
        }
    }

    private func typedStatus() throws -> NativeStatusReport {
        let result = try runCLI(["status", "--json"])
        guard result.status == 0 else { throw LifecycleError.command(result.output) }
        guard let data = result.output.data(using: .utf8) else { throw LifecycleError.invalidStatus }
        let report: NativeStatusReport
        do { report = try JSONDecoder().decode(NativeStatusReport.self, from: data) }
        catch { throw LifecycleError.invalidStatus }
        guard report.schemaVersion == 1 else { throw LifecycleError.invalidStatus }
        let ids = report.components.map(\.component)
        guard Set(ids).count == ids.count else { throw LifecycleError.invalidStatus }
        return report
    }

    private func stackState(_ report: NativeStatusReport) -> StackState {
        guard report.installMode == .development || report.installMode == .mixed else {
            return .failed(report.installMode == .notInstalled
                ? "PI WEB development services are not installed. Re-run the Pi Workbench installer."
                : "The installed PI WEB services are not a complete development installation. Run PI WEB doctor, then re-run the installer.")
        }
        guard
            let sessiond = report.components.first(where: { $0.component == .sessiond }),
            let ui = report.components.first(where: { $0.component == .uiDev }) ?? report.components.first(where: { $0.component == .web })
        else { return .failed("Typed lifecycle status omitted the UI or session runtime component. Re-run the installer.") }
        let required = [sessiond, ui]
        if let conflict = required.first(where: { $0.ownership == .conflict || $0.ownership == .unmanaged }) {
            return .failed("PI WEB reported \(conflict.ownership.rawValue) ownership for \(conflict.component.rawValue). Run doctor before retrying.")
        }
        if required.allSatisfy({ $0.ownership == .managed && $0.health == .healthy }) { return .ready }
        if required.allSatisfy({ $0.ownership == .absent }) { return .stopped }
        if required.contains(where: { $0.ownership == .absent }) {
            return .failed("Only part of the installed PI WEB stack is running. Run doctor before retrying.")
        }
        return .waiting("Waiting for typed PI WEB UI and session runtime health…")
    }

    private func runCLI(_ arguments: [String]) throws -> CommandResult {
        guard let configuration else { throw LifecycleError.configuration }
        let process = Process()
        process.executableURL = configuration.cliURL
        process.currentDirectoryURL = configuration.checkoutURL
        process.arguments = arguments
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

    private func showReady(reload: Bool) {
        onMain {
            self.browser?.showReady()
            if reload { self.browser?.reloadAll() }
        }
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
    case invalidStatus
    case command(String)
    case launch(String)
    case status(String)

    var errorDescription: String? {
        switch self {
        case .configuration: return "The generated PI WEB bundle configuration is missing or invalid. Re-run the Pi Workbench installer."
        case .invalidStatus: return "PI WEB returned an invalid typed lifecycle status. Run doctor or reinstall PI WEB services."
        case .command(let output): return output.isEmpty ? "The PI WEB lifecycle command failed." : output
        case .launch(let message): return "The configured PI WEB CLI could not be launched: \(message)"
        case .status(let message): return message
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

    func openTab(url: URL? = nil, relativeTo parent: NSWindow? = nil) {
        let parent = parent ?? NSApp.keyWindow
        let controller = openWindow(url: url)
        guard let parent, let child = controller.window, parent !== child else { return }
        parent.addTabbedWindow(child, ordered: .above)
        child.makeKeyAndOrderFront(nil)
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
        controllers.values.forEach { $0.load(serverURL) }
    }

    func reloadAll() { controllers.values.forEach { $0.reload() } }
    func reloadKeyWindow() { keyController?.reload() }
    func goBackInKeyWindow() { keyController?.goBack() }
    func goForwardInKeyWindow() { keyController?.goForward() }

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

private final class BrowserWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    private let serverURL: URL?
    private let actionHandler: (LifecycleAction) -> Void
    private let webView: WKWebView
    private let onClose: (BrowserWindowController) -> Void

    init(serverURL: URL?, actionHandler: @escaping (LifecycleAction) -> Void, onClose: @escaping (BrowserWindowController) -> Void) {
        self.serverURL = serverURL
        self.actionHandler = actionHandler
        self.onClose = onClose
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.isElementFullscreenEnabled = true
        let userContentController = WKUserContentController()
        userContentController.addScriptMessageHandler(DirectoryPickerMessageHandler(), contentWorld: .page, name: "piWebDirectoryPicker")
        userContentController.addUserScript(WKUserScript(source: """
            Object.defineProperty(window, "piWebNative", {
              configurable: false,
              value: Object.freeze({ pickDirectory: () => window.webkit.messageHandlers.piWebDirectoryPicker.postMessage({}) })
            });
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController = userContentController
        webView = WKWebView(frame: .zero, configuration: configuration)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Pi Workbench"
        window.tabbingIdentifier = "pi-web-browser"
        window.tabbingMode = .preferred
        window.center()
        window.contentView = webView
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func load(_ url: URL) { webView.load(URLRequest(url: url)) }
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
        if isAllowed(url) { (NSApp.delegate as? AppDelegate)?.browserOpenTab(url) }
        else { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showFailure("PI WEB became unavailable at \(serverURL?.absoluteString ?? "the configured URL").\n\n\(error.localizedDescription)")
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
    func browserOpenTab(_ url: URL) { browser.openTab(url: url) }
}

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
