# Pi Execution Specification

Defines the supported Pi execution, Dispatch, Episode, coordination, deliberation, and protocol contracts.

This document is authoritative for this contract. [The system overview](../foundation/system-overview.md) remains authoritative for system-wide behavior and boundaries.

## Pi Worker Runtime

Every model-backed execution unit is a Pi session or Pi process. Model providers are selected through Pi for the role; the workflow does not launch another coding-agent harness or a provider-specific coding CLI.

The Pi Execution module exposes one interface:

```text
dispatch(DispatchSpec) -> Episode
observe(ExecutionId) -> ExecutionObservation
cancel(ExecutionId, Reason) -> CancellationReceipt
```

The runtime implements one Pi execution primitive parameterized by cognitive role, model, reasoning effort, continuity, interaction mode, independence requirement, permissions, workspace lease, skills, inputs, expected episode schema, budget, and lifecycle. The repository package exposes a finite set of named execution profiles over these fields. The coordinator selects a profile for the semantic task; the controller resolves and validates every concrete field and rejects unrecognized profiles or invented permission combinations. Coordinator, worker, and subagent are semantic profiles over the same primitive:

- **Coordinator:** the owner-facing, resumable Pi execution that interprets intent, presents decisions, dispatches bounded work, and synthesizes run status. It does not replace the durable ledger and never receives a project-workspace write lease.
- **Worker:** a resumable Pi execution assigned one semantic scope such as design, implementation, review, or final synthesis. It can perform several bounded actions while preserving useful scope context.
- **Subagent:** a fresh Pi execution for one bounded action such as evidence gathering, a review lens, or finding verification.

Every bounded dispatch ends or pauses at a synchronization point and returns a typed episode. Worker and subagent activity is visible to the run through the same dispatch, episode, artifact, permission, budget, cancellation, and workspace-lease contract.

## Interactive and Ephemeral Execution

An interactive lead is an ordinary Pi TUI session bound to a Coordinator or Worker profile. An ephemeral Subagent receives one bounded Dispatch, returns one Episode, and ends. A resumable Worker may receive later controller-mediated Dispatches under the same Logical Actor identity when preserving scope context has value. Every follow-up still crosses a synchronization point and returns a new Episode; continuity never turns a conversation into authoritative Run state.

The Pi Execution interface remains `dispatch`, `observe`, and `cancel`. Starting or continuing an interactive Worker is expressed through Dispatch fields for Logical Actor identity, Continuity, and interaction mode rather than a second worker interface. Human or Coordinator messages cannot attach directly to a child process or bypass controller validation. An unmanaged harness adapter may preserve a Pi session for local interactive use, but it does not acquire Run authority, workspace rights, durable identity, or controller-mediated status by doing so.

Numbered Entry Presets define the supported unmanaged adoption path before controller mediation:

- Level 1 gives one editing lead access to fresh read-only advisory subagents.
- Level 2 lets the lead launch parallel read and write subagents in one workspace. Directory partitions are prompt-level coordination only: they are not enforced leases, do not prevent stale reads or shared-contract conflicts, and must be followed by lead reconciliation and whole-workspace verification.
- Level 3 requires an approved implementation contract, sends each semantic slice to a fresh context, uses contract-focused and cross-family independent review, and returns unresolved work to the human after at most two correction cycles.
- Level 4 leaves this unmanaged path and uses controller-validated Dispatches, Episodes, authority, and workspaces.

Unmanaged leads and children are ordinary Pi sessions or processes. Capitalized Run actors, Dispatches, Work Packets, Episodes, Ship authority, and workspace leases apply only after entering managed execution. The interface must show this distinction rather than converting session metadata or child output into authoritative Run state.

The controller assembles the smallest sufficient Model Context for each dispatch from its Work Packet, resolved skills, referenced Episodes, and relevant Primary Evidence. Full coordinator history, unrelated worker transcripts, stale tool output, and standing skill instructions do not enter a dispatch merely because they exist. A Worker preserves Continuity only where repeated work in one semantic scope benefits from it; a Subagent receives a fresh context where narrow focus or Independence is more valuable.

Logical Actor identity is durable, but every Pi model session is disposable. Brokers, Coordinators,
and Workers may be reconstructed in fresh sessions without changing their address, scope, or
accountability. Planning and context curation are episodic Cognitive Roles: a planner proposes or
revises semantic work and returns an Episode; a fresh Context Curator prepares a bounded
Continuation Artifact from the canonical snapshot, material Episodes, and Primary Evidence.

A Continuation Artifact records the current objective, graph and input revisions, ratified
decisions and rationale, material assumptions, verified and unverified claims, disagreements,
evidence references, pending attention, residual uncertainty, and next justified work. Every claim
references its durable source. The artifact is a replaceable projection for assembling a later Work
Packet; it does not replace semantic records, the Judgment Dossier, or Primary Evidence.

Authority, corrections, deviations, unresolved Material Questions, conflicting claims, workspace
mutations, evidence references, and pending Attention Items are retained mechanically regardless of
curator judgment. Raw transcripts, repeated status, and superseded tactical output may expire under
policy. Context rotation occurs at synchronization points such as an accepted graph revision,
completed experiment round, material judgment, landed semantic slice, completed independent
Verification, or declared context-pressure threshold. Rotation persists and validates the current
Episode and Continuation Artifact before a fresh session reconciles against the canonical snapshot.

Every `DispatchSpec` contains a self-contained work packet with the semantic objective and graph node, repository and input revisions, authority shape, named execution profile, allowed workspace and capabilities, source-backed contracts, relevant evidence, acceptance criteria, material risks, verification obligations, explicit exclusions, episode schema, and size budget. Repository packages may constrain packet size or file scope; the workflow does not impose universal file-count or changed-line limits.

For a Ship Dispatch, the Work Packet is directly executable rather than interpretive setup. It includes:

- The concrete outcome and the exact source revisions or artifact slices that define it.
- The relevant existing interfaces, with source paths and revisions, plus any referenced Episodes that justify relying on them.
- Allowed mutation scope when the selected repository profile uses path enforcement, represented as normalized repository-relative paths and a content hash of that scope.
- Repository examples whose conventions the implementation should follow.
- Explicit exclusions, neighboring work that must remain untouched, and the acceptance criteria assigned to this Dispatch.
- Exact validation commands, required evidence classes, and the changes that invalidate each result.

## V1 Ship Execution Contract

Implementation uses one bounded inner feedback loop inside the controller's `execution` state. The loop does not own lifecycle transitions, independent Verification, Acceptance, or Publication.

1. The controller confirms the approved authority, current graph and input revisions, named Ship profile, exclusive workspace lease, expected base revision, and eligible starting workspace state.
2. The controller Dispatches the Work Packet to one Pi Ship Worker. The worker implements only the assigned semantic slice and returns a typed Episode at every completion, correction, failure, or authority boundary.
3. After each worker mutation, the controller or a deterministic capability inventories tracked, staged, deleted, renamed, and non-ignored untracked paths. When the profile declares an allowed path set, any path outside it pauses the Dispatch for reconciliation. Scope expands only through a recorded graph or Work Packet revision made before further mutation.
4. The worker inspects the realized diff and runs the packet's local validation commands. A failed check may produce a correction Dispatch for the same work item, with the failure evidence and unchanged authority boundary.
5. Every validation result records the command, exit status, output artifact, tool version, base revision, and a workspace fingerprint covering the exact candidate content. Any later content mutation invalidates that result. A landing request cannot rely on validation evidence whose fingerprint differs from the landing candidate.
6. Each Ship profile has a finite correction ladder. The PhotoQuest pilot Ship profile permits at most three implementation attempts for one semantic slice. Exhaustion creates one deduplicated Attention Item and stops affected work.
7. A successful Ship Episode includes a mutation receipt: changed paths and change kinds, scope-check result, candidate workspace fingerprint, validation evidence, acceptance-criterion coverage, public-interface changes, deviations, unresolved claims, and residual risks.
8. The deterministic Repository Workspace module lands the candidate only when the Episode schema, authority, lease, scope, workspace fingerprint, and required validation evidence are current. Models do not stage, commit, rebase, push, or publish as controller pass-through executors.
9. After landing, the controller records the landing receipt and exposes a source-backed interface-contract view for later Work Packets. The view is derived from landed source and referenced Episodes; it is not an independently authoritative ledger.

The PhotoQuest pilot prefers one coherent semantic slice per commit when the slice is independently green and reviewable. Commit shape, exact path enforcement, and correction limits are repository-profile policies rather than universal workflow invariants.

Resuming an in-flight Ship Dispatch requires the recorded lease, base revision, graph revision, Work Packet hash, allowed-scope hash when present, and latest workspace fingerprint. A dirty workspace is eligible only when it belongs to that recorded Dispatch and its current mutation inventory satisfies the active scope. A changed base, unexplained path, missing lease, or fingerprint contradiction produces reconciliation instead of continuation.

Every dispatch also declares one authority shape orthogonal to its execution profile:

- **Scout:** investigates, plans, audits, reproduces, or prototypes within read-only or disposable scratch scope and returns a self-contained report and evidence. It cannot publish project changes or authorize implementation.
- **Ship:** may mutate an isolated project workspace inside the approved impact, publication, permission, and quality envelope and must return mutation and delivery evidence.

A scout conclusion or recommendation is evidence, not implementation authority. When implementation is separately authorized, the controller promotes the existing work item and evidence lineage to a ship dispatch instead of creating duplicate work. Scratch state is inventoried, only intended changes cross the authority seam, and any reproduction becomes reusable verification where applicable.

## Episode Return Interface

An episode is the compact, provenance-bearing result of one bounded execution action. It records:

- Dispatch, execution-graph node, actor, model, and resolved skill references.
- Objective, inputs, action scope, and outcome.
- Verified and unverified claims with primary-evidence references.
- Decisions, questions, authority needs, deviations, and residual risks.
- Repository mutations and produced artifact references.
- Continuation reference and the context justified for later reuse.

An episode is not authoritative truth and does not replace primary evidence, the run ledger, or the Judgment Dossier. Raw tactical traces remain ephemeral or separately referenced according to retention policy. Later dispatches consume episodes by reference rather than copying full worker context.

Execution-graph nodes represent variable semantic work, dependencies, worker bindings, and evidence obligations. Fixed lifecycle gates belong only to the controller state machine. Searches, commands, test runs, and tactical delegations remain episodes within a node unless they independently affect authority, dependency structure, review independence, or completion evidence.

## Execution Semantics

The workflow contract, execution graph, controller state machine, and Pi actors are distinct execution layers:

- The **workflow contract** defines the run's quality, authority, safety, evidence, and retention envelope.
- The **execution graph** represents the current organization of variable semantic work: nodes, dependencies, evidence obligations, worker bindings, and optional paths.
- The **controller state machine** owns the fixed lifecycle, legal transitions, graph revision, dispatch, cancellation, reconciliation, and closure.
- The **Pi actors** are addressable coordinator, worker, and subagent profiles with explicit identities, roles, permissions, scopes, and lifecycles.

Pi actors communicate through controller-routed dispatches, typed episode returns, and referenced artifacts rather than shared conversational context or direct mutation of authoritative run state. Dispatches and episodes carry actor, causation, graph revision, and evidence references. The controller supervises actor creation, completion, cancellation, failure, replacement, and unknown outcomes.

Graph evolution is explicit and revisioned. A coordinator may request or perform an authorized mutation, but the controller accepts or rejects it against the current graph revision and quality and authority envelope. Accepted revisions supersede earlier graph revisions without rewriting their history. The architecture uses actor-model semantics without requiring a particular actor framework.

## Model Routing

Models and Model Effort are selected independently by Cognitive Role, task shape, context needs, Continuity, Independence, and available capacity rather than treating one model or effort level as globally strongest. A stronger model does not justify a broader Model Context, and a longer-lived session is used only when its semantic Continuity is valuable. Routing effectiveness is evaluated from run outcomes instead of being fixed from social heuristics.

For unmanaged execution, the router accepts both Cognitive Role and Entry Preset. The role preserves the kind of thinking required; the preset selects an appropriate named Execution Profile and default Model Effort for that interaction posture. Leads and child Pi processes use the same resolver and fail visibly when the requested model family, Independence, or fresh quota evidence is unavailable. Managed Runs additionally validate the resolved binding against the Workflow Contract, Work Packet, authority, budget, and repository policy.

## Agent Deliberation

The coordinator can dispatch a specialist to question or challenge a claim and dispatch a response that references the challenge. These claim, challenge, and response episodes are durable and evidence-linked. The initial implementation does not provide peer mailboxes or open-ended worker conversations; one coordinator remains accountable for synthesis and the human-facing result.

## Execution Observations

Pi Execution emits structured lifecycle, tool-activity, usage, cancellation, and terminal-result observations to the Run Controller. These observations are evidence for reconciliation; they are not canonical client events or independently authoritative Run state. The controller accepts a result only through the expected Episode schema and exposes current state through its own snapshot and event interface.
