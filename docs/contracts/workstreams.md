# Workstream Specification

A Workstream is the durable, user-local attention record that lets an owner resume interactive work across sessions. It records meaningful changes, pending human action, and continuation context without becoming a managed Run or an authority boundary. This contract defines Workstream association, persistence, checkpointing, Human Tasks, and closure.

This document is authoritative for Workstreams. The [system overview](../foundation/system-overview.md) remains authoritative for system-wide behavior and boundaries. The [interface contract](interfaces.md) remains authoritative for PI WEB presentation.

## Purpose and Boundary

A Workstream is a finite container for restoring and allocating Human Attention. It answers:

- What was the owner doing?
- What changed?
- What needs human action?
- Where can work resume after interruption or time away?

A Workstream may:

- contain multiple concurrent interactive Pi sessions;
- link Runs, files, plans, artifacts, and repositories without owning them;
- retain Human Tasks raised during its sessions;
- span multiple repositories; and
- revisit a topic addressed by an earlier, closed Workstream.

A Workstream is not a managed Run, project, Chat folder, artifact taxonomy, or authority boundary. It grants no mutation permission, workspace lease, lifecycle transition, publication right, or recovery guarantee. A linked managed Run retains its own owner, ledger, controller lifecycle, and authority.

Several Workstreams may remain active at once, and one Workstream may contain several active sessions.

## Session Association

Every associated interactive session has exactly one home Workstream. Other Workstreams may reference that session's checkpoint or artifacts, but they cannot become a second home ledger.

Host-coordinated launch follows one handshake:

1. Record a pending association under one idempotency key.
2. Ask PI WEB to start the session with that Workstream identity.
3. Confirm or fail the association from the result.

An attended session started outside PI WEB may instead self-associate before writing other ledger changes. Reconnect reconciles pending associations rather than creating another session. The Store rejects a session identifier already assigned to another Workstream.

`packages/workstream-session-coordination/` coordinates attended-session creation outside the Store. Its small interface:

- inspects checkpoint-continuation candidates;
- launches a blank or explicitly selected checkpoint continuation; and
- reconciles pending associations.

The module accepts Workstream and attended-session adapters. It records pending before host creation and confirms a host-created session only when the result includes its complete runtime `machineId`, `projectId`, and `workspaceId`.

Explicit cancellation removes the pending association through `session.cancelled`; its ledger tombstone keeps the operation token permanently occupied. A proven pre-creation failure uses `session.failed`. Transport loss, Store contention after creation, and other unknown outcomes remain pending.

PI WEB uses this module for migrated launches. Any future terminal continuation interface must also use it rather than implementing another launch handshake.

The Store additionally permits an already-running attended session without host catalog context to self-associate when both its pending and confirmed records omit all three location fields. The session then becomes active and may checkpoint. Partial confirmation anchors are rejected. Projection rebuilding remains compatible with older incomplete records.

An incomplete active association can be repaired only by appending `session.anchor.repaired`; no caller rewrites earlier records.

## Persistence Interface

Pi Workbench owns Workstream state behind this interface:

```text
create(CreateWorkstream) -> WorkstreamReceipt
append(AppendWorkstream) -> WorkstreamReceipt
inspect(WorkstreamId) -> WorkstreamSnapshot
list(WorkstreamQuery) -> WorkstreamSummary[]
watch(WorkstreamWatch) -> WorkstreamEventBatch
close(CloseWorkstream) -> WorkstreamReceipt
```

Mutation requests carry an idempotency key and, after creation, the expected Workstream revision. An exact retry returns the original receipt. Reusing the key with different input is rejected. Each receipt records the accepted revision and resulting snapshot reference.

`watch` resumes ordered observation after a sequence. If replay is unavailable, it falls back to snapshot reconciliation. Pi sessions and PI WEB use this interface instead of writing Workstream storage directly. The exact wire schemas remain subject to trial validation.

## Ledger and Current State

Each Workstream has a concise append-only ledger. Agents append only at meaningful attention changes. Routine tool activity, repeated summaries, raw transcripts, and verbose model output do not belong in the ledger. Files and large artifacts remain in their owning stores and are linked by reference.

The ledger may record:

- session association;
- explicit launch cancellation;
- append-only session-anchor repair;
- checkpoint replacement;
- Human Task changes;
- relevant links; and
- closure.

A pending derived session may identify `checkpoint` or `fork` as its derivation kind. Records identify their producer and source session. Size limits and validation prevent a session from turning the ledger into standing Model Context.

Current state is a separate mechanical projection over accepted records. It includes:

- pending, active, and failed session associations and their latest projected anchors;
- each session's latest confirmed checkpoint, plus explicit failure or staleness;
- durable Human Tasks and answer receipts;
- relevant links; and
- closure state.

Anchor repair updates only the existing session's projected location; it never creates another association. Pi Workbench does not persist a second combined narrative across sessions.

### Session-anchor repair

`session.anchor.repaired` names an incomplete active session and supplies a complete `machineId`, `projectId`, and `workspaceId`.

Its bounded resolution receipt records the PI WEB complete-machine scan method, evidence identity, matched catalog working directory, scanned-scope count, and verification time. The receipt is provenance evidence supplied by PI WEB, not Store-owned truth about the external session catalog.

Immediately before append, trusted PI WEB plugin code must repeat the exact-identity catalog resolution and confirm the owner-selected location. The Store enforces only ledger-visible invariants:

- the Workstream is open;
- the session is active in this Workstream;
- its projected anchor is incomplete;
- the revision and idempotency key are current and fresh; and
- the session has no other Workstream home.

Closed Workstreams and complete anchors cannot be repaired.

## Checkpointing

The active Pi session writes a concise checkpoint automatically at a meaningful attention change. It does not wait for the owner to confirm each field. The checkpoint states:

- what changed;
- what remains;
- the next useful continuation; and
- an exact prompt for starting the next session.

A checkpoint is a correctable projection of where the work stands, not an authority transition. The owner may correct or replace it at any time. A later checkpoint supersedes an earlier one. Closing the Workstream remains explicit and human-instructed.

The active session writes for the owner who will read the checkpoint later and follows the `write-for-humans` skill. Each field must:

- lead with its point;
- use plain, concrete language;
- name the concrete artifacts it references; and
- let the owner resume without rereading the session.

`whatChanged` states what now exists or works. `remains` separates what is blocked or still owed. `next` gives one obvious owner-facing action.

The required `nextSessionPrompt` is a separate, paste-ready prompt for a fresh attended Pi session. It carries only the context, constraints, starting action, and references needed to continue safely. It does not restate the conversation or expand into an execution plan. The prompt is persisted with the rest of the checkpoint, remains owner-correctable, and is limited to 2,000 characters. Durable checkpoint and link references must not point into operating-system temporary directories such as `/tmp`, `/private/tmp`, `/var/tmp`, or macOS temporary folders; the Store rejects those references instead of creating future stale launch targets.

Checkpoints accepted before `nextSessionPrompt` existed project `nextSessionPrompt: null` rather than inventing a prompt. Every new replacement requires the field.

A failed, rejected, or abandoned proposal remains visible as a checkpoint failure when applicable. It does not invent continuation state or replace the latest confirmed checkpoint.

Staleness changes only through an explicit record naming the latest confirmed checkpoint; Chat and tool activity never imply staleness. A later confirmed replacement clears stale state. V1 does not use a watcher, background model turn, or fresh Model Context to create Workstream checkpoints.

## Human Tasks

A durable, answerable Human Task declares:

- a yes/no, finite-choice, or free-text answer kind;
- explicit options where applicable;
- source-session provenance; and
- materiality.

Answering is a separate, revision-checked, idempotent Workstream mutation that records the answer and its receipt. Resolving a task is distinct from answering it.

A live PI WEB `ask_user` submission remains live session attention. It is not copied implicitly into a durable Human Task, and submitting one does not make a Workstream answer atomic with it.

## Completion and Cleanup

Closing a Workstream freezes that context as completed. Later work on the same topic starts a new Workstream and may reference the closed one.

Before closure, Pi Workbench recommends reviewing unresolved Human Tasks and linked scratch files. Closure does not require that review. Unresolved items remain visible in the closed projection.

Cleanup is proposed rather than automatic. Files are deleted only after human confirmation.
