# Pi Execution Adapter

Bounded Level 1 process mechanics for one attended child Pi. `PiRpcExecutionAdapter` accepts only a validated `ResolvedExecutionSpec`, starts a fresh persistent Pi RPC session with an explicit provider/model/effort and tool allowlist, verifies the runtime binding before prompting, normalizes bounded observations, and owns cancellation, timeout, and process cleanup. Stale or unavailable quota telemetry is surfaced through `quota_degraded` and does not block launch. A fresh binding that ages before dispatch is downgraded the same way. Effective quota admission and telemetry status remain in the terminal result. Fresh confirmed exhaustion is rejected by model routing and by adapter validation.

This package keeps live process state only. It is not a Run Controller, scheduler, sandbox, workspace owner, durable actor store, or acceptance authority.

```sh
npm test --prefix packages/pi-execution-adapter
```
