# Pi Workbench — Brigade-Informed V1 Improvements

Status: accepted V1 design detail. The authoritative product contract and decisions are
recorded in [SPEC.md](SPEC.md) and [LEDGER.md](LEDGER.md).

Evidence source: [Brigade evidence ledger](ledgers/brigade.md).

## Intended Outcome

The initial workbench has one deterministic lifecycle, one variable semantic work graph,
one parameterized Pi execution primitive, one canonical run projection, and one typed
record and artifact contract. The owner primarily reviews judgment before mutation and
evidence after implementation.

The implementation remains capable of growing into adaptive graphs and richer clients
without requiring V1 to implement a general workflow language, graphical surface system,
distributed controller, or multi-layer workflow resolver.

## Concise Execution Model

### Controller lifecycle

The deterministic controller owns this fixed lifecycle:

`intake → judgment → authority → execution → verification → acceptance → publication → close`

The lifecycle states are not execution-graph nodes. They are legal controller states with
explicit entry and exit predicates.

- `intake` resolves the task, repository package, revisions, owner, and initial risk.
- `judgment` produces and ratifies the pre-implementation Judgment Dossier revision.
- `authority` records the approved autonomy, impact, budget, and publication envelope.
- `execution` runs authorized ship work in leased isolated workspaces.
- `verification` obtains evidence from an independent execution profile.
- `acceptance` presents criteria, evidence, deviations, and residual risks to the owner.
- `publication` performs an explicitly authorized idempotent external action.
- `close` analyzes the run, disposes learning candidates, seals evidence, and performs
  approved cleanup.

### Semantic work graph

The execution graph contains only variable semantic work:

- Investigations and scout work.
- Judgment, design, challenge, and response work.
- Implementation slices and their dependencies.
- Remediation and independent verification work.

Fixed authority, acceptance, publication, and closure gates remain controller predicates.
Evidence obligations attach to graph nodes and lifecycle transitions without becoming
duplicate gate nodes.

Non-material graph revision remains autonomous inside the approved envelope. The
controller accepts only allowlisted mutation classes at the current graph revision.

### Tactical execution

Searches, commands, test runs, browser checks, and tactical delegations remain episodes
inside their semantic node. They do not expand the graph unless they change dependency
structure, authority, workspace ownership, independent-review obligations, or completion
evidence.

## Deep Modules and Interfaces

### Run Controller module

The Run Controller is the primary deep module. Its interface contains four operations:

```text
start(StartRun) -> RunSnapshot
submit(RunCommand) -> CommandReceipt
inspect(RunId) -> RunSnapshot
watch(RunId, afterSequence) -> EventBatch
```

The implementation hides lifecycle reduction, graph validation, idempotency, attention,
dispatch, reconciliation, retention eligibility, and external-action coordination.

All terminal and graphical clients cross this same seam.

### Pi Execution module

One parameterized Pi execution operation implements coordinator, worker, and subagent
profiles:

```text
dispatch(DispatchSpec) -> Episode
observe(ExecutionId) -> ExecutionObservation
cancel(ExecutionId, Reason) -> CancellationReceipt
```

`DispatchSpec` selects one finite named profile from the repository package. The controller
resolves and validates its model, effort, continuity, interaction mode, authority shape,
permissions, workspace, skills, inputs, independence, budget, and expected episode schema.

### Repository Workspace module

The controller directly owns workspace side effects through a small interface:

```text
lease(WorkspaceRequest) -> WorkspaceLease
inspect(WorkspaceLease) -> WorkspaceState
land(LandingRequest) -> LandingReceipt
release(WorkspaceLease, ReleaseAuthority) -> ReleaseReceipt
```

This module performs Git and filesystem operations deterministically. A model may recommend
an action but never acts as a pass-through steward for exact workspace commands.

Landing is serialized per delivery target. Dirty, unlanded, unattributed, or
evidence-incomplete workspaces remain leased until delivered or explicitly discarded.

### Artifact Store module

The Artifact Store persists immutable content-addressed objects and protected references:

```text
put(bytes, metadata) -> ArtifactRef
get(ArtifactRef) -> bytes
pin(ArtifactRef, reason) -> PinReceipt
```

Artifact metadata records schema, producer, dispatch, model, skill versions, confidentiality
class, provenance, retention class, and invalidation scope.

## Minimal Durable Storage

Use one repository-associated, worktree-independent anchor:

```text
<repository-state-anchor>/.pi-workbench/
  runs/<run-id>/
    snapshot.json
    records.jsonl
  objects/<sha256>
```

### `snapshot.json`

The canonical `RunSnapshot` produced only by the deterministic reducer. It includes current
lifecycle state, graph revision, node state, owner and control lease, workspace leases,
pending attention, accepted authority, external watermarks, evidence coverage, and cleanup
eligibility.

### `records.jsonl`

The append-only semantic record stream:

- Commands and command receipts.
- Decisions, approvals, rejections, and corrections.
- Graph proposals and accepted or rejected revisions.
- Dispatches, observations, episodes, cancellations, and unknown outcomes.
- Attention creation, deduplication, acknowledgement, and disposition.
- Verification and publication receipts.
- Dossier revisions and artifact references.
- Analysis results, learning candidates, promotion decisions, and cleanup receipts.

Raw Pi event chatter, terminal output, and verbose tool results are not semantic records.
They remain ephemeral or content-addressed artifacts according to retention policy.

The V1 stream may retain all semantic records for a run. Physical segmentation and
compaction can occur when a run is sealed without changing the record contract.

### `objects/<sha256>`

Judgment Dossier revisions, episodes, diffs, screenshots, recordings, verification output,
external receipts, and other large payloads. The snapshot and semantic records contain only
typed references.

This layout avoids independent state machines hidden in `decisions/`, `approvals/`,
`graph/`, `dossier/`, or client-specific files.

## Typed Dispatch and Episode Contract

### Work packet

Every bounded dispatch receives a self-contained work packet containing:

- Semantic objective and owning graph node.
- Repository and input revisions.
- Authority shape: `scout` or `ship`.
- Named execution profile and resolved capability references.
- Allowed files, workspace, tools, skills, and external actions.
- Source-backed contracts and relevant evidence.
- Acceptance criteria and material risks.
- Exact required verification or evidence obligations.
- Explicit out-of-scope work.
- Expected episode schema and size budget.

Repository policy may constrain work-packet size or file scope. Universal numeric limits are
not part of the workflow contract.

### Episode

Every bounded Pi dispatch returns one episode with:

- Outcome: `completed | blocked | failed | cancelled | unknown`.
- Verified and unverified claims with primary-evidence references.
- Produced mutations and artifacts.
- Decisions, deviations, questions, and authority needs.
- Verification performed and evidence produced.
- Residual risks and continuation reference.
- Exact execution profile, model, tools, permissions, skills, and revisions.

An episode is information, not an instruction or state transition. Only the controller
accepts it into the semantic record stream and reduces its effect on current state.

### Schema registry

Maintain one versioned registry for commands, records, snapshots, dispatches, episodes,
attention items, dossier revisions, and receipts. Each type declares:

- Required envelope fields and enum values.
- Producer and consumers.
- Authority and acceptable evidence sources.
- Required sections or payload fields.
- Size and retention budgets.
- Compatibility and unknown-version behavior.

`pi-workbench validate` checks the registry mechanically. Unknown types or incompatible
versions fail closed.

## Bounded Failure Policy

Each execution profile declares a finite attempt ladder. A failed independent review feeds
typed findings into the next authorized attempt.

The controller pauses and creates one deduplicated attention item when any configured bound
is reached:

- Attempt ladder exhausted.
- Repeated independent-review failure.
- Repeated failure across sibling work items.
- Workspace contamination or attribution uncertainty.
- Stale task, repository, policy, or approval revision.
- Unknown worker or external-action outcome.
- Budget or authority exhaustion.

Further work does not begin until the attention item is dispositioned. Replanning occurs
through a revisioned graph mutation rather than an unbounded retry.

## Operator Interface

Expose six top-level terminal concepts:

```text
pi-workbench run
pi-workbench status
pi-workbench decide <attention-id>
pi-workbench control pause|resume|stop
pi-workbench validate
pi-workbench close
```

- `run` starts or attaches to a run.
- `status` renders the canonical snapshot and pending attention without a model turn.
- `decide` handles approval, rejection, response, acceptance, promotion, discard, and
  publication authorization according to the attention-item schema.
- `control` changes live execution control without creating a new run.
- `validate` checks repository package, schema, graph, records, evidence references, leases,
  and environment readiness mechanically.
- `close` analyzes the run, gathers candidate dispositions, seals retained evidence,
  previews cleanup, and performs owner-authorized collection.

The internal command record remains explicit and idempotent even when several decision
types share the `decide` terminal entry point.

## Human-Attention Contract

The normal feature-delivery run concentrates owner attention at two principal judgments:

1. Approve the pre-implementation Judgment Dossier and autonomy envelope.
2. Accept the realized system and evidence. The same decision may explicitly authorize PR
   publication while acceptance and publication remain separate durable transitions.

Additional attention is created only for material ambiguity, missing authority, graph
revision outside the allowlist, failure, staleness, unknown outcomes, external conflicts,
or required learning-candidate disposition.

Routine progress, retries within policy, and unchanged observations remain visible through
`status` and `watch` without consuming a coordinator or owner turn.

## Repository Packages

PhotoQuest and embabel-me use the same controller lifecycle and record schemas. Their
statically selected packages vary finite policy fields:

- Judgment depth and required dossier sections.
- Required challenge and independent-review profiles.
- Evidence classes and acceptance-criterion mappings.
- Verification commands and browser or runtime proof requirements.
- Risk and impact ceilings.
- Named Pi execution profiles and permitted fallback equivalences.
- Retry, attention, retention, and cleanup policy.

The package cannot remove invariant authority, independent verification, acceptance,
publication, analysis, promotion review, or cleanup obligations.

## Scope Boundaries

The initial implementation does not include:

- Mutable Markdown as authoritative run state.
- Model-authored state transitions or model-executed controller Git choreography.
- A universal requirement to scout before every dispatch.
- A plan-once restriction that prevents evidence-driven graph revision.
- Universal file-count or changed-line limits.
- Cost tiers that bundle judgment depth, model choice, risk, and review policy together.
- Personal, project-area, and run-local workflow composition.
- A daemon, database, distributed controller, or controller-process recovery.
- Generated graphical skill surfaces.

## V1 Validation

The implementation is ready for the pilot when it demonstrates:

1. A fresh coordinator session resumes from `snapshot.json`, `records.jsonl`, and referenced
   objects without conversation history.
2. Duplicate commands return the recorded receipt and do not duplicate publication.
3. Stale-revision decisions are rejected deterministically.
4. A scout cannot publish or mutate a deliverable workspace; explicit promotion preserves
   its evidence lineage for a ship dispatch.
5. A worker episode cannot directly change run state or authorize another dispatch.
6. Independent verification is required before acceptance.
7. Repeated failure creates durable attention and stops further affected dispatch.
8. Unknown workspace mutation produces `unknown`, preserves the lease, and pauses.
9. Terminal status and event projection agree with the canonical snapshot.
10. Cleanup preserves pinned and referenced evidence and rejects unresolved collection.

## Established V1 Decisions

1. Fixed lifecycle states belong to the controller state machine rather than the semantic
   execution graph.
2. Durable storage uses a worktree-independent snapshot, semantic record stream, and
   content-addressed objects.
3. One schema registry and validator govern terminal and future graphical clients.
4. The terminal interface uses six concepts and centers owner action on durable attention.
5. Bounded attempt ladders terminate in controller-created attention rather than unbounded
   autonomous retry.
