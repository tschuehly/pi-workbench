import Foundation

@main
struct ReadinessTests {
    static func main() throws {
        let ready = #"{"packageName":"@jmfederico/pi-web","components":{"web":{"available":true,"stale":false,"installation":{"path":"/tmp/pi-web-test"}},"sessiond":{"available":true,"stale":false,"installation":{"path":"/tmp/pi-web-test"}}}}"#
        let checkout = URL(fileURLWithPath: "/tmp/pi-web-test")
        func check(_ body: String, status: Int = 200, checkoutURL: URL? = checkout) -> PIWebReadiness.State {
            PIWebReadiness.check(data: Data(body.utf8), statusCode: status, checkoutURL: checkoutURL)
        }
        func expectFailure(_ result: PIWebReadiness.State) {
            guard case .failed = result else { preconditionFailure("Expected terminal failure, got \(result)") }
        }
        func expectWaiting(_ result: PIWebReadiness.State) {
            guard case .waiting = result else { preconditionFailure("Expected retryable wait, got \(result)") }
        }
        precondition(check(ready) == .ready)
        for body in ["", "<html>Vite fallback</html>", "PI WEB services: development (LaunchAgents)", "{}",
            ready.replacingOccurrences(of: "\"available\":true", with: "\"available\":\"true\""),
            ready.replacingOccurrences(of: "\"stale\":false", with: "\"stale\":true"),
            ready.replacingOccurrences(of: "@jmfederico/pi-web", with: "foreign-service"),
            ready.replacingOccurrences(of: "/tmp/pi-web-test", with: "/tmp/other-checkout"),
        ] { expectFailure(check(body)) }
        for status in [401, 403, 404] { expectFailure(check(ready, status: status)) }
        expectWaiting(check(ready, status: 502))
        expectWaiting(check(ready.replacingOccurrences(of: "\"available\":true", with: "\"available\":false")))
        // The API omits installation details while the session daemon is unavailable.
        expectWaiting(check(#"{"packageName":"@jmfederico/pi-web","components":{"web":{"available":true,"stale":false,"installation":{"path":"/tmp/pi-web-test"}},"sessiond":{"available":false,"stale":false,"error":"unreachable"}}}"#))
        if let url = ProcessInfo.processInfo.environment["PI_WEB_TEST_URL"] {
            let checkout = ProcessInfo.processInfo.environment["PI_WEB_TEST_CHECKOUT"].map { URL(fileURLWithPath: $0) }
            let result = PIWebReadiness.check(serverURL: URL(string: url)!, checkoutURL: checkout)
            precondition(result == .ready, "\(result)")
            print("PASS: live UI/API and session daemon ready; no lifecycle commands invoked")
        }
        print("PASS: readiness rejects incompatible/stale/foreign responses and retries unavailable components")
    }
}
