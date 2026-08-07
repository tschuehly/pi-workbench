# Workstream Specification

Defines the supported cross-session attention, ledger, attended checkpoint, and closure behavior.

This document is authoritative for Workstreams. The [system overview](../foundation/system-overview.md) remains authoritative for system-wide behavior and boundaries. The [interface contract](interfaces.md) remains authoritative for PI WEB presentation.

## Workstream

A Workstream is a finite, user-local container for restoring and allocating Human Attention across interactive sessions. It answers what the owner was doing, what changed, what needs human action, and where work can resume after interruption or time away.

A Workstream may:

- contain multiple concurrent interactive Pi sessions;
- link Runs, files, plans, artifacts, and repositories without owning them;
- retain human tasks raised during its sessions;
- span multiple repositories;
- revisit a topic addressed by an earlier, closed Workstream.

Every interactive session starts in exactly one Workstream. Session launch first records a pending association under one idempotency key, then asks PI WEB to start the session with that Workstream identity and confirms or fails the association from the result. Reconnect reconciles pending associations rather than creating another session, and the store rejects a session identifier already assigned to another Workstream. Other Workstreams may reference its checkpoint or artifacts, but the session has one home ledger. Several Workstreams and several sessions within a Workstream may remain active at the same time.

A Workstream is not a managed Run, project, chat folder, artifact taxonomy, or authority boundary. It grants no mutation permission, workspace lease, lifecycle transition, publication right, or recovery guarantee. A linked managed Run retains its own owner, ledger, controller lifecycle, and authority.

## Small persistence interface

Pi Workbench owns Workstream state behind a small interface:

```text
create(CreateWorkstream) -> WorkstreamReceipt
append(AppendWorkstream) -> WorkstreamReceipt
inspect(WorkstreamId) -> WorkstreamSnapshot
list(WorkstreamQuery) -> WorkstreamSummary[]
watch(WorkstreamWatch) -> WorkstreamEventBatch
close(CloseWorkstream) -> WorkstreamReceipt
```

Mutation requests carry an idempotency key and, after creation, the expected Workstream revision. An exact retry returns the original receipt; reuse of the key with different input is rejected. Each receipt records the accepted revision and resulting snapshot reference. `watch` resumes ordered observation after a sequence and falls back to snapshot reconciliation when replay is unavailable. Pi sessions and PI WEB use this interface rather than writing Workstream storage directly. The exact wire schemas remain subject to trial validation.

A newly confirmed session association must include a complete machine, project, and workspace location. Projection rebuilding remains compatible with older ledgers whose confirmed records predate that requirement. An incomplete active legacy association may be repaired only by appending `session.anchor.repaired`; no caller rewrites its earlier records.

## Ledger and current state

Each Workstream has a concise append-only ledger. Agents append only at meaningful attention changes; routine tool activity, repeated summaries, raw transcripts, and verbose model output do not belong in the ledger. Files and large artifacts remain in their owning stores and are linked by reference.

The ledger may record session association, append-only session-anchor repair, checkpoint replacement, human-task changes, relevant links, and closure. Records identify their producer and source session. Size limits and validation prevent a session from turning the ledger into standing model context.

`session.anchor.repaired` names an active session and a complete `machineId`, `projectId`, and `workspaceId`. Its bounded resolution receipt records the PI WEB complete-machine scan method, evidence identity, matched catalog working directory, scanned-scope count, and verification time. The receipt is provenance evidence supplied by PI WEB, not Store-owned truth about the external session catalog. Immediately before append, trusted PI WEB plugin code must repeat the exact-identity catalog resolution and confirm the owner-selected location. The Store enforces only ledger-visible invariants: the Workstream is open, the session is active in this Workstream, its projected anchor is incomplete, the revision and idempotency key are current and fresh, and the session has no other Workstream home. Closed Workstreams and complete anchors cannot be repaired.

Current state is a separate mechanical projection over accepted records. It includes pending, active, and failed session associations and their latest projected anchors; each session's latest confirmed checkpoint plus explicit failure or staleness; durable Human Tasks and answer receipts; relevant links; and closure state. Anchor repair updates only the existing session's projected location and never creates another association. Pi Workbench does not persist a second combined narrative across sessions.

## Checkpointing

Checkpointing is explicit and attended in V1. The owner asks the active Pi session to propose a
concise checkpoint stating what changed, what remains, and the next useful continuation. The owner
may correct the proposal before confirming persistence. Only the confirmed checkpoint replaces the
session's previous checkpoint.

The proposing session writes the checkpoint for the owner who will read it later, following the
`write-for-humans` skill. Each field leads with its point, uses plain concrete language, names the
concrete artifacts it refers to, and lets the owner resume without rereading the session. `whatChanged`
states what now exists or works, `remains` separates what is blocked or still owed, and `next` ends with
one obvious action the owner can start now.

A failed, rejected, or abandoned proposal remains visible as a checkpoint failure when applicable
and does not invent continuation state or replace the latest confirmed checkpoint. Staleness changes
only through an explicit record naming the latest confirmed checkpoint; Chat and tool activity never
imply it. A later confirmed replacement clears the stale state. V1 does not use a watcher, background
model turn, or fresh model context to create Workstream checkpoints.

## Human Tasks

A durable answerable Human Task declares a yes/no, finite-choice, or free-text answer kind, explicit
options where applicable, source-session provenance, and materiality. Answering is a separate,
revision-checked, idempotent Workstream mutation that records the answer and its receipt. Resolving
a task is distinct from answering it.

A live PI WEB `ask_user` submission remains live session attention. It is not copied into a durable
Human Task implicitly, and submitting one does not make a Workstream answer atomic with it.

## Completion and cleanup

Closing a Workstream freezes that context as completed. Later work on the same topic starts a new Workstream and may reference the closed one.

Before closure, Pi Workbench recommends reviewing unresolved human tasks and linked scratch files. Closure does not require that review. Unresolved items remain visible in the closed projection. Cleanup is proposed rather than automatic: files are deleted only after human confirmation.
