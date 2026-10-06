import Foundation
import UserNotifications

protocol UserNotificationCenter {
    func requestAuthorization(options: UNAuthorizationOptions, completionHandler: @escaping @Sendable (Bool, Error?) -> Void)
    func authorizationStatus(completionHandler: @escaping @Sendable (UNAuthorizationStatus) -> Void)
    func add(_ request: UNNotificationRequest, withCompletionHandler completionHandler: (@Sendable (Error?) -> Void)?)
}

extension UNUserNotificationCenter: UserNotificationCenter {
    func authorizationStatus(completionHandler: @escaping @Sendable (UNAuthorizationStatus) -> Void) {
        getNotificationSettings { completionHandler($0.authorizationStatus) }
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
            if let sessionId = values["sessionId"] as? String, let machineId = values["machineId"] as? String {
                content.userInfo = ["sessionId": sessionId, "machineId": machineId]
                if let message = values["message"] as? String { content.userInfo["message"] = message }
            }
            content.sound = .default
            center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)) { error in
                if let error { reply(nil, "Notification delivery failed: \(error.localizedDescription)") }
                else { reply(true, nil) }
            }
        }
    }
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

enum NotificationWindowAction: Equatable {
    case load(URL)
    /// The window already shows the Chat: hand the anchor to the page instead of reloading it.
    case reveal
    case none
}

func notificationWindowAction(shown: URL?, chatURL: URL?, sessionId: String?, message: String?) -> NotificationWindowAction {
    guard let chatURL else { return .none }
    if chatSessionId(of: shown) != sessionId { return .load(chatURL) }
    return message.map(isNotificationMessageAnchor) == true ? .reveal : .none
}

/// Called with `machineId`, `sessionId`, and `message` as arguments, never interpolated; PI WEB's `NATIVE_NOTIFICATION_OPEN_EVENT`.
let notificationRevealScript = """
window.dispatchEvent(new CustomEvent("pi-web:notification-open", { detail: { machineId, sessionId, message } }));
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
}

/// Pick the window for a notification's Chat from windows ordered front to back: the one already
/// showing that session (so its Space comes forward), else the one on the Space the owner is looking at,
/// else the frontmost. Nil means there is no window, so open one.
func notificationWindowIndex(_ windows: [NotificationWindowCandidate], sessionId: String?) -> Int? {
    // ponytail: matches by session ID alone; window URLs omit the local machine. Compare machine too once remote Chats get their own windows.
    if let sessionId, let showing = windows.firstIndex(where: { chatSessionId(of: $0.url) == sessionId }) { return showing }
    return windows.firstIndex { $0.isOnActiveSpace } ?? (windows.isEmpty ? nil : 0)
}

/// Route first so the chosen window is key before activation; activating first would bring forward
/// whichever window was key, possibly on another Space.
func activateFromNotificationClick(
    activateApplication: () -> Void,
    routeChat: () -> Void,
    complete: () -> Void
) {
    routeChat()
    activateApplication()
    complete()
}
