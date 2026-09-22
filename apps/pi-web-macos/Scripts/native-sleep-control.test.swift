import Darwin
import Foundation

private struct TestError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

private func message(from work: () throws -> Void) -> String {
    do {
        try work()
        preconditionFailure("Expected an error")
    } catch {
        return error.localizedDescription
    }
}

private func immediate(_ work: @escaping () -> Void) { work() }

private func fixtureResult(_ output: String = "", stderr: String = "", status: Int32 = 0, timedOut: Bool = false) -> SleepProcessResult {
    SleepProcessResult(stdout: output, stderr: stderr, status: status, timedOut: timedOut)
}

@main
struct NativeSleepControlTests {
    static func main() throws {
        if CommandLine.arguments.last == "--bounded-process-fixture" {
            FileHandle.standardOutput.write(Data(repeating: 65, count: 128 * 1024))
            FileHandle.standardError.write(Data(repeating: 66, count: 128 * 1024))
            exit(7)
        }
        if CommandLine.arguments.last == "--timeout-process-fixture" {
            FileHandle.standardError.write(Data("fixture waiting\n".utf8))
            sleep(5)
            exit(0)
        }

        let bounded = try runSleepProcess(
            URL(fileURLWithPath: CommandLine.arguments[0]),
            ["--bounded-process-fixture"],
            outputLimit: 32,
            timeout: 2
        )
        precondition(bounded.status == 7 && bounded.stdout == String(repeating: "A", count: 32))
        precondition(bounded.stderr == String(repeating: "B", count: 32) && !bounded.timedOut)
        let timeoutStarted = Date()
        let timedOut = try runSleepProcess(
            URL(fileURLWithPath: CommandLine.arguments[0]),
            ["--timeout-process-fixture"],
            outputLimit: 32,
            timeout: 0.05
        )
        precondition(timedOut.timedOut && timedOut.stderr == "fixture waiting\n")
        precondition(Date().timeIntervalSince(timeoutStarted) < 2)

        let missingFixture = try parseSleepDisabled("System-wide power settings:\n currently in use:\n sleep 1\n")
        let enabledFixture = try parseSleepDisabled("System-wide power settings:\n SleepDisabled 0 (default)\n")
        let disabledFixture = try parseSleepDisabled("Currently in use:\n\tSleepDisabled\t1\t(custom)\n")
        precondition(missingFixture == false && enabledFixture == false && disabledFixture == true)
        let missingValueError = message { _ = try parseSleepDisabled("SleepDisabled") }
        let malformedValueError = message { _ = try parseSleepDisabled("SleepDisabled 2 (invalid)") }
        precondition(missingValueError.hasPrefix("SLEEP_CONTROL_INVALID_STATE:") && missingValueError.contains("invalid SleepDisabled"))
        precondition(malformedValueError.hasPrefix("SLEEP_CONTROL_INVALID_STATE:") && malformedValueError.contains("invalid SleepDisabled"))

        let liveRead = try NativeSleepRunner.live.readPMSet()
        precondition(liveRead.status == 0, "/usr/bin/pmset -g failed during the read-only format check")
        _ = try parseSleepDisabled(liveRead.stdout)

        for disabled in [false, true] {
            let source = sleepDisableScript(disabled)
            guard let script = NSAppleScript(source: source) else { preconditionFailure("Could not create fixed AppleScript") }
            var compileError: NSDictionary?
            precondition(script.compileAndReturnError(&compileError), "Fixed AppleScript did not compile: \(String(describing: compileError))")
        }
        precondition(sleepDisableScript(true) == "do shell script \"/usr/bin/pmset -a disablesleep 1\" with administrator privileges")
        precondition(sleepDisableScript(false) == "do shell script \"/usr/bin/pmset -a disablesleep 0\" with administrator privileges")

        var processCalls: [(String, [String], Int, TimeInterval)] = []
        let mappedRunner = NativeSleepRunner.system { executable, arguments, limit, timeout in
            processCalls.append((executable.path, arguments, limit, timeout))
            switch arguments.last {
            case sleepDisableScript(true):
                return fixtureResult(stderr: "execution error: User canceled. (-128)", status: 1)
            case sleepDisableScript(false):
                return fixtureResult(stderr: "execution error: Not authorized. (-1743)", status: 1)
            default:
                return fixtureResult("SleepDisabled 1\n")
            }
        }
        let mappedRead = try mappedRunner.readPMSet()
        precondition(mappedRead.stdout == "SleepDisabled 1\n")
        precondition(message { try mappedRunner.runAppleScript(sleepDisableScript(true)) }.hasPrefix("SLEEP_CONTROL_USER_CANCELLED:"))
        let mappedError = message { try mappedRunner.runAppleScript(sleepDisableScript(false)) }
        precondition(mappedError.hasPrefix("SLEEP_CONTROL_CHANGE_FAILED:"))
        precondition(mappedError.contains("status 1") && mappedError.contains("Not authorized"))
        precondition(processCalls[0].0 == "/usr/bin/pmset" && processCalls[0].1 == ["-g"])
        precondition(processCalls[1].0 == "/usr/bin/osascript" && processCalls[1].1 == ["-e", sleepDisableScript(true)])
        precondition(processCalls[2].0 == "/usr/bin/osascript" && processCalls[2].1 == ["-e", sleepDisableScript(false)])
        precondition(processCalls.allSatisfy { $0.2 == 64 * 1024 })
        precondition(processCalls[0].3 == 5 && processCalls[1].3 == 120 && processCalls[2].3 == 120)

        let launchFailure = NativeSleepRunner.system { _, _, _, _ in throw TestError("fixture launch failed") }
        let changeLaunchError = message { try launchFailure.runAppleScript(sleepDisableScript(true)) }
        let readLaunchError = message { _ = try launchFailure.readPMSet() }
        precondition(changeLaunchError.hasPrefix("SLEEP_CONTROL_CHANGE_FAILED:") && changeLaunchError.contains("could not launch /usr/bin/osascript"))
        precondition(readLaunchError.hasPrefix("SLEEP_CONTROL_READ_FAILED:") && readLaunchError.contains("could not launch /usr/bin/pmset"))

        var watchdogCalls = 0
        let watchdogRunner = NativeSleepRunner.system(
            processRunner: { _, _, limit, timeout in
                watchdogCalls += 1
                return try runSleepProcess(
                    URL(fileURLWithPath: CommandLine.arguments[0]),
                    ["--timeout-process-fixture"],
                    outputLimit: limit,
                    timeout: timeout
                )
            },
            readTimeout: 0.05,
            authorizationTimeout: 0.05
        )
        let watchdogControl = NativeSleepControl(
            runner: watchdogRunner,
            setScheduler: immediate,
            readScheduler: immediate,
            replyScheduler: immediate
        )
        var watchdogErrors: [String] = []
        for _ in 0..<2 {
            precondition(watchdogControl.setSleepDisabled(true) { result in
                if case .failure(let error) = result { watchdogErrors.append(error.localizedDescription) }
            })
        }
        precondition(watchdogCalls == 2)
        precondition(watchdogErrors.count == 2 && watchdogErrors.allSatisfy { $0.hasPrefix("SLEEP_CONTROL_TIMEOUT:") })

        let unverifiedControl = NativeSleepControl(
            runner: NativeSleepRunner(
                readPMSet: { fixtureResult(stderr: "fixture read failed", status: 1) },
                runAppleScript: { _ in }
            ),
            setScheduler: immediate,
            readScheduler: immediate,
            replyScheduler: immediate
        )
        var unverifiedError = ""
        precondition(unverifiedControl.setSleepDisabled(true) { result in
            if case .failure(let error) = result { unverifiedError = error.localizedDescription }
        })
        precondition(unverifiedError.hasPrefix("SLEEP_CONTROL_STATE_UNVERIFIED:"))
        precondition(unverifiedError.contains("may have changed") && unverifiedError.contains("Reread"))

        let readTimeoutControl = NativeSleepControl(
            runner: NativeSleepRunner(
                readPMSet: { fixtureResult(timedOut: true) },
                runAppleScript: { _ in preconditionFailure("timed-out getter ran setter") }
            ),
            setScheduler: immediate,
            readScheduler: immediate,
            replyScheduler: immediate
        )
        var readTimeoutError = ""
        readTimeoutControl.getSleepDisabled { result in
            if case .failure(let error) = result { readTimeoutError = error.localizedDescription }
        }
        precondition(readTimeoutError.hasPrefix("SLEEP_CONTROL_TIMEOUT:"))

        let asyncGetter = NativeSleepControl(
            runner: NativeSleepRunner(
                readPMSet: {
                    precondition(!Thread.isMainThread)
                    precondition(NativeSleepControl.isOnDefaultReadQueue)
                    return fixtureResult("SleepDisabled 1")
                },
                runAppleScript: { _ in preconditionFailure("getter ran a setter") }
            )
        )
        var asyncGetterFinished = false
        handleNativeSleepMessage(.get, isTrustedMainFrame: true, value: [:], control: asyncGetter) { result, error in
            precondition(Thread.isMainThread)
            precondition(result as? Bool == true && error == nil)
            asyncGetterFinished = true
        }
        let getterDeadline = Date().addingTimeInterval(2)
        while !asyncGetterFinished && Date() < getterDeadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
        }
        precondition(asyncGetterFinished, "Off-main getter did not reply on the main thread")

        let serialLock = NSLock()
        let firstReadStarted = DispatchSemaphore(value: 0)
        let releaseFirstRead = DispatchSemaphore(value: 0)
        var activeReads = 0
        var maximumActiveReads = 0
        var readInvocations = 0
        let serialGetter = NativeSleepControl(
            runner: NativeSleepRunner(
                readPMSet: {
                    precondition(NativeSleepControl.isOnDefaultReadQueue)
                    serialLock.lock()
                    activeReads += 1
                    readInvocations += 1
                    maximumActiveReads = max(maximumActiveReads, activeReads)
                    let first = readInvocations == 1
                    serialLock.unlock()
                    if first {
                        firstReadStarted.signal()
                        releaseFirstRead.wait()
                    }
                    serialLock.lock(); activeReads -= 1; serialLock.unlock()
                    return fixtureResult("SleepDisabled 0")
                },
                runAppleScript: { _ in preconditionFailure("serial getter ran a setter") }
            )
        )
        var serialReplies = 0
        for _ in 0..<12 {
            serialGetter.getSleepDisabled { result in
                precondition((try? result.get()) == false)
                serialReplies += 1
            }
        }
        precondition(firstReadStarted.wait(timeout: .now() + 1) == .success)
        usleep(50_000)
        serialLock.lock(); let readsBeforeRelease = readInvocations; serialLock.unlock()
        precondition(readsBeforeRelease == 1)
        releaseFirstRead.signal()
        let serialDeadline = Date().addingTimeInterval(2)
        while serialReplies < 12 && Date() < serialDeadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
        }
        serialLock.lock(); let maximumReads = maximumActiveReads; serialLock.unlock()
        precondition(serialReplies == 12 && maximumReads == 1)

        var setWork: [() -> Void] = []
        var readWork: [() -> Void] = []
        var callbacks: [() -> Void] = []
        let independentQueues = NativeSleepControl(
            runner: NativeSleepRunner(
                readPMSet: { fixtureResult("SleepDisabled 0") },
                runAppleScript: { _ in preconditionFailure("pending setter should not execute") }
            ),
            setScheduler: { setWork.append($0) },
            readScheduler: { readWork.append($0) },
            replyScheduler: { callbacks.append($0) }
        )
        precondition(independentQueues.setSleepDisabled(true) { _ in preconditionFailure("pending setter replied") })
        var independentRead: Bool?
        independentQueues.getSleepDisabled { independentRead = try? $0.get() }
        precondition(setWork.count == 1 && readWork.count == 1 && callbacks.isEmpty)
        readWork.removeFirst()()
        precondition(callbacks.count == 1)
        callbacks.removeFirst()()
        precondition(independentRead == false && setWork.count == 1)

        var setterWork: [() -> Void] = []
        var setterCallbacks: [() -> Void] = []
        var scripts: [String] = []
        var setterReads = 0
        let setter = NativeSleepControl(
            runner: NativeSleepRunner(
                readPMSet: {
                    setterReads += 1
                    return fixtureResult("SleepDisabled 0 (actual)")
                },
                runAppleScript: { scripts.append($0) }
            ),
            setScheduler: { setterWork.append($0) },
            readScheduler: immediate,
            replyScheduler: { setterCallbacks.append($0) }
        )
        var replies: [(Any?, String?)] = []
        handleNativeSleepMessage(.set, isTrustedMainFrame: true, value: true, control: setter) { replies.append(($0, $1)) }
        precondition(setterWork.count == 1 && scripts.isEmpty && replies.isEmpty)
        handleNativeSleepMessage(.set, isTrustedMainFrame: true, value: false, control: setter) { replies.append(($0, $1)) }
        precondition(replies.count == 1 && replies[0].1?.hasPrefix("SLEEP_CONTROL_CHANGE_IN_PROGRESS:") == true)
        setterWork.removeFirst()()
        precondition(scripts == [sleepDisableScript(true)] && setterReads == 1 && setterCallbacks.count == 1)
        handleNativeSleepMessage(.set, isTrustedMainFrame: true, value: false, control: setter) { replies.append(($0, $1)) }
        precondition(replies.count == 2 && replies[1].1?.hasPrefix("SLEEP_CONTROL_CHANGE_IN_PROGRESS:") == true)
        setterCallbacks.removeFirst()()
        precondition(replies.count == 3 && replies[2].0 as? Bool == false && replies[2].1 == nil)

        let offMainSetter = NativeSleepControl(
            runner: NativeSleepRunner(
                readPMSet: {
                    precondition(!Thread.isMainThread)
                    return fixtureResult("SleepDisabled 1")
                },
                runAppleScript: { _ in precondition(!Thread.isMainThread) }
            )
        )
        var offMainSetterFinished = false
        handleNativeSleepMessage(.set, isTrustedMainFrame: true, value: true, control: offMainSetter) { result, error in
            precondition(Thread.isMainThread)
            precondition(result as? Bool == true && error == nil)
            offMainSetterFinished = true
        }
        let setterDeadline = Date().addingTimeInterval(2)
        while !offMainSetterFinished && Date() < setterDeadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
        }
        precondition(offMainSetterFinished, "Off-main setter did not reply on the main thread")

        let guarded = NativeSleepControl(
            runner: NativeSleepRunner(
                readPMSet: { fixtureResult("SleepDisabled 0") },
                runAppleScript: { _ in preconditionFailure("invalid input ran setter") }
            ),
            setScheduler: immediate,
            readScheduler: immediate,
            replyScheduler: immediate
        )
        handleNativeSleepMessage(.get, isTrustedMainFrame: false, value: [:], control: guarded) { result, error in
            precondition(result == nil && error?.contains("main page") == true)
        }
        handleNativeSleepMessage(.set, isTrustedMainFrame: true, value: "true", control: guarded) { result, error in
            precondition(result == nil && error?.hasPrefix("SLEEP_CONTROL_INVALID_ARGUMENT:") == true)
        }
        handleNativeSleepMessage(.set, isTrustedMainFrame: true, value: NSNumber(value: 1), control: guarded) { result, error in
            precondition(result == nil && error?.hasPrefix("SLEEP_CONTROL_INVALID_ARGUMENT:") == true)
        }
        var getReplyCount = 0
        handleNativeSleepMessage(.get, isTrustedMainFrame: true, value: [:], control: guarded) { result, error in
            getReplyCount += 1
            precondition(result as? Bool == false && error == nil)
        }
        precondition(getReplyCount == 1)

        print("PASS: bounded watchdogs, osascript mapping, serial async reads, unverified state, guards, and bridge contracts")
    }
}
