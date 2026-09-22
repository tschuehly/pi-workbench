import Foundation

/// Read the runtime protocol, not the CLI's human-readable service-manager status.
enum PIWebReadiness {
    enum State: Equatable {
        case ready
        case waiting(String)
        case failed(String)
    }

    private struct Report: Decodable {
        let packageName: String
        struct Components: Decodable {
            struct Component: Decodable {
                struct Installation: Decodable { let path: String? }
                let available: Bool
                let stale: Bool
                let installation: Installation?
            }
            let web: Component
            let sessiond: Component
        }
        let components: Components
    }

    static func check(data: Data, statusCode: Int, checkoutURL: URL? = nil) -> State {
        if [401, 403, 404].contains(statusCode) {
            return .failed("PI WEB readiness returned HTTP \(statusCode). Check the configured server URL and access settings.")
        }
        guard statusCode == 200 else {
            return .waiting("Waiting for the PI WEB API (HTTP \(statusCode))…")
        }
        guard let report = try? JSONDecoder().decode(Report.self, from: data), report.packageName == "@jmfederico/pi-web" else {
            return .failed("PI WEB returned an incompatible response from /api/pi-web/version. Check the configured server URL and PI WEB version.")
        }
        for (name, component) in [("API", report.components.web), ("session runtime", report.components.sessiond)] {
            guard component.available else { return .waiting("Waiting for the PI WEB \(name)…") }
            guard !component.stale else {
                return .failed("The PI WEB \(name) is running an outdated version. Plan a service restart when interrupting active sessions is acceptable.")
            }
            if let checkoutURL {
                guard let path = component.installation?.path,
                      URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL == checkoutURL.resolvingSymlinksInPath().standardizedFileURL else {
                    return .failed("The PI WEB \(name) is not running from the app's configured checkout. Check the app configuration before restarting any services.")
                }
            }
        }
        return .ready
    }

    /// Runs on the lifecycle queue, never the AppKit main thread. Each request is bounded.
    static func check(serverURL: URL, checkoutURL: URL? = nil) -> State {
        let url = serverURL.appendingPathComponent("api/pi-web/version")
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
        let done = DispatchSemaphore(value: 0)
        // The semaphore orders the callback's write before the lifecycle queue's read.
        final class Reply: @unchecked Sendable { var state: State = .waiting("Waiting for PI WEB…") }
        let reply = Reply()
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            defer { done.signal() }
            if let error {
                reply.state = .waiting("Waiting for PI WEB at \(serverURL.absoluteString): \(error.localizedDescription)")
            } else {
                reply.state = check(data: data ?? Data(), statusCode: (response as? HTTPURLResponse)?.statusCode ?? 0, checkoutURL: checkoutURL)
            }
        }
        task.resume()
        guard done.wait(timeout: .now() + 6) == .success else {
            task.cancel()
            return .waiting("Waiting for PI WEB at \(serverURL.absoluteString): readiness request timed out.")
        }
        return reply.state
    }
}
