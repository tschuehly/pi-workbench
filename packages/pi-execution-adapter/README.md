# Pi Execution Adapter

Bounded Level 1 process mechanics for one attended child Pi. `PiRpcExecutionAdapter` accepts only a validated `ResolvedExecutionSpec`, starts a persistent Pi RPC session with an explicit provider/model/effort and tool allowlist, verifies the runtime binding before prompting, normalizes bounded observations with concise safe tool actions, and owns cancellation, startup deadlines, and process cleanup. A spec may carry an optional `continuation.sessionId`; the adapter then resumes that persisted Pi session (`--session`), verifies the reported session identifier before prompting, and emits `continuation_verified`. A missing or mismatched session fails closed as `launch_failed` — the adapter records no lineage and owns no worker identity; see `packages/worker-registry/`. Stale or unavailable quota telemetry is surfaced through `quota_degraded` and does not block launch. A fresh binding that ages before dispatch is downgraded the same way. Effective quota admission and telemetry status remain in the terminal result. Fresh confirmed exhaustion is rejected by model routing and by adapter validation.

Model routing bounds quota and Pi catalog subprocesses to 15 seconds before dispatch. The adapter then requires Pi RPC to answer its initial `get_state` handshake within 15 seconds. A startup stall terminates before any prompt or model side effect and returns `launch_failed` with a `startup_timeout` observation; late state responses cannot submit a prompt. Tasks run until the child finishes, the lead cancels them, or the attended session shuts down. The adapter normally completes on Pi's `agent_settled` event. If terminal assistant output arrives but that event is lost or delayed, it probes RPC state after a short grace period and completes only when Pi reports no streaming, compaction, or pending messages. After success it closes stdin and escalates process termination if graceful RPC shutdown hangs, preventing completed children from lingering.

When `parentSessionId` is present, the adapter passes it and the generated execution ID to the child as `PI_TELEMETRY_PARENT_SESSION_ID` and `PI_TELEMETRY_EXECUTION_ID`. The child telemetry extension records that launch-time lineage even when a background result is never collected.

This package keeps live process state only. It is not a Run Controller, scheduler, sandbox, workspace owner, durable actor store, or acceptance authority.

```sh
npm test --prefix packages/pi-execution-adapter
```
