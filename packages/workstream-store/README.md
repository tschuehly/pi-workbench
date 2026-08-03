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
replacement/failure, unresolved human-task changes, and relevant link changes. Raw transcripts and
routine activity are intentionally not accepted. Closure is available only through `close`.

Exact idempotent retries return the first receipt. Changed input under the same key, stale revisions,
illegal session transitions, unknown fields or records, and oversized mutations are rejected with a
`WorkstreamStoreError` carrying a stable `code`.

`watch` returns ordered retained mutation events. If `afterSequence` predates retained events, it
returns current snapshots with `mode: "snapshot"` so clients can reconcile deterministically.
