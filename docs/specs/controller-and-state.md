# Controller and Durable State Specification

Defines the supported Run Controller, durable state, Repository Workspace, and Artifact Store contracts.

This document is authoritative for this contract. [The system specification](../SPEC.md) remains authoritative for system-wide behavior and boundaries.

## Run Controller Module

The Run Controller is the primary deep module. Terminal and graphical clients cross one interface:

```text
start(StartRun) -> RunSnapshot
submit(RunCommand) -> CommandReceipt
inspect(RunId) -> RunSnapshot
watch(RunId, afterSequence) -> EventBatch
```

Its implementation owns lifecycle reduction, graph validation, command idempotency, attention, dispatch, reconciliation, retention eligibility, and external-action coordination. Clients do not reproduce those semantics.

## Durable Run Ledger

Each run has a stable identifier and records the minimum state required to resume, supervise, reconcile, audit, and close the work:

- Workflow and policy versions.
- Task source and revision.
- Current lifecycle state, execution-graph revision, node states, and completed transitions.
- Graph proposals, validations, rejections, and superseded revisions.
- Decisions, approvals, deviations, and pending authority.
- Worker identity, model, tools, and permissions.
- Dispatches, episode records, and continuation references.
- Active control and supervision leases, reconciled attention items, and their source-event acknowledgements.
- Artifact and evidence references.
- External object references and synchronization watermarks.
- Validation results and invalidation scope.
- Cleanup eligibility and promoted knowledge references.

The repository-associated ledger anchor is independent of any disposable worktree and has three storage primitives:

```text
<repository-state-anchor>/.pi-workbench/
  runs/<run-id>/
    snapshot.json
    records.jsonl
  objects/<sha256>
```

`snapshot.json` is the versioned canonical `RunSnapshot`. `records.jsonl` is the append-only semantic record stream for commands and receipts, decisions and corrections, graph revisions, dispatches and episodes, attention, verification, publication, dossier revisions, analysis, promotion, and cleanup. `objects/<sha256>` stores immutable dossiers, episodes, diffs, screenshots, recordings, verification output, receipts, and other large payloads.

The deterministic controller reducer combines semantic records with live Pi execution observations to produce the authoritative current `RunSnapshot`. Immutable records are facts and accepted transitions, not independently interpreted current-state fields. Raw logs, terminal output, model messages, and verbose tool results remain ephemeral or referenced artifacts; they do not enter the semantic stream merely because they occurred. Missing, contradictory, or stale evidence produces `unknown` rather than a guessed state.

V1 may retain the complete semantic record stream for a run. Sealing may later segment or compact its physical representation without changing record identity or durable references.

Terminal summaries, portfolio and project attention, notifications, AFK digests, and graphical clients consume canonical projections and Attention Items. They do not independently infer state from raw event prose. Large tool results and media are stored as referenced, content-addressed artifacts.

## Repository Workspace Module

The controller owns project mutation through one workspace interface:

```text
lease(WorkspaceRequest) -> WorkspaceLease
inspect(WorkspaceLease) -> WorkspaceState
land(LandingRequest) -> LandingReceipt
release(WorkspaceLease, ReleaseAuthority) -> ReleaseReceipt
```

The implementation performs Git and filesystem operations deterministically. Models may recommend workspace actions but never act as pass-through executors for exact controller commands. Landing is serialized per delivery target. Dirty, unlanded, unattributed, or evidence-incomplete workspaces remain leased until confirmed delivery or explicit owner-authorized discard.

## Artifact Store Module

The Artifact Store persists immutable content-addressed objects through one interface:

```text
put(bytes, metadata) -> ArtifactRef
get(ArtifactRef) -> bytes
pin(ArtifactRef, reason) -> PinReceipt
```

Metadata records schema, producer, dispatch, model, skill versions, confidentiality class, provenance, retention class, and invalidation scope. Protected references participate in cleanup marking.
