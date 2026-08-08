# Pi Execution Adapter

Bounded Level 1 process mechanics for one attended child Pi. `PiRpcExecutionAdapter` accepts only a validated `ResolvedExecutionSpec`, starts a persistent Pi RPC session with an explicit provider/model/effort and tool allowlist, verifies the runtime binding before prompting, normalizes bounded observations, and owns cancellation, timeout, and process cleanup. A spec may carry an optional `continuation.sessionId`; the adapter then resumes that persisted Pi session (`--session`), verifies the reported session identifier before prompting, and emits `continuation_verified`. A missing or mismatched session fails closed as `launch_failed` — the adapter records no lineage and owns no worker identity; see `packages/worker-registry/`. Stale or unavailable quota telemetry is surfaced through `quota_degraded` and does not block launch. A fresh binding that ages before dispatch is downgraded the same way. Effective quota admission and telemetry status remain in the terminal result. Fresh confirmed exhaustion is rejected by model routing and by adapter validation.

The adapter normally completes on Pi's `agent_settled` event. If terminal assistant output arrives but that event is lost or delayed, it probes RPC state after a short grace period and completes only when Pi reports no streaming, compaction, or pending messages. After success it closes stdin and escalates process termination if graceful RPC shutdown hangs, preventing completed children from lingering.

This package keeps live process state only. It is not a Run Controller, scheduler, sandbox, workspace owner, durable actor store, or acceptance authority.

```sh
npm test --prefix packages/pi-execution-adapter
```
