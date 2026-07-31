# Workstream Specification

Defines the supported cross-session attention, ledger, checkpoint, and FirstMate behavior.

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

Mutation requests carry an idempotency key and, after creation, the expected Workstream revision. An exact retry returns the original receipt; reuse of the key with different input is rejected. Each receipt records the accepted revision and resulting snapshot reference. `watch` resumes ordered observation after a sequence and falls back to snapshot reconciliation when replay is unavailable. FirstMate, Pi sessions, watchers, and PI WEB use this interface rather than writing Workstream storage directly. The exact wire schemas remain subject to trial validation.

## Ledger and current state

Each Workstream has a concise append-only ledger. Agents append only at meaningful attention changes; routine tool activity, repeated summaries, raw transcripts, and verbose model output do not belong in the ledger. Files and large artifacts remain in their owning stores and are linked by reference.

The ledger may record session association and checkpoint replacement, human-task changes, relevant links, and closure. Records identify their producer and source session. Size limits and validation prevent a session from turning the ledger into standing model context.

Current state is a separate mechanical projection over accepted records. It includes active sessions, each session's latest checkpoint, unresolved human tasks, relevant links, and closure state. Pi Workbench does not persist a second combined narrative across sessions. FirstMate may synthesize a current “what next?” view on demand from the projection.

## Checkpointing

The session doing the work does not own checkpoint timing. A deterministic watcher observes structured Pi and PI WEB session lifecycle signals and requests a checkpoint at configured attention boundaries. Initial trigger timing is experimental because owners may work in several Workstreams and sessions concurrently.

A fresh, focused Pi context prepares the concise checkpoint from the session and referenced files. The checkpoint states what changed, what remains, and the next useful continuation. The watcher triggers and records the operation; it does not perform semantic summarization. Checkpoint failure remains visible and does not invent a successful continuation state.

## FirstMate

FirstMate is the owner-facing Portfolio Broker profile for cross-session interaction in Pi Workbench. One FirstMate works across the owner's Workstreams. It reads Workstream projections and linked Run attention to help the owner:

- see what changed while away;
- choose a Workstream or session to resume;
- review human tasks across Workstreams;
- start a new session in a Workstream;
- close a finished Workstream.

FirstMate does not own Workstream storage or managed Run state. It may recommend priorities, checkpoint timing, and cleanup, but the supporting services perform persistence and legal Run transitions.

## Completion and cleanup

Closing a Workstream freezes that context as completed. Later work on the same topic starts a new Workstream and may reference the closed one.

Before closure, Pi Workbench recommends reviewing unresolved human tasks and linked scratch files. Closure does not require that review. Unresolved items remain visible in the closed projection. Cleanup is proposed rather than automatic: files are deleted only after human confirmation.
