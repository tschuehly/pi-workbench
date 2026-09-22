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
    notify: (title, body) => window.webkit.messageHandlers.piWebNotification.postMessage({ title, body })
  })
});
"""

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
            !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            reply(nil, "Notification requires a non-empty string title and a string body")
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

func activateFromNotificationClick(
    activateApplication: () -> Void,
    bringWindowForward: () -> Void,
    complete: () -> Void
) {
    activateApplication()
    bringWindowForward()
    complete()
}
