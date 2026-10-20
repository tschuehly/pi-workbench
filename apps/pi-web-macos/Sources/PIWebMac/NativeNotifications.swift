import Foundation
import UserNotifications

protocol UserNotificationCenter {
    func requestAuthorization(options: UNAuthorizationOptions, completionHandler: @escaping @Sendable (Bool, Error?) -> Void)
    func authorizationStatus(completionHandler: @escaping @Sendable (UNAuthorizationStatus) -> Void)
    func add(_ request: UNNotificationRequest, withCompletionHandler completionHandler: (@Sendable (Error?) -> Void)?)
    /// Delivered and pending requests as identifier → thread identifier.
    func notificationThreads(completionHandler: @escaping @Sendable ([String: String]) -> Void)
    func removeNotifications(withIdentifiers identifiers: [String])
}

extension UNUserNotificationCenter: UserNotificationCenter {
    func authorizationStatus(completionHandler: @escaping @Sendable (UNAuthorizationStatus) -> Void) {
        getNotificationSettings { completionHandler($0.authorizationStatus) }
    }

    func notificationThreads(completionHandler: @escaping @Sendable ([String: String]) -> Void) {
        getDeliveredNotifications { delivered in
            self.getPendingNotificationRequests { pending in
                let requests = delivered.map(\.request) + pending
                completionHandler(Dictionary(requests.map { ($0.identifier, $0.content.threadIdentifier) }, uniquingKeysWith: { first, _ in first }))
            }
        }
    }

    func removeNotifications(withIdentifiers identifiers: [String]) {
        removeDeliveredNotifications(withIdentifiers: identifiers)
        removePendingNotificationRequests(withIdentifiers: identifiers)
    }
}

let piWebNativeScript = """
Object.defineProperty(window, "piWebNative", {
  configurable: false,
  value: Object.freeze({
    pickDirectory: () => window.webkit.messageHandlers.piWebDirectoryPicker.postMessage({}),
    requestNotificationPermission: () => window.webkit.messageHandlers.piWebRequestNotificationPermission.postMessage({}),
    notify: (title, body, target) => window.webkit.messageHandlers.piWebNotification.postMessage({ title, body, ...target }),
    getSleepDisabled: () => window.webkit.messageHandlers.piWebGetSleepDisabled.postMessage({}),
    setSleepDisabled: disabled => window.webkit.messageHandlers.piWebSetSleepDisabled.postMessage(disabled),
    openLocalFile: path => window.webkit.messageHandlers.piWebOpenLocalFile.postMessage(path),
    revealLocalFile: path => window.webkit.messageHandlers.piWebRevealLocalFile.postMessage(path)
  })
});
"""

/// An existing local HTML file (opens in the browser) or plain folder (opens in Finder), judged after resolving
/// symlinks. Other files and packages such as `.app` bundles are refused: opening them could launch apps or scripts.
func localOpenTarget(_ value: Any) -> URL? {
    guard let path = value as? String, path.hasPrefix("/") else { return nil }
    let url = URL(fileURLWithPath: path).resolvingSymlinksInPath()
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else { return nil }
    if isDirectory.boolValue { return (try? url.resourceValues(forKeys: [.isPackageKey]).isPackage) == false ? URL(fileURLWithPath: url.path, isDirectory: true) : nil }
    return ["html", "htm"].contains(url.pathExtension.lowercased()) ? url : nil
}

/// Any existing local file or folder: revealing it in Finder only selects it, nothing opens.
func localRevealTarget(_ value: Any) -> URL? {
    guard let path = value as? String, path.hasPrefix("/"), FileManager.default.fileExists(atPath: path) else { return nil }
    return URL(fileURLWithPath: path)
}

enum NativeNotificationCommand {
    case requestPermission
    case notify
}

typealias NativeNotificationReply = (Any?, String?) -> Void

func currentUserNotificationCenter() -> UNUserNotificationCenter? {
    guard Bundle.main.bundleIdentifier != nil else { return nil }
    return .current()
}

final class NativeNotificationBridge {
    private let center: UserNotificationCenter?

    init(center: UserNotificationCenter? = nil) {
        self.center = center
    }

    func requestPermission(reply: @escaping NativeNotificationReply) {
        guard let center = center ?? currentUserNotificationCenter() else {
            reply(nil, "Native notifications require the installed app bundle")
            return
        }
        center.requestAuthorization(options: [.alert, .sound]) { granted, error in
            if let error { reply(nil, "Notification authorization failed: \(error.localizedDescription)") }
            else if !granted { reply(nil, "Notification authorization was denied") }
            else { reply(true, nil) }
        }
    }

    func notify(_ value: Any, reply: @escaping NativeNotificationReply) {
        guard
            let values = value as? [String: Any],
            let title = values["title"] as? String,
            let body = values["body"] as? String,
            !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            (values["sessionId"] == nil && values["machineId"] == nil && values["message"] == nil) ||
                ((values["sessionId"] as? String)?.isEmpty == false && (values["machineId"] as? String)?.isEmpty == false
                    && (values["message"] == nil || (values["message"] as? String).map(isNotificationMessageAnchor) == true))
        else {
            reply(nil, "Notification requires a non-empty string title, a string body, and a valid Chat target")
            return
        }

        guard let center = center ?? currentUserNotificationCenter() else {
            reply(nil, "Native notifications require the installed app bundle")
            return
        }

        center.authorizationStatus { [center] status in
            guard status == .authorized || status == .provisional else {
                let message = status == .denied
                    ? "Notification authorization was denied"
                    : status == .notDetermined
                        ? "Notification authorization has not been requested"
                        : "Notification authorization is unavailable"
                reply(nil, message)
                return
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            var identifier = UUID().uuidString
            if let sessionId = values["sessionId"] as? String, let machineId = values["machineId"] as? String {
                content.userInfo = ["sessionId": sessionId, "machineId": machineId]
                if let message = values["message"] as? String { content.userInfo["message"] = message }
                // Notification Center groups per Chat, and viewing the Chat clears its thread.
                content.threadIdentifier = notificationThreadIdentifier(machineId: machineId, sessionId: sessionId)
                identifier = "\(content.threadIdentifier)/\(identifier)"
            }
            content.sound = .default
            center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil)) { error in
                if let error { reply(nil, "Notification delivery failed: \(error.localizedDescription)") }
                else { reply(true, nil) }
            }
        }
    }
}

extension NativeNotificationBridge {
    /// Removes delivered and pending notifications for the Chat `shown` displays; other Chats keep theirs.
    func clearChat(shown: URL?) {
        guard let thread = chatThreadIdentifier(of: shown), let center = center ?? currentUserNotificationCenter() else { return }
        center.notificationThreads { threads in
            let identifiers = notificationIdentifiers(threads, thread: thread)
            if !identifiers.isEmpty { center.removeNotifications(withIdentifiers: identifiers) }
        }
    }
}

func notificationThreadIdentifier(machineId: String, sessionId: String) -> String {
    let encode = { (value: String) in value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? value }
    return "pi-chat:\(encode(machineId)):\(encode(sessionId))"
}

/// The thread of the Chat a window URL shows; PI WEB omits `machine` for the local machine.
func chatThreadIdentifier(of url: URL?) -> String? {
    guard let sessionId = chatSessionId(of: url), !sessionId.isEmpty, let url else { return nil }
    let machineId = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "machine" }?.value
    return notificationThreadIdentifier(machineId: machineId ?? "local", sessionId: sessionId)
}

func notificationIdentifiers(_ threads: [String: String], thread: String) -> [String] {
    threads.filter { $0.value == thread }.map(\.key).sorted()
}

func handleNativeNotificationMessage(
    _ command: NativeNotificationCommand,
    isMainFrame: Bool,
    value: Any,
    notifications: NativeNotificationBridge,
    reply: @escaping NativeNotificationReply
) {
    guard isMainFrame else {
        reply(nil, "Notifications are only available to the main page")
        return
    }
    switch command {
    case .requestPermission: notifications.requestPermission(reply: reply)
    case .notify: notifications.notify(value, reply: reply)
    }
}

/// The message a notification reveals: PI WEB's `NOTIFICATION_ANCHOR`, `entry:`, `ask:`, or `dialog:` and a safe id.
func isNotificationMessageAnchor(_ value: String) -> Bool {
    value.count <= 128 && value.range(of: "^(entry|ask|dialog):[A-Za-z0-9._-]{1,120}$", options: .regularExpression) != nil
}

/// `message` is PI WEB's one-shot reveal anchor; the page removes it and window restoration ignores it.
func notificationChatURL(serverURL: URL, machineId: String, sessionId: String, message: String? = nil) -> URL? {
    guard !machineId.isEmpty, !sessionId.isEmpty, var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false) else { return nil }
    components.queryItems = [URLQueryItem(name: "machine", value: machineId), URLQueryItem(name: "session", value: sessionId)]
        + (message.map(isNotificationMessageAnchor) == true ? [URLQueryItem(name: "message", value: message)] : [])
    return components.url
}

/// Called with `machineId`, `sessionId`, and `message` as arguments, never interpolated; PI WEB's `NATIVE_NOTIFICATION_OPEN_EVENT`.
/// The page opens the Chat as one of its tabs, or has the live window holding it show it; it never reloads.
let notificationRevealScript = """
window.dispatchEvent(new CustomEvent("pi-web:notification-open", { detail: { machineId, sessionId, message } }));
"""

/// Called with `machineId` and `sessionId` as arguments; true when the page's window holds the Chat among its tabs
/// (PI WEB's `NATIVE_NOTIFICATION_HOLDS_EVENT`). Asking from here wakes a window suspended on another Space,
/// which would miss PI WEB's own requests between windows. Older pages hold nothing.
let notificationHoldsScript = """
return !window.dispatchEvent(new CustomEvent("pi-web:notification-holds", { cancelable: true, detail: { machineId, sessionId } }));
"""

/// The session a Pi Workbench window shows, from its `session` query item.
func chatSessionId(of url: URL?) -> String? {
    url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "session" }?.value }
}

/// What a window shows versus what it may restore. Every reported route counts as shown, so notification routing
/// follows the Chat on screen even with a panel (`tool`), another `view`, or plugin query keys that restoration refuses.
struct WindowRoute {
    private(set) var shown: URL?
    var restorable: URL?

    /// True when the restorable route changed.
    mutating func report(_ url: URL, server: URL) -> Bool {
        // The native startup and failure pages (about:blank) keep the route the window resumes to.
        if url.host?.lowercased() == server.host?.lowercased() { shown = url }
        guard let safe = WindowRestoration.applicationURL(url, server: server), safe != restorable else { return false }
        restorable = safe
        return true
    }
}

struct NotificationWindowCandidate {
    let url: URL?
    let isOnActiveSpace: Bool
    /// Its page answered that its window holds the Chat among its tabs.
    var holdsChat = false
    /// A live PI WEB page, not the native startup or failure page.
    var showsApplication = true
}

enum NotificationRoute: Equatable {
    /// Hand the click to the window's live page, which shows the Chat or routes it to the window holding it.
    case open(Int)
    /// The window has no live page: load the Chat in it, keeping its PI WEB window id.
    case load(Int, URL)
    /// No Chat to open: only bring the window forward.
    case focus(Int)
    case newWindow(URL?)
}

/// Pick the window for a notification's Chat from windows ordered front to back: the one holding the Chat (so its
/// Space comes forward), else the one on the Space the owner is looking at, else the frontmost. A live page is never
/// reloaded: a reload would make the page claim its window again and take Chats from their windows.
func notificationRoute(_ windows: [NotificationWindowCandidate], sessionId: String?, chatURL: URL?) -> NotificationRoute {
    // ponytail: the shown-URL match ignores the machine (window URLs omit the local one); the page's own answer compares both.
    let holder = sessionId.flatMap { session in windows.firstIndex { $0.holdsChat || chatSessionId(of: $0.url) == session } }
    guard let index = holder ?? windows.firstIndex(where: \.isOnActiveSpace) ?? (windows.isEmpty ? nil : 0) else { return .newWindow(chatURL) }
    guard let chatURL else { return .focus(index) }
    if windows[index].showsApplication { return .open(index) }
    let windowId = windows[index].url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "win" } }
    guard let windowId, var components = URLComponents(url: chatURL, resolvingAgainstBaseURL: false) else { return .load(index, chatURL) }
    components.queryItems = (components.queryItems ?? []) + [windowId]
    return .load(index, components.url ?? chatURL)
}

/// Route first so the chosen window is key before activation; activating first would bring forward
/// whichever window was key, possibly on another Space. Routing finishes once every window answered.
func activateFromNotificationClick(
    activateApplication: @escaping () -> Void,
    routeChat: (@escaping () -> Void) -> Void,
    complete: @escaping () -> Void
) {
    routeChat {
        activateApplication()
        complete()
    }
}
