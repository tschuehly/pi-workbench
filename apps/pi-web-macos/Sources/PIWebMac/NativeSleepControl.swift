import CoreFoundation
import Darwin
import Foundation

private let sleepProcessOutputLimit = 64 * 1024
private let sleepReadTimeout: TimeInterval = 5
private let sleepAuthorizationTimeout: TimeInterval = 120

struct SleepProcessResult {
    let stdout: String
    let stderr: String
    let status: Int32
    let timedOut: Bool
}

typealias SleepProcessRunner = (_ executable: URL, _ arguments: [String], _ outputLimit: Int, _ timeout: TimeInterval) throws -> SleepProcessResult

func runSleepProcess(_ executable: URL, _ arguments: [String], outputLimit: Int, timeout: TimeInterval) throws -> SleepProcessResult {
    let process = Process()
    process.executableURL = executable
    process.arguments = arguments
    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    try process.run()
    defer {
        try? stdout.fileHandleForReading.close()
        try? stderr.fileHandleForReading.close()
    }

    var pipes = [stdout.fileHandleForReading.fileDescriptor, stderr.fileHandleForReading.fileDescriptor]
    for fd in pipes { _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK) }
    var output = [Data(), Data()]
    let deadline = ProcessInfo.processInfo.systemUptime + max(0, timeout)
    var timedOut = false
    // Nonblocking reads avoid a stuck drain when an exited process leaves pipe writers in descendants.
    while process.isRunning || pipes.contains(where: { $0 >= 0 }) {
        if ProcessInfo.processInfo.systemUptime >= deadline { timedOut = true; break }
        var events = pipes.map { pollfd(fd: $0, events: Int16(POLLIN | POLLHUP | POLLERR), revents: 0) }
        _ = events.withUnsafeMutableBufferPointer { poll($0.baseAddress, nfds_t($0.count), 50) }
        for index in pipes.indices where pipes[index] >= 0 && events[index].revents != 0 {
            var chunk = [UInt8](repeating: 0, count: 4096)
            let count = chunk.withUnsafeMutableBytes { Darwin.read(pipes[index], $0.baseAddress, $0.count) }
            if count > 0 {
                if output[index].count < outputLimit { output[index].append(contentsOf: chunk.prefix(min(count, outputLimit - output[index].count))) }
            } else if count == 0 || (errno != EAGAIN && errno != EINTR) {
                pipes[index] = -1
            }
        }
    }
    if timedOut && process.isRunning {
        process.terminate()
        let finished = DispatchSemaphore(value: 0)
        DispatchQueue.global(qos: .utility).async { process.waitUntilExit(); finished.signal() }
        if finished.wait(timeout: .now() + 1) == .timedOut && process.isRunning {
            kill(process.processIdentifier, SIGKILL)
            _ = finished.wait(timeout: .now() + 1)
        }
    }
    return SleepProcessResult(
        stdout: String(decoding: output[0], as: UTF8.self),
        stderr: String(decoding: output[1], as: UTF8.self),
        status: process.isRunning ? -1 : process.terminationStatus,
        timedOut: timedOut
    )
}

struct NativeSleepRunner {
    let readPMSet: () throws -> SleepProcessResult
    let runAppleScript: (String) throws -> Void

    static let live = system(processRunner: runSleepProcess)

    static func system(
        processRunner: @escaping SleepProcessRunner,
        readTimeout: TimeInterval = sleepReadTimeout,
        authorizationTimeout: TimeInterval = sleepAuthorizationTimeout
    ) -> NativeSleepRunner {
        NativeSleepRunner(
            readPMSet: {
                do {
                    return try processRunner(URL(fileURLWithPath: "/usr/bin/pmset"), ["-g"], sleepProcessOutputLimit, readTimeout)
                } catch {
                    throw NativeSleepError.readFailed("could not launch /usr/bin/pmset: \(error.localizedDescription)")
                }
            },
            runAppleScript: { source in
                let result: SleepProcessResult
                do {
                    result = try processRunner(
                        URL(fileURLWithPath: "/usr/bin/osascript"),
                        ["-e", source],
                        sleepProcessOutputLimit,
                        authorizationTimeout
                    )
                } catch {
                    throw NativeSleepError.changeFailed("could not launch /usr/bin/osascript: \(error.localizedDescription)")
                }
                if result.timedOut {
                    throw NativeSleepError.timeout("Administrator authorization timed out; the sleep setting was not confirmed.")
                }
                guard result.status == 0 else {
                    let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                    if detail.range(of: #"\(-128\)(?:\s|$)"#, options: .regularExpression) != nil {
                        throw NativeSleepError.userCancelled
                    }
                    throw NativeSleepError.changeFailed("/usr/bin/osascript exited with status \(result.status)\(detail.isEmpty ? "" : ": \(detail)")")
                }
            }
        )
    }
}

enum NativeSleepError: LocalizedError {
    case readFailed(String)
    case invalidState(String)
    case userCancelled
    case changeInProgress
    case timeout(String)
    case stateUnverified(String)
    case changeFailed(String)

    var errorDescription: String? {
        switch self {
        case .readFailed(let detail): return "SLEEP_CONTROL_READ_FAILED: Could not read the system sleep setting: \(detail)"
        case .invalidState(let detail): return "SLEEP_CONTROL_INVALID_STATE: Could not determine the system sleep setting: \(detail)"
        case .userCancelled: return "SLEEP_CONTROL_USER_CANCELLED: The sleep setting change was cancelled."
        case .changeInProgress: return "SLEEP_CONTROL_CHANGE_IN_PROGRESS: Another sleep setting change is awaiting completion."
        case .timeout(let detail): return "SLEEP_CONTROL_TIMEOUT: \(detail)"
        case .stateUnverified(let detail): return "SLEEP_CONTROL_STATE_UNVERIFIED: The setting may have changed, but its current state could not be verified. Reread it before showing a final state. \(detail)"
        case .changeFailed(let detail): return "SLEEP_CONTROL_CHANGE_FAILED: Could not change the system sleep setting: \(detail)"
        }
    }
}

func parseSleepDisabled(_ output: String) throws -> Bool {
    for line in output.split(whereSeparator: \Character.isNewline) {
        let fields = line.split(whereSeparator: \Character.isWhitespace)
        guard fields.first == "SleepDisabled" else { continue }
        guard fields.count >= 2, fields[1] == "0" || fields[1] == "1" else {
            throw NativeSleepError.invalidState("/usr/bin/pmset -g returned an invalid SleepDisabled value")
        }
        return fields[1] == "1"
    }
    return false
}

func sleepDisableScript(_ disabled: Bool) -> String {
    "do shell script \"/usr/bin/pmset -a disablesleep \(disabled ? 1 : 0)\" with administrator privileges"
}

typealias NativeSleepScheduler = (@escaping () -> Void) -> Void

final class NativeSleepControl {
    private static let setterQueue = DispatchQueue(label: "works.pi.workbench.sleep-control.set", qos: .userInitiated)
    private static let readerQueueKey = DispatchSpecificKey<Bool>()
    private static let readerQueue: DispatchQueue = {
        let queue = DispatchQueue(label: "works.pi.workbench.sleep-control.read", qos: .userInitiated)
        queue.setSpecific(key: readerQueueKey, value: true)
        return queue
    }()

    private let runner: NativeSleepRunner
    private let parser: (String) throws -> Bool
    private let scriptBuilder: (Bool) -> String
    private let setScheduler: NativeSleepScheduler
    private let readScheduler: NativeSleepScheduler
    private let replyScheduler: NativeSleepScheduler
    private let setterLock = NSLock()
    private var setterInFlight = false

    init(
        runner: NativeSleepRunner = .live,
        parser: @escaping (String) throws -> Bool = parseSleepDisabled,
        scriptBuilder: @escaping (Bool) -> String = sleepDisableScript,
        setScheduler: @escaping NativeSleepScheduler = { work in setterQueue.async(execute: work) },
        readScheduler: @escaping NativeSleepScheduler = { work in readerQueue.async(execute: work) },
        replyScheduler: @escaping NativeSleepScheduler = { work in DispatchQueue.main.async(execute: work) }
    ) {
        self.runner = runner
        self.parser = parser
        self.scriptBuilder = scriptBuilder
        self.setScheduler = setScheduler
        self.readScheduler = readScheduler
        self.replyScheduler = replyScheduler
    }

    static var isOnDefaultReadQueue: Bool {
        DispatchQueue.getSpecific(key: readerQueueKey) == true
    }

    func getSleepDisabled(completion: @escaping (Result<Bool, Error>) -> Void) {
        readScheduler { [self] in
            let result = Result { try readSleepDisabled() }
            replyScheduler { completion(result) }
        }
    }

    @discardableResult
    func setSleepDisabled(_ disabled: Bool, completion: @escaping (Result<Bool, Error>) -> Void) -> Bool {
        setterLock.lock()
        guard !setterInFlight else {
            setterLock.unlock()
            return false
        }
        setterInFlight = true
        setterLock.unlock()

        setScheduler { [self] in
            let result = Result { () throws -> Bool in
                try runner.runAppleScript(scriptBuilder(disabled))
                do { return try readSleepDisabled() }
                catch { throw NativeSleepError.stateUnverified(error.localizedDescription) }
            }
            replyScheduler { [self] in
                setterLock.lock()
                setterInFlight = false
                setterLock.unlock()
                completion(result)
            }
        }
        return true
    }

    private func readSleepDisabled() throws -> Bool {
        let result = try runner.readPMSet()
        if result.timedOut {
            throw NativeSleepError.timeout("Reading the system sleep setting timed out.")
        }
        guard result.status == 0 else {
            let stdout = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
            let stderr = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            let detail = stderr.isEmpty ? stdout : stderr
            throw NativeSleepError.readFailed("/usr/bin/pmset -g exited with status \(result.status)\(detail.isEmpty ? "" : ": \(detail)")")
        }
        return try parser(result.stdout)
    }
}

typealias NativeSleepReply = (Any?, String?) -> Void

enum NativeSleepCommand {
    case get
    case set
}

func handleNativeSleepMessage(
    _ command: NativeSleepCommand,
    isTrustedMainFrame: Bool,
    value: Any,
    control: NativeSleepControl,
    reply: @escaping NativeSleepReply
) {
    guard isTrustedMainFrame else {
        reply(nil, "Sleep control is only available to the trusted main page")
        return
    }
    switch command {
    case .get:
        control.getSleepDisabled { result in
            switch result {
            case .success(let disabled): reply(disabled, nil)
            case .failure(let error): reply(nil, error.localizedDescription)
            }
        }
    case .set:
        guard
            let number = value as? NSNumber,
            CFGetTypeID(number) == CFBooleanGetTypeID()
        else {
            reply(nil, "SLEEP_CONTROL_INVALID_ARGUMENT: Sleep control requires a boolean disabled value.")
            return
        }
        let accepted = control.setSleepDisabled(number.boolValue) { result in
            switch result {
            case .success(let disabled): reply(disabled, nil)
            case .failure(let error): reply(nil, error.localizedDescription)
            }
        }
        if !accepted { reply(nil, NativeSleepError.changeInProgress.localizedDescription) }
    }
}
