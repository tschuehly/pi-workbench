import Foundation
import UserNotifications

protocol UserNotificationCenter {
    func requestAuthorization(options: UNAuthorizationOptions, completionHandler: @escaping @Sendable (Bool, Error?) -> Void)
    func add(_ request: UNNotificationRequest, withCompletionHandler completionHandler: (@Sendable (Error?) -> Void)?)
}

extension UNUserNotificationCenter: UserNotificationCenter {}

final class NativeNotificationBridge {
    private let center: UserNotificationCenter

    init(center: UserNotificationCenter = UNUserNotificationCenter.current()) {
        self.center = center
    }

    func notify(_ value: Any, reply: @escaping (Any?, String?) -> Void) {
        guard
            let values = value as? [String: Any],
            let title = values["title"] as? String,
            let body = values["body"] as? String,
            !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            reply(nil, "Notification requires a non-empty string title and a string body")
            return
        }

        center.requestAuthorization(options: [.alert, .sound]) { [center] granted, error in
            if let error {
                reply(nil, "Notification authorization failed: \(error.localizedDescription)")
            } else if !granted {
                reply(nil, "Notification authorization was denied")
            } else {
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = body
                center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)) { error in
                    if let error { reply(nil, "Notification delivery failed: \(error.localizedDescription)") }
                    else { reply(true, nil) }
                }
            }
        }
    }
}
