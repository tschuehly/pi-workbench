# Worker Registry

Durable machine-local identity for Level 1 attended workers behind the plan in
[`docs/plans/level-1-durable-workers.md`](../../docs/plans/level-1-durable-workers.md). A worker is
a record — name, owning lead-session identifier, one semantic scope, bound repository root, bundled
profile, Pi session lineage, bounded dispatch receipts, dispatch lock, and retirement — never a waiting process. Continuity lives
in the referenced Pi session file; the registry stores references and receipts, not a second
narrative ledger.

## Interface

`WorkerRegistry` exposes asynchronous `create`, `inspect`, `list`, `beginDispatch`, `heartbeat`,
`completeDispatch`, and `retire`, typed by `src/index.d.ts`.

```js
import { createUserLocalWorkerRegistry } from "@pi-workbench/worker-registry";

const registry = createUserLocalWorkerRegistry(); // ~/.pi-workbench/workers
const worker = await registry.create({ name: "importer", scope: "importer redesign", profile: "implementer", repositoryRoot: cwd, ownerSessionId });
const grant = await registry.beginDispatch(worker.workerId, { pid: process.pid, repositoryRoot: cwd, ownerSessionId });
// … run one bounded execution, resuming grant.continuationSessionId when present …
await registry.completeDispatch(worker.workerId, grant.lockToken, { outcome: "success", sessionId });
```

## Dispatch lock

One dispatch at a time per worker. `beginDispatch` acquires a lock carrying the owner process
identifier, acquisition time, and heartbeat; every terminal `completeDispatch` releases it. A
concurrent dispatch fails with `WORKER_BUSY`. A dead owner is reclaimed only after `isProcessAlive`
verification (`ESRCH`); a live or unverifiable owner leaves the worker visibly locked, and a
reclaimed owner's stale token is rejected with `LOCK_NOT_HELD`. An `outcome_unknown` dispatch marks
the worker as requiring inspection; the next `beginDispatch` must pass `acknowledgeInspection`.
Retirement is immutable and blocks further dispatch. The extension passes the current lead-session
identifier to mutating operations; a foreign session fails with `WORKER_SESSION_MISMATCH`. The first
mutation of a legacy record without an owner claims it for the calling session. `list` requires an
owner and excludes retired records by default; `{ all: true }` is the explicit machine-wide diagnostic form.

Use `InMemoryWorkerAdapter` for tests. `FileWorkerAdapter` atomically persists `workers.json` in a
caller-selected user-local directory. Do not point it into a repository or commit its data. Corrupt
or unreadable registry data fails closed with `CORRUPT_STORE`; typed failures carry a stable `code`
on `WorkerRegistryError`. The registry grants no Run authority, workspace lease, managed recovery,
or unattended execution.

```sh
npm test --prefix packages/worker-registry
```
