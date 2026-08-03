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

## Ledger and current state

Each Workstream has a concise append-only ledger. Agents append only at meaningful attention changes; routine tool activity, repeated summaries, raw transcripts, and verbose model output do not belong in the ledger. Files and large artifacts remain in their owning stores and are linked by reference.

The ledger may record session association and checkpoint replacement, human-task changes, relevant links, and closure. Records identify their producer and source session. Size limits and validation prevent a session from turning the ledger into standing model context.

Current state is a separate mechanical projection over accepted records. It includes active sessions, each session's latest confirmed checkpoint, unresolved human tasks, relevant links, and closure state. Pi Workbench does not persist a second combined narrative across sessions.

## Checkpointing

Checkpointing is explicit and attended in V1. The owner asks the active Pi session to propose a
concise checkpoint stating what changed, what remains, and the next useful continuation. The owner
may correct the proposal before confirming persistence. Only the confirmed checkpoint replaces the
session's previous checkpoint.

A failed, rejected, or abandoned proposal remains visible as a checkpoint failure when applicable
and does not invent continuation state or replace the latest confirmed checkpoint. V1 does not use
a watcher, background model turn, or fresh model context to create Workstream checkpoints.

## Completion and cleanup

Closing a Workstream freezes that context as completed. Later work on the same topic starts a new Workstream and may reference the closed one.

Before closure, Pi Workbench recommends reviewing unresolved human tasks and linked scratch files. Closure does not require that review. Unresolved items remain visible in the closed projection. Cleanup is proposed rather than automatic: files are deleted only after human confirmation.
