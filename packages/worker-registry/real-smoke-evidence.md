# Durable worker real Pi RPC smoke evidence

Date: 2026-08-08

One real smoke exercised the full durable-worker lifecycle against a temporary user-local registry directory and real Pi RPC children using fresh resolver-produced `mechanics` bindings (`anthropic/claude-haiku-4-5`, effort `low`):

1. `create` wrote one durable record and started no process.
2. The first dispatch launched a fresh child (`continuation` absent), asked it to remember the sentinel `ROSEBUD-7431`, completed with `success`, and recorded the child's Pi session identifier in the worker's lineage.
3. A second `WorkerRegistry` and `PiRpcExecutionAdapter` instance pair over the same directory simulated a parent restart: the reopened record exposed the recorded lineage, and the second dispatch resumed that session with `--session`. The adapter emitted `continuation_verified` after confirming the reported session identifier, and the child answered `ROSEBUD-7431` without the sentinel being restated.
4. `retire` recorded an immutable retirement, and a further `beginDispatch` was rejected with `WORKER_RETIRED`.

This smoke predates lead-session ownership and remains evidence only for child-session continuation across adapter and registry reconstruction. The machine-local registry directory and session identifiers are intentionally not recorded in the repository. Current deterministic tests in `test/registry.test.js`, `extensions/subagent/index.test.mjs`, and `packages/pi-execution-adapter/test/adapter.test.js` cover lead-session ownership and default status isolation, persisted-session mutation guards, legacy one-time claim, locking, dead-owner reclaim, inspection, continuation validation, and mismatch failure without real processes.
