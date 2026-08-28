# Pi Execution Specification

Pi Execution uses one `dispatch`/`observe`/`cancel` operation family for model-backed work. The current adapter implements that family for attended child Pi processes. This contract also defines an unbuilt managed form with Coordinator, Worker, Subagent, Episode, authority, workspace, and Run-state semantics.

This document is authoritative for this contract. [The system overview](../foundation/system-overview.md) remains authoritative for system-wide behavior and boundaries.

> **Implementation boundary:** the operation family and **Attended V1 Boundary** are current. The
> Episode-returning managed signature, named managed profiles, Work Packets, controller resolution,
> workspace leases, and all later managed sections are unbuilt.

## Operation Family and Future Profiles

Every model-backed execution unit is a Pi session or Pi process. Workbench resolves provider, model, and effort for the Cognitive Role; Pi executes that verified binding. Current and future execution use Pi rather than another coding-agent harness or provider-specific coding CLI.

The current `PiRpcExecutionAdapter` implements `dispatch`, `observe`, and `cancel` with attended execution receipts, observations, and results. The future managed boundary extends the same operation family to this contract:

```text
dispatch(DispatchSpec) -> Episode
observe(ExecutionId) -> ExecutionObservation
cancel(ExecutionId, Reason) -> CancellationReceipt
```

In managed execution, one Pi primitive would be parameterized by:

- Cognitive Role, model, and reasoning effort;
- Continuity, interaction mode, and Independence requirement;
- permissions and workspace lease;
- skills and inputs;
- expected Episode schema;
- budget; and
- lifecycle.

A repository package would expose named Execution Profiles over these fields. The Coordinator would select a profile for the semantic task, and the controller would resolve and validate every concrete field, rejecting unrecognized profiles and invented permission combinations.

The unbuilt managed profiles are:

- **Coordinator:** The owner-facing, resumable Pi execution that interprets intent, presents decisions, Dispatches bounded work, and synthesizes Run status. It does not replace the durable ledger and never receives a project-workspace write lease.
- **Worker:** A resumable Pi execution assigned one semantic scope, such as design, implementation, review, or final synthesis. It may perform several bounded actions while preserving useful scope context.
- **Subagent:** A fresh Pi execution for one bounded action, such as evidence gathering, a review lens, or finding verification.

Every managed Dispatch ends or pauses at a synchronization point and returns a typed Episode. Managed Worker and Subagent activity uses the same Dispatch, Episode, artifact, permission, budget, cancellation, and workspace-lease contract.

## Attended V1 Boundary

V1 supports attended human–Pi pairing. It does not use managed Dispatches, Episodes, Workers, or Subagents.

The interactive lead is an ordinary Pi session. V1 does not require a particular host; PI WEB is one supported host. The session may remain a standalone Chat or have exactly one home Workstream. A Workstream provides cross-session re-entry only; it does not grant execution authority.

While the human attends the session, the active interactive lead may launch bounded ephemeral child Pi processes through the harness's subagent tool. The lead remains accountable for their assignments and reconciliation. These children are ordinary Pi processes: their output remains session material and grants no workspace lease, Run authority, or recovery guarantee.

A durable attended worker may additionally retain a recorded machine-local identity and resume its persisted child session across bounded attended dispatches. That identity is unmanaged and executes only while the lead attends. It still grants no Run authority, workspace lease, or managed recovery.

The intended [Working Mode](../foundation/working-mode.md) changes attended alignment and checking behavior without converting these processes into managed actors.

Unmanaged leads and children are ordinary Pi sessions or processes. Capitalized Run actors, Dispatches, Work Packets, Episodes, Ship authority, and workspace leases apply only after entering managed execution. The interface must expose this distinction rather than converting session metadata or child output into authoritative Run state.

An unmanaged harness adapter may preserve a Pi session for local interactive use. Preservation does not grant Run authority, workspace rights, durable identity, or controller-mediated status.

Unless a later paragraph explicitly labels a V1 rule, the remainder of this contract defines the unbuilt managed Pi Execution boundary. It does not expand V1.

## Managed Interactive and Ephemeral Execution

In managed execution, the interactive lead is a Pi session bound to a Coordinator or Worker profile. An ephemeral Subagent receives one bounded Dispatch, returns one Episode, and ends.

A resumable Worker may receive later controller-mediated Dispatches under the same Logical Actor identity when preserving scope context has value. Every follow-up still crosses a synchronization point and returns a new Episode. Continuity never turns a conversation into authoritative Run state.

Starting or continuing an interactive Worker uses Dispatch fields for Logical Actor identity, Continuity, and interaction mode. It does not introduce a second Worker interface. Human or Coordinator messages cannot attach directly to a child process or bypass controller validation.

### Context and Continuity

The controller assembles the smallest sufficient Model Context for each Dispatch from its Work Packet, resolved skills, referenced Episodes, and relevant Primary Evidence. Full Coordinator history, unrelated Worker transcripts, stale tool output, and standing skill instructions do not enter a Dispatch merely because they exist.

A Worker preserves Continuity only when repeated work in one semantic scope benefits from it. A Subagent receives a fresh context when narrow focus or Independence is more valuable.

Logical Actor identity is durable, but every Pi model session is disposable. Brokers, Coordinators, and Workers may be reconstructed in fresh sessions without changing their address, scope, or accountability.

Planning and context curation are episodic Cognitive Roles. A planner proposes or revises semantic work and returns an Episode. A fresh Context Curator prepares a bounded Continuation Artifact from the canonical snapshot, material Episodes, and Primary Evidence.

A Continuation Artifact records:

- the current objective;
- graph and input revisions;
- ratified decisions and rationale;
- material assumptions;
- verified and unverified claims;
- disagreements and evidence references;
- pending attention;
- residual uncertainty; and
- next justified work.

Every claim references its durable source. The Continuation Artifact is a replaceable projection for assembling a later Work Packet. It does not replace semantic records, the Judgment Dossier, or Primary Evidence.

Authority, corrections, deviations, unresolved Material Questions, conflicting claims, workspace mutations, evidence references, and pending Attention Items are retained mechanically regardless of curator judgment. Raw transcripts, repeated status, and superseded tactical output may expire under policy.

Context rotation occurs at synchronization points, including:

- an accepted graph revision;
- a completed experiment round;
- a material judgment;
- a landed semantic slice;
- completed independent Verification; or
- a declared context-pressure threshold.

Before a fresh session reconciles against the canonical snapshot, rotation persists and validates the current Episode and Continuation Artifact.

## Work Packet Contract

Every `DispatchSpec` contains a self-contained Work Packet with:

- the semantic objective and graph node;
- repository and input revisions;
- authority shape;
- named Execution Profile;
- allowed workspace and capabilities;
- source-backed contracts and relevant evidence;
- acceptance criteria and material risks;
- verification obligations and explicit exclusions;
- Episode schema; and
- size budget.

Repository packages may constrain packet size or file scope. The workflow does not impose universal file-count or changed-line limits.

For a Ship Dispatch, the Work Packet is directly executable rather than interpretive setup. It includes:

- The concrete outcome and exact source revisions or artifact slices that define it.
- Relevant existing interfaces, with source paths and revisions, plus referenced Episodes that justify relying on them.
- Allowed mutation scope when the selected repository profile uses path enforcement. The scope is represented as normalized repository-relative paths and a content hash.
- Repository examples whose conventions the implementation should follow.
- Explicit exclusions, neighboring work that must remain untouched, and the acceptance criteria assigned to the Dispatch.
- Exact validation commands, required evidence classes, and the changes that invalidate each result.

## Authority Shapes

Every Dispatch declares one authority shape, orthogonal to its Execution Profile:

- **Scout:** Investigates, plans, audits, reproduces, or prototypes within read-only or disposable scratch scope. It returns a self-contained report and evidence. It cannot publish project changes or authorize implementation.
- **Ship:** May mutate an isolated project workspace within the approved impact, Publication, permission, and quality envelope. It must return mutation and delivery evidence.

A Scout conclusion or recommendation is evidence, not implementation authority. When implementation is separately authorized, the controller promotes the existing work item and evidence lineage to a Ship Dispatch instead of creating duplicate work.

Scratch state is inventoried. Only intended changes cross the authority seam, and any reproduction becomes reusable Verification where applicable.

## Managed Ship Execution Contract

Implementation uses one bounded inner feedback loop inside the controller's `execution` state. The loop does not own lifecycle transitions, independent Verification, Acceptance, or Publication.

1. The controller confirms the approved authority, current graph and input revisions, named Ship profile, exclusive workspace lease, expected base revision, and eligible starting workspace state.
2. The controller Dispatches the Work Packet to one Pi Ship Worker. The Worker implements only the assigned semantic slice and returns a typed Episode at every completion, correction, failure, or authority boundary.
3. After each Worker mutation, the controller or a deterministic capability inventories tracked, staged, deleted, renamed, and non-ignored untracked paths. If the profile declares an allowed path set, any path outside it pauses the Dispatch for reconciliation. Scope expands only through a recorded graph or Work Packet revision made before further mutation.
4. The Worker inspects the realized diff and runs the packet's local validation commands. A failed check may produce a correction Dispatch for the same work item, with failure evidence and an unchanged authority boundary.
5. Every validation result records the command, exit status, output artifact, tool version, base revision, and a workspace fingerprint covering the exact candidate content. Any later content mutation invalidates that result. A landing request cannot rely on validation evidence whose fingerprint differs from the landing candidate.
6. Each Ship profile has a finite correction ladder. The PhotoQuest pilot Ship profile permits at most three implementation attempts for one semantic slice. Exhaustion creates one deduplicated Attention Item and stops affected work.
7. A successful Ship Episode includes a mutation receipt: changed paths and change kinds, scope-check result, candidate workspace fingerprint, validation evidence, acceptance-criterion coverage, public-interface changes, deviations, unresolved claims, and residual risks.
8. The deterministic Repository Workspace module lands the candidate only when the Episode schema, authority, lease, scope, workspace fingerprint, and required validation evidence are current. Models do not stage, commit, rebase, push, or publish as controller pass-through executors.
9. After landing, the controller records the landing receipt and exposes a source-backed interface-contract view for later Work Packets. The view is derived from landed source and referenced Episodes; it is not an independently authoritative ledger.

The PhotoQuest pilot prefers one coherent semantic slice per commit when the slice is independently green and reviewable. Commit shape, exact path enforcement, and correction limits are repository-profile policies, not universal workflow invariants.

### Resuming a Ship Dispatch

Resuming an in-flight Ship Dispatch requires:

- the recorded lease;
- base revision;
- graph revision;
- Work Packet hash;
- allowed-scope hash, when present; and
- latest workspace fingerprint.

A dirty workspace is eligible only when it belongs to that recorded Dispatch and its current mutation inventory satisfies the active scope. A changed base, unexplained path, missing lease, or fingerprint contradiction produces reconciliation instead of continuation.

## Episode Return Interface

An Episode is the compact, provenance-bearing result of one bounded execution action. It records:

- Dispatch, execution-graph node, actor, model, and resolved skill references.
- Objective, inputs, action scope, and outcome.
- Verified and unverified claims with Primary Evidence references.
- Decisions, questions, authority needs, deviations, and residual risks.
- Repository mutations and produced artifact references.
- Continuation reference and the context justified for later reuse.

An Episode is not authoritative truth. It does not replace Primary Evidence, the Run ledger, or the Judgment Dossier. Raw tactical traces remain ephemeral or separately referenced according to retention policy. Later Dispatches consume Episodes by reference rather than copying full Worker context.

Execution-graph nodes represent variable semantic work, dependencies, Worker bindings, and evidence obligations. Fixed lifecycle gates belong only to the controller state machine. Searches, commands, test runs, and tactical delegations remain Episodes within a node unless they independently affect authority, dependency structure, review Independence, or completion evidence.

## Execution Semantics

The Workflow Contract, execution graph, controller state machine, and Pi actors are distinct execution layers:

- The **Workflow Contract** defines the Run's quality, authority, safety, evidence, and retention envelope.
- The **execution graph** represents the current organization of variable semantic work: nodes, dependencies, evidence obligations, Worker bindings, and optional paths.
- The **controller state machine** owns the fixed lifecycle, legal transitions, graph revision, Dispatch, cancellation, reconciliation, and closure.
- The **Pi actors** are addressable Coordinator, Worker, and Subagent profiles with explicit identities, roles, permissions, scopes, and lifecycles.

Pi actors communicate through controller-routed Dispatches, typed Episode returns, and referenced artifacts. They do not share conversational context or mutate authoritative Run state directly.

Dispatches and Episodes carry actor, causation, graph revision, and evidence references. The controller supervises actor creation, completion, cancellation, failure, replacement, and unknown outcomes.

Graph evolution is explicit and revisioned. A Coordinator may request or perform an authorized mutation, but the controller accepts or rejects it against the current graph revision and quality and authority envelope. Accepted revisions supersede earlier graph revisions without rewriting their history.

The architecture uses actor-model semantics without requiring a particular actor framework.

## Model Routing

Models and Model Effort are selected independently by Cognitive Role, task shape, context needs, Continuity, Independence, and available capacity. The workflow does not treat one model or effort level as globally strongest.

A stronger model does not justify a broader Model Context. A longer-lived session is used only when its semantic Continuity is valuable. Routing effectiveness is evaluated from Run outcomes rather than fixed social heuristics.

For V1, the router may resolve bindings for the interactive lead and bounded ephemeral children by Cognitive Role without changing the attended posture.

A future managed Run would additionally validate resolved bindings against its Workflow Contract, Work Packet, authority, budget, and repository policy.

## Agent Deliberation

The Coordinator can Dispatch a specialist to question or challenge a claim, then Dispatch a response that references the challenge. These claim, challenge, and response Episodes are durable and evidence-linked.

The initial implementation does not provide peer mailboxes or open-ended Worker conversations. One Coordinator remains accountable for synthesis and the human-facing result.

## Execution Observations

Pi Execution emits structured lifecycle, tool-activity, usage, cancellation, and completion observations to the Run Controller. These observations are evidence for reconciliation. They are not canonical client events or independently authoritative Run state.

The controller accepts a result only through the expected Episode schema and exposes current state through its own snapshot and event interface.
