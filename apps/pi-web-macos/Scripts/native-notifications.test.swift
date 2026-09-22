import Foundation
import UserNotifications

private struct TestError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

private final class FakeCenter: UserNotificationCenter {
    var granted = true
    var authorizationError: Error?
    var deliveryError: Error?
    var authorizationRequests = 0
    var request: UNNotificationRequest?

    func requestAuthorization(options: UNAuthorizationOptions, completionHandler: @escaping @Sendable (Bool, Error?) -> Void) {
        authorizationRequests += 1
        precondition(options.contains([.alert, .sound]))
        completionHandler(granted, authorizationError)
    }

    func add(_ request: UNNotificationRequest, withCompletionHandler completionHandler: (@Sendable (Error?) -> Void)?) {
        self.request = request
        completionHandler?(deliveryError)
    }
}

@main
struct NativeNotificationTests {
    static func main() {
        let invalid = FakeCenter()
        NativeNotificationBridge(center: invalid).notify(["title": " ", "body": "body"]) { result, error in
            precondition(result == nil && error?.contains("non-empty") == true)
        }
        precondition(invalid.authorizationRequests == 0)
        NativeNotificationBridge(center: invalid).notify(["title": "Title", "body": 42]) { result, error in
            precondition(result == nil && error?.contains("string body") == true)
        }
        precondition(invalid.authorizationRequests == 0)

        var unbundledError: String?
        NativeNotificationBridge().notify(["title": "Title", "body": "Body"]) { result, error in
            precondition(result == nil)
            unbundledError = error
        }
        precondition(unbundledError?.contains("installed app") == true)

        let denied = FakeCenter()
        denied.granted = false
        NativeNotificationBridge(center: denied).notify(["title": "Title", "body": "Body"]) { result, error in
            precondition(result == nil && error?.contains("denied") == true)
        }
        precondition(denied.request == nil)

        let authorizationFailure = FakeCenter()
        authorizationFailure.authorizationError = TestError("authorization test error")
        NativeNotificationBridge(center: authorizationFailure).notify(["title": "Title", "body": "Body"]) { result, error in
            precondition(result == nil && error?.contains("authorization test error") == true)
        }

        let deliveryFailure = FakeCenter()
        deliveryFailure.deliveryError = TestError("delivery test error")
        NativeNotificationBridge(center: deliveryFailure).notify(["title": "Title", "body": "Body"]) { result, error in
            precondition(result == nil && error?.contains("delivery test error") == true)
        }

        let success = FakeCenter()
        NativeNotificationBridge(center: success).notify(["title": "Title", "body": "Body"]) { result, error in
            precondition(result as? Bool == true && error == nil)
        }
        precondition(success.request?.content.title == "Title")
        precondition(success.request?.content.body == "Body")
        precondition(success.request?.content.sound == .default)
        precondition(success.request?.trigger == nil)
        print("PASS: native notifications validate input and surface authorization and delivery outcomes")
    }
}
