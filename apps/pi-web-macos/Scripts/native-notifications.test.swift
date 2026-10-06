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
        precondition(success.request?.content.userInfo["sessionId"] as? String == nil)
        let routed = FakeCenter()
        NativeNotificationBridge(center: routed).notify(["title": "Chat", "body": "Question", "machineId": "remote", "sessionId": "session-1"]) { result, error in
            precondition(result as? Bool == true && error == nil)
        }
        precondition(routed.request?.content.userInfo["sessionId"] as? String == "session-1")
        precondition(routed.request?.content.userInfo["machineId"] as? String == "remote")
        NativeNotificationBridge(center: routed).notify(["title": "Chat", "body": "Question", "sessionId": "session-1"]) { result, error in
            precondition(result == nil && error != nil)
        }
        precondition(notificationChatURL(serverURL: URL(string: "https://localhost/app/")!, machineId: "remote", sessionId: "one & two")?.absoluteString == "https://localhost/app/?machine=remote&session=one%20%26%20two")

        // ISSUE-083: an optional message anchor travels from the bridge to userInfo and the Chat URL.
        let anchored = FakeCenter()
        NativeNotificationBridge(center: anchored).notify(["title": "Chat", "body": "Finished", "machineId": "local", "sessionId": "s", "message": "entry:a1b2"]) { result, error in
            precondition(result as? Bool == true && error == nil)
        }
        precondition(anchored.request?.content.userInfo["message"] as? String == "entry:a1b2")
        for bad: Any in ["entry:", "other:a", "entry:a b", "entry:../x", "entry:" + String(repeating: "a", count: 121), 42] {
            let refused = FakeCenter()
            NativeNotificationBridge(center: refused).notify(["title": "Chat", "body": "B", "machineId": "local", "sessionId": "s", "message": bad]) { result, error in
                precondition(result == nil && error != nil, "unsafe anchor \(bad) is refused")
            }
            precondition(refused.request == nil)
        }
        NativeNotificationBridge(center: anchored).notify(["title": "Chat", "body": "B", "message": "entry:a"]) { result, error in
            precondition(result == nil && error != nil, "an anchor needs a Chat target")
        }
        let server083 = URL(string: "http://127.0.0.1:8505")!
        let anchoredURL = notificationChatURL(serverURL: server083, machineId: "local", sessionId: "s", message: "ask:q-1")
        precondition(anchoredURL?.absoluteString == "http://127.0.0.1:8505?machine=local&session=s&message=ask:q-1")
        precondition(notificationChatURL(serverURL: server083, machineId: "local", sessionId: "s", message: "x y")?.absoluteString == "http://127.0.0.1:8505?machine=local&session=s", "an unsafe anchor is dropped")
        precondition(chatSessionId(of: anchoredURL) == "s")
        precondition(WindowRestoration.applicationURL(anchoredURL!, server: server083)?.absoluteString == "http://127.0.0.1:8505?machine=local&session=s", "restoration strips the one-shot anchor")
        var anchoredRoute = WindowRoute()
        precondition(anchoredRoute.report(anchoredURL!, server: server083) && chatSessionId(of: anchoredRoute.restorable) == "s" && anchoredRoute.shown == anchoredURL)
        let showingS = URL(string: "http://127.0.0.1:8505?session=s&view=chat")
        precondition(notificationWindowAction(shown: showingS, chatURL: anchoredURL, sessionId: "s", message: "ask:q-1") == .reveal, "the Chat on screen reveals without reloading")
        precondition(notificationWindowAction(shown: showingS, chatURL: anchoredURL, sessionId: "s", message: nil) == .none, "an anchorless click only focuses, as before")
        precondition(notificationWindowAction(shown: URL(string: "http://127.0.0.1:8505?session=t"), chatURL: anchoredURL, sessionId: "s", message: "ask:q-1") == .load(anchoredURL!), "another Chat loads the anchored URL")
        precondition(notificationWindowAction(shown: showingS, chatURL: nil, sessionId: nil, message: nil) == .none)
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
            routeChat: { clickEvents.append("route") },
            complete: { clickEvents.append("complete") }
        )
        precondition(clickEvents == ["route", "activate", "complete"], "the chosen window is key before the app activates")

        let htmlDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try! FileManager.default.createDirectory(at: htmlDir, withIntermediateDirectories: true)
        let page = htmlDir.appendingPathComponent("Page.HTML"), script = htmlDir.appendingPathComponent("run.command"), alias = htmlDir.appendingPathComponent("alias.html")
        try! "<p>x</p>".write(to: page, atomically: true, encoding: .utf8)
        try! "echo x".write(to: script, atomically: true, encoding: .utf8)
        try! FileManager.default.createSymbolicLink(at: alias, withDestinationURL: script)
        precondition(localOpenTarget(page.path)?.lastPathComponent == "Page.HTML", "an existing HTML file opens")
        precondition(localOpenTarget(script.path) == nil && localOpenTarget(alias.path) == nil, "non-HTML targets, also behind an .html symlink, are refused")
        precondition(localOpenTarget(htmlDir.appendingPathComponent("missing.html").path) == nil && localOpenTarget("rel.html") == nil && localOpenTarget(42) == nil)
        let bundle = htmlDir.appendingPathComponent("Tool.app"), folderAlias = htmlDir.appendingPathComponent("folder-link")
        try! FileManager.default.createDirectory(at: bundle, withIntermediateDirectories: true)
        try! FileManager.default.createSymbolicLink(at: folderAlias, withDestinationURL: htmlDir)
        precondition(localOpenTarget(htmlDir.path)?.hasDirectoryPath == true && localOpenTarget(folderAlias.path)?.hasDirectoryPath == true, "an existing folder opens in Finder")
        precondition(localOpenTarget(bundle.path) == nil, "an app bundle is refused, it would launch")
        let docx = htmlDir.appendingPathComponent("Plan.docx"), docxAlias = htmlDir.appendingPathComponent("alias.docx")
        try! "x".write(to: docx, atomically: true, encoding: .utf8)
        try! FileManager.default.createSymbolicLink(at: docxAlias, withDestinationURL: docx)
        precondition(localOpenTarget(docx.path) == nil && localOpenTarget(docxAlias.path) == nil, "a document never opens in its default app")
        precondition(localRevealTarget(docx.path)?.lastPathComponent == "Plan.docx" && localRevealTarget(script.path) != nil && localRevealTarget(bundle.path) != nil, "any existing file or package can be revealed in Finder")
        precondition(localRevealTarget(docxAlias.path)?.lastPathComponent == "alias.docx" && localRevealTarget(alias.path) != nil, "a symlink is revealed itself")
        precondition(localRevealTarget(htmlDir.appendingPathComponent("missing.docx").path) == nil && localRevealTarget("rel.docx") == nil && localRevealTarget(42) == nil)
        try? FileManager.default.removeItem(at: htmlDir)

        let desktop = NotificationWindowCandidate(url: URL(string: "http://127.0.0.1:8505?project=p&workspace=w"), isOnActiveSpace: true)
        let other = NotificationWindowCandidate(url: URL(string: "http://127.0.0.1:8505?project=p&session=a&view=chat"), isOnActiveSpace: false)
        let target = NotificationWindowCandidate(url: URL(string: "http://127.0.0.1:8505?project=p&session=b&view=chat&workspace=w"), isOnActiveSpace: false)
        precondition(notificationWindowIndex([desktop, other, target], sessionId: "b") == 2, "the window showing the Chat wins over the active Space")
        precondition(notificationWindowIndex([other, desktop], sessionId: "z") == 1, "an unopened Chat uses the window on the active Space")
        precondition(notificationWindowIndex([other, target], sessionId: nil) == 0, "otherwise the frontmost window")
        precondition(notificationWindowIndex([], sessionId: "b") == nil, "no window means open one")

        // ISSUE-076: PI WEB adds `tool` (open panel) and other views to the route; restoration refuses them, routing must not.
        let server = URL(string: "http://127.0.0.1:8505")!
        var route = WindowRoute()
        precondition(route.report(URL(string: "http://127.0.0.1:8505?session=a&view=chat")!, server: server), "a plain Chat is restorable")
        precondition(!route.report(URL(string: "http://127.0.0.1:8505?session=b&tool=workspace-files:files&view=chat")!, server: server), "a panel route is not restorable")
        precondition(chatSessionId(of: route.restorable) == "a" && chatSessionId(of: route.shown) == "b", "restoration keeps the last safe route, routing follows the Chat on screen")
        let panelWindow = NotificationWindowCandidate(url: route.shown, isOnActiveSpace: false)
        let staleWindow = NotificationWindowCandidate(url: URL(string: "http://127.0.0.1:8505?session=a&view=chat"), isOnActiveSpace: true)
        precondition(notificationWindowIndex([staleWindow, panelWindow], sessionId: "b") == 1, "the window showing Chat b with a panel open wins")
        _ = route.report(URL(string: "about:blank")!, server: server)
        precondition(chatSessionId(of: route.shown) == "b", "the native startup page keeps the shown route")

        guard let context = JSContext() else { preconditionFailure("JavaScriptCore unavailable") }
        context.evaluateScript("""
            var window = this;
            var permissionPayload, notificationPayload, sleepSetPayload;
            window.webkit = { messageHandlers: {
              piWebRequestNotificationPermission: { postMessage: value => { permissionPayload = value; return Promise.resolve(true); } },
              piWebNotification: { postMessage: value => { notificationPayload = value; return Promise.resolve(true); } },
              piWebDirectoryPicker: { postMessage: value => Promise.resolve(value) },
              piWebGetSleepDisabled: { postMessage: value => Promise.resolve(false) },
              piWebSetSleepDisabled: { postMessage: value => { sleepSetPayload = value; return Promise.resolve(true); } }
            }};
            """)
        context.evaluateScript(piWebNativeScript)
        precondition(context.evaluateScript("window.piWebNative.requestNotificationPermission() instanceof Promise")?.toBool() == true)
        precondition(context.evaluateScript("Object.keys(permissionPayload).length")?.toInt32() == 0)
        precondition(context.evaluateScript("window.piWebNative.notify('Title', 'Body', {machineId: 'local', sessionId: 'session-1'}) instanceof Promise")?.toBool() == true)
        precondition(context.evaluateScript("notificationPayload.sessionId === 'session-1' && notificationPayload.machineId === 'local'")?.toBool() == true)
        precondition(context.evaluateScript("notificationPayload.title === 'Title' && notificationPayload.body === 'Body'")?.toBool() == true)
        precondition(context.evaluateScript("window.piWebNative.getSleepDisabled() instanceof Promise")?.toBool() == true)
        precondition(context.evaluateScript("window.piWebNative.setSleepDisabled(true) instanceof Promise")?.toBool() == true)
        precondition(context.evaluateScript("sleepSetPayload === true")?.toBool() == true)
        precondition(context.evaluateScript("Object.isFrozen(window.piWebNative)")?.toBool() == true)
        precondition(context.evaluateScript("window.piWebNative.notify('T', 'B', {machineId: 'local', sessionId: 's', message: 'entry:e1'}); notificationPayload.message === 'entry:e1'")?.toBool() == true)
        context.evaluateScript("""
            var revealed;
            function CustomEvent(type, init) { this.type = type; this.detail = init.detail; }
            window.dispatchEvent = event => { revealed = event; };
            (function(machineId, sessionId, message) { \(notificationRevealScript) })('local', 's', 'dialog:d"1');
            """)
        precondition(context.evaluateScript("revealed.type === 'pi-web:notification-open' && revealed.detail.sessionId === 's' && revealed.detail.machineId === 'local' && revealed.detail.message === 'dialog:d\"1'")?.toBool() == true)

        print("PASS: native notification, sleep-control JS Promise, frame, and click contracts")
    }
}
