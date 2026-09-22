import Foundation
import JavaScriptCore
import UserNotifications

private struct TestError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

private final class FakeCenter: UserNotificationCenter {
    var granted = true
    var status: UNAuthorizationStatus = .authorized
    var authorizationError: Error?
    var deliveryError: Error?
    var authorizationRequests = 0
    var statusRequests = 0
    var request: UNNotificationRequest?

    func requestAuthorization(options: UNAuthorizationOptions, completionHandler: @escaping @Sendable (Bool, Error?) -> Void) {
        authorizationRequests += 1
        precondition(options.contains([.alert, .sound]))
        completionHandler(granted, authorizationError)
    }

    func authorizationStatus(completionHandler: @escaping @Sendable (UNAuthorizationStatus) -> Void) {
        statusRequests += 1
        completionHandler(status)
    }

    func add(_ request: UNNotificationRequest, withCompletionHandler completionHandler: (@Sendable (Error?) -> Void)?) {
        self.request = request
        completionHandler?(deliveryError)
    }
}

@main
struct NativeNotificationTests {
    static func main() {
        let permission = FakeCenter()
        NativeNotificationBridge(center: permission).requestPermission { result, error in
            precondition(result as? Bool == true && error == nil)
        }
        precondition(permission.authorizationRequests == 1)
        precondition(permission.statusRequests == 0)
        precondition(permission.request == nil)

        let refusedPermission = FakeCenter()
        refusedPermission.granted = false
        NativeNotificationBridge(center: refusedPermission).requestPermission { result, error in
            precondition(result == nil && error?.contains("denied") == true)
        }
        precondition(refusedPermission.authorizationRequests == 1 && refusedPermission.request == nil)

        let invalid = FakeCenter()
        NativeNotificationBridge(center: invalid).notify(["title": " ", "body": "body"]) { result, error in
            precondition(result == nil && error?.contains("non-empty") == true)
        }
        precondition(invalid.authorizationRequests == 0 && invalid.statusRequests == 0)
        NativeNotificationBridge(center: invalid).notify(["title": "Title", "body": 42]) { result, error in
            precondition(result == nil && error?.contains("string body") == true)
        }
        precondition(invalid.authorizationRequests == 0 && invalid.statusRequests == 0)

        var unbundledError: String?
        NativeNotificationBridge().notify(["title": "Title", "body": "Body"]) { result, error in
            precondition(result == nil)
            unbundledError = error
        }
        precondition(unbundledError?.contains("installed app") == true)
        NativeNotificationBridge().requestPermission { result, error in
            precondition(result == nil && error?.contains("installed app") == true)
        }

        let denied = FakeCenter()
        denied.status = .denied
        NativeNotificationBridge(center: denied).notify(["title": "Title", "body": "Body"]) { result, error in
            precondition(result == nil && error?.contains("denied") == true)
        }
        precondition(denied.authorizationRequests == 0 && denied.statusRequests == 1 && denied.request == nil)

        let notDetermined = FakeCenter()
        notDetermined.status = .notDetermined
        NativeNotificationBridge(center: notDetermined).notify(["title": "Title", "body": "Body"]) { result, error in
            precondition(result == nil && error?.contains("not been requested") == true)
        }
        precondition(notDetermined.authorizationRequests == 0 && notDetermined.statusRequests == 1 && notDetermined.request == nil)

        let authorizationFailure = FakeCenter()
        authorizationFailure.authorizationError = TestError("authorization test error")
        NativeNotificationBridge(center: authorizationFailure).requestPermission { result, error in
            precondition(result == nil && error?.contains("authorization test error") == true)
        }
        precondition(authorizationFailure.authorizationRequests == 1 && authorizationFailure.request == nil)

        let deliveryFailure = FakeCenter()
        deliveryFailure.deliveryError = TestError("delivery test error")
        NativeNotificationBridge(center: deliveryFailure).notify(["title": "Title", "body": "Body"]) { result, error in
            precondition(result == nil && error?.contains("delivery test error") == true)
        }

        let success = FakeCenter()
        success.status = .provisional
        NativeNotificationBridge(center: success).notify(["title": "Title", "body": "Body"]) { result, error in
            precondition(result as? Bool == true && error == nil)
        }
        precondition(success.authorizationRequests == 0 && success.statusRequests == 1)
        precondition(success.request?.content.title == "Title")
        precondition(success.request?.content.body == "Body")
        precondition(success.request?.content.sound == .default)
        precondition(success.request?.trigger == nil)

        let guarded = FakeCenter()
        handleNativeNotificationMessage(.notify, isMainFrame: false, value: ["title": "Title", "body": "Body"], notifications: NativeNotificationBridge(center: guarded)) { result, error in
            precondition(result == nil && error?.contains("main page") == true)
        }
        precondition(guarded.authorizationRequests == 0 && guarded.statusRequests == 0 && guarded.request == nil)

        var clickEvents: [String] = []
        activateFromNotificationClick(
            activateApplication: { clickEvents.append("activate") },
            bringWindowForward: { clickEvents.append("window") },
            complete: { clickEvents.append("complete") }
        )
        precondition(clickEvents == ["activate", "window", "complete"])

        guard let context = JSContext() else { preconditionFailure("JavaScriptCore unavailable") }
        context.evaluateScript("""
            var window = this;
            var permissionPayload, notificationPayload;
            window.webkit = { messageHandlers: {
              piWebRequestNotificationPermission: { postMessage: value => { permissionPayload = value; return Promise.resolve(true); } },
              piWebNotification: { postMessage: value => { notificationPayload = value; return Promise.resolve(true); } },
              piWebDirectoryPicker: { postMessage: value => Promise.resolve(value) }
            }};
            """)
        context.evaluateScript(piWebNativeScript)
        precondition(context.evaluateScript("window.piWebNative.requestNotificationPermission() instanceof Promise")?.toBool() == true)
        precondition(context.evaluateScript("Object.keys(permissionPayload).length")?.toInt32() == 0)
        precondition(context.evaluateScript("window.piWebNative.notify('Title', 'Body') instanceof Promise")?.toBool() == true)
        precondition(context.evaluateScript("notificationPayload.title === 'Title' && notificationPayload.body === 'Body'")?.toBool() == true)
        precondition(context.evaluateScript("Object.isFrozen(window.piWebNative)")?.toBool() == true)

        print("PASS: native notification permission, delivery, JS Promise, frame, and click contracts")
    }
}
