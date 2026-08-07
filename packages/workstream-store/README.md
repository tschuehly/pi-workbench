# Workstream Store

User-local sparse Workstream ledgers and deterministic projections behind the contract in
[`docs/contracts/workstreams.md`](../../docs/contracts/workstreams.md).

## Interface

`WorkstreamStore` exposes asynchronous `create`, `append`, `inspect`, `list`, `watch`, and `close`
operations. Mutation inputs are runtime-validated and typed by `src/index.d.ts`. Revisions are per
Workstream; observation sequences are store-wide and ordered.

```js
import {
  InMemoryWorkstreamAdapter,
  WorkstreamStore,
} from "@pi-workbench/workstream-store";

const store = new WorkstreamStore({ adapter: new InMemoryWorkstreamAdapter() });
await store.create({
  workstreamId: "ws-1",
  idempotencyKey: "create-ws-1",
  title: "Example",
  producer: "owner",
});
```

Use `InMemoryWorkstreamAdapter` for contract tests. `FileWorkstreamAdapter` atomically persists the
ledger database in a caller-selected user-local directory. `createUserLocalWorkstreamStore()` uses
`~/.pi-workbench/workstreams` by default. Do not point it into the repository or commit its data.

## Records

The accepted semantic records cover pending/confirmed/failed session associations, checkpoint
replacement/failure/staleness, durable Human Task changes and answers, and relevant link changes.
Raw transcripts and routine activity are intentionally not accepted. Closure is available only
through `close`.

Failed launches remain as `failed` sessions with their association anchor and a provenance-bearing
`launchFailure`. `checkpoint.stale` must name the latest confirmed checkpoint; it creates a
provenance-bearing `checkpointStaleness` value that only a later `checkpoint.replaced` clears.
Neither state is inferred from Chat or tool activity.

A typed Human Task declares `answerKind` (`yes-no`, `choice`, or `free-text`), explicit `options`,
and `materiality` (`material` or `non-material`). The projection preserves the task's
`sourceSessionId`, status, answer, and durable answer receipt. `human-task.answered` is a separate
revision-checked mutation; its exact retry returns the original Workstream receipt. Legacy
`title`/`detail` tasks remain accepted as non-answerable tasks with null typing fields and retain
their prior remove-on-resolution projection behavior.

Exact idempotent retries return the first receipt. Changed input under the same key, stale revisions,
illegal session transitions, unknown fields or records, and oversized mutations are rejected with a
`WorkstreamStoreError` carrying a stable `code`.

`watch` returns ordered retained mutation events. If `afterSequence` predates retained events, it
returns current snapshots with `mode: "snapshot"` so clients can reconcile deterministically.
