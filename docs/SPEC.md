# Pi Project Workbench — Evolving Specification

Status: evolving specification. The V1 lifecycle, core module interfaces, durable storage shape, and terminal concepts are established; exact schema fields and implementation details remain to be validated through the pilot.

Canonical domain language is defined in [CONTEXT.md](CONTEXT.md).

## Problem Statement

Development work is distributed across agent conversations, IntelliJ, terminals, worktrees, repository files, GitHub, Linear, Sentry, CI, generated review pages, and project-specific scripts. Each repository and task needs a different balance of exploration, judgment, autonomy, verification, review, and external collaboration. External project-management tools are useful collaboration surfaces but are a poor execution state machine for local agent work.

Human Attention is scarce and loses value when people must continuously supervise routine work or reconstruct intent, decisions, evidence, and consequences from scattered artifacts. Model Context and Model Effort are also constrained: loading broad histories into every agent, using one model for every Cognitive Role, or preserving continuity where independent judgment is needed makes execution slower, less focused, and harder to evaluate.

Long-running agent work also creates substantial temporary state. Without explicit promotion and cleanup rules, ledgers, handoffs, traces, generated artifacts, cached research, and obsolete plans become stale context that harms both people and agents.

## Solution

Provide a Pi-based project workbench that allocates human and model attention across a durable Run. It establishes Shared Understanding before autonomous work, routes bounded Dispatches by Cognitive Role, Model Effort, Continuity, and Independence, requests In-Run Judgment when it can materially improve the outcome, and supports Acceptance through a task-shaped Review Surface.

The workbench has a stable trusted shell and one versioned adaptive Workflow Contract. Pi is the only model-worker runtime. A durable local run ledger drives execution. Terminal and graphical clients consume the same run protocol and render interactions appropriate to their capabilities. External systems are connected through explicit import and Publication steps.

The initial workflow defines its quality and authority envelope, capabilities, tools, model roles, permissions, surfaces, external synchronization, evidence requirements, and retention lifecycle. A fixed deterministic controller lifecycle surrounds a revisable graph of variable semantic work. A Pi coordinator organizes that work inside the envelope, while the controller alone advances lifecycle state and performs side effects. The implementation loop is a bounded execution capability; the primary human value is reviewable Judgment before autonomous work, selectively during it, and when evaluating the realized outcome.

## High-Level Product Shape

- Pi is the only agent runtime and can use different models for different cognitive roles.
- Attention Allocation matches human judgment moments and model capability, effort, context, continuity, and independence to the repository and task.
- The controller advances one fixed lifecycle; the model dynamically organizes only the variable semantic work inside it.
- Stable guardrails preserve human authority, workspace isolation, durable state, evidence, explicit external actions, and recovery.
- The coordinator organizes evidence-linked claim, challenge, and response episodes into one accountable synthesis.
- One Judgment Dossier makes the important reasoning reviewable before implementation and reconciles it with the realized system afterward.
- Every Dispatch receives the smallest self-contained Model Context justified by its Cognitive Role; Episodes carry useful results across context boundaries without copying full tactical histories.
- Implementation and verification are adaptable execution capabilities rather than a universal sequence of ceremonies.
- Human Attention is concentrated in two Principal Judgments and requested during execution only when an In-Run Judgment has material value.
- Review Surfaces assemble the realized outcome, relevant context, Primary Evidence, and target-anchored actions in the format appropriate to the human judgment.
- Every run analyzes its outcome and orchestration, compounds validated learning, and cleans up disposable state.
- One cloneable harness repository supplies the shared Pi capabilities and curated skills; target repositories add project-specific overlays.
- Skills are portable agent capabilities that may progressively add richer project- and task-appropriate interfaces through harness-owned APIs.
- Skills resolve from a portable upstream core through stack and repository adaptations, so the same capability fits each codebase without losing provenance.
- A Pi agent can generate an integrated harness surface for a skill using the same semantic Surface Builder pattern proven by Atelier.
- Skill surfaces can change during a run as the task, evidence, decisions, and repository context evolve.
- Mechanical status, validation, configuration health, and routine supervision consume no model turn.

Exact schema fields, routing bindings, retention values, and graphical interaction contracts remain intentionally unspecified until exercised by the pilot.

## Product Principles

1. Repository and task context shape Attention Allocation and the semantic work graph.
2. Working state, collaboration state, and durable project knowledge are distinct.
3. Model Context is disposable; Run state is resumable.
4. External side effects are explicit and idempotent.
5. The GUI adds interaction bandwidth without owning workflow semantics.
6. Terminal clients always have a structured fallback.
7. Human Attention is spent according to judgment leverage, operational impact, and recovery cost rather than routine workflow activity.
8. Generated state has an expiry or promotion path.
9. Trust-sensitive controls remain outside agent-generated surfaces.
10. Parallelism is bounded by dependencies, isolation, and review capacity.
11. Every run analyzes its outcome and execution, then compounds validated lessons without promoting raw agent output as knowledge.
12. Model capability, Model Effort, Continuity, and Independence are assigned by Cognitive Role and measured rather than assumed.
13. The controller owns the fixed lifecycle; the model chooses and revises the semantic work graph inside it.
14. Judgment is preserved as source-backed artifacts; implementation is evaluated against those artifacts.
15. Deliberation is represented by durable, evidence-linked episodes and one accountable synthesis.
16. The coordinator reasons about project work but never mutates a project directly.
17. Immutable events record facts; only the deterministic controller reducer defines current run state.
18. Routine execution activity remains observable without consuming model attention.
19. Every dispatch has a self-contained input contract and every result has a mechanically validated typed episode contract.
20. Fixed lifecycle gates exist only in the controller state machine rather than being duplicated as execution-graph nodes.
21. Each Pi actor receives only the context justified by its bounded work; durable references carry forward results instead of full conversation histories.
22. Human Attention brackets autonomous work and enters it conditionally when an In-Run Judgment can materially improve the outcome.
23. Acceptance is supported by a task-shaped Review Surface that joins intent, realized behavior, Primary Evidence, deviations, risks, feedback, and available actions.

## Actors

- Developer using Pi in a terminal.
- Developer using the graphical workbench.
- Non-terminal collaborator reviewing artifacts and making bounded decisions.
- Workflow owner maintaining the initial workflow contract.
- Deterministic controller validating transitions, reducing current state, dispatching Pi executions, and owning workspace and supervision leases.
- Pi coordinator interpreting owner intent, organizing work, selecting bounded dispatches, and synthesizing results without mutating target projects.
- Pi worker performing planning, implementation, research, review, verification, run analysis, or compounding with a role-specific model.
- External system adapter connecting GitHub, Linear, Sentry, CI, IntelliJ, and similar systems.

## System Architecture

### Harness Distribution Repository

The harness is one cloneable Git repository containing the shared Pi package, orchestration capabilities, curated skills and bundled resources, prompts, adapters, configuration, provenance, and environment checks. Shared skills are usable without depending on a separate personal dotfiles setup.

External executables and services are represented as versioned capabilities with supported installation and health checks. Credentials, subscription state, and machine-specific configuration remain local. Target repositories contribute overlays for project-specific knowledge, commands, safety policy, and verification.

### Skill Capability and Interface Layer

Skills remain self-contained agent capabilities with concise instructions and bundled scripts, references, and assets. The harness gives them common ways to expose progress, decisions, artifacts, inputs, outputs, and relevant actions without requiring each skill to build a separate application.

The resolved skill set is declared per dispatch and loaded only into that Pi execution context. Each resulting episode records the exact skill and adaptation versions that influenced it. Skill instructions leave active context when the episode ends unless a later dispatch resolves them again.

Every skill has a complete headless and terminal path. Skills with meaningful human interaction may contribute enhanced interface definitions or sandboxed views as progressive enhancements. Those views project the same durable run state and cannot control identity, permissions, recovery, or workflow transitions independently.

Skills improve through evidence from real runs: observed friction, failed handoffs, weak judgment artifacts, missing tools, and repeated manual steps become evaluated skill or interface candidates rather than automatic standing context.

### Repository-Adapted Skills

When a skill is added, the agent separates its portable purpose and reasoning from assumptions about a particular language, framework, toolchain, or repository. It resolves the skill for the target repository using detected project evidence such as its stack, available commands, conventions, safety policy, and verification practices. A TypeScript-oriented skill can therefore retain its useful workflow while gaining JVM, Spring, Kotlin, browser, or project-specific behavior where appropriate.

The vendored source retains its provenance. Reusable stack adaptations can be shared by several repositories, repository knowledge remains with the project, and temporary refinements can remain local to a run. Real repository tasks provide the evidence for promoting an adaptation to a broader scope.

### Agent-Generated Skill Surfaces

When a skill is added or improved, a Pi worker can derive a focused interface from the skill's purpose, workflow, decisions, artifacts, progress, inputs, outputs, and human actions. A dedicated Surface Builder translates that semantic brief into a native harness experience while the coordinating agent retains task reasoning.

The generated surface is integrated into the harness UI and remains flexible during execution. The coordinating agent sends semantic changes to the Surface Builder as new artifacts, decisions, and interaction needs emerge. The surface remains a projection over the skill and durable run state, retains a headless path, and can be evaluated and promoted with the skill after real usage.

### Repository Package

The repository package is versioned with the project and declares:

- The adaptive workflow contract and quality envelope.
- Required capabilities and safety gates.
- Skills, tools, hooks, validation commands, and model roles.
- A finite set of named execution profiles resolving model requirements, effort, continuity, permissions, workspace kind, skills, independence, and episode schema.
- Work-packet requirements, attempt ladders, attention thresholds, and allowed non-material graph mutations.
- Permission and AFK autonomy limits.
- External adapters and publication mappings.
- Supported project surfaces and terminal fallbacks.
- Artifact classes, retention periods, promotion gates, and cleanup rules.

PhotoQuest and embabel-me use the same controller lifecycle and record schemas. Their packages vary finite policy fields such as judgment depth, required challenge and independent-review profiles, evidence classes, verification commands, risk and impact ceilings, execution profiles, fallback equivalences, retry bounds, and retention rules. A repository package cannot remove invariant authority, independent verification, acceptance, publication, analysis, promotion review, or cleanup obligations.

### Run Controller Module

The Run Controller is the primary deep module. Terminal and graphical clients cross one interface:

```text
start(StartRun) -> RunSnapshot
submit(RunCommand) -> CommandReceipt
inspect(RunId) -> RunSnapshot
watch(RunId, afterSequence) -> EventBatch
```

Its implementation owns lifecycle reduction, graph validation, command idempotency, attention, dispatch, reconciliation, retention eligibility, and external-action coordination. Clients do not reproduce those semantics.

### Durable Run Ledger

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

Terminal summaries, attention inboxes, notifications, AFK digests, and later graphical clients consume the same `RunSnapshot` and attention records. They do not independently infer state from raw event prose. Large tool results and media are stored as referenced, content-addressed artifacts.

### Repository Workspace Module

The controller owns project mutation through one workspace interface:

```text
lease(WorkspaceRequest) -> WorkspaceLease
inspect(WorkspaceLease) -> WorkspaceState
land(LandingRequest) -> LandingReceipt
release(WorkspaceLease, ReleaseAuthority) -> ReleaseReceipt
```

The implementation performs Git and filesystem operations deterministically. Models may recommend workspace actions but never act as pass-through executors for exact controller commands. Landing is serialized per delivery target. Dirty, unlanded, unattributed, or evidence-incomplete workspaces remain leased until confirmed delivery or explicit owner-authorized discard.

### Artifact Store Module

The Artifact Store persists immutable content-addressed objects through one interface:

```text
put(bytes, metadata) -> ArtifactRef
get(ArtifactRef) -> bytes
pin(ArtifactRef, reason) -> PinReceipt
```

Metadata records schema, producer, dispatch, model, skill versions, confidentiality class, provenance, retention class, and invalidation scope. Protected references participate in cleanup marking.

### Pi Worker Runtime

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

The controller assembles the smallest sufficient Model Context for each dispatch from its Work Packet, resolved skills, referenced Episodes, and relevant Primary Evidence. Full coordinator history, unrelated worker transcripts, stale tool output, and standing skill instructions do not enter a dispatch merely because they exist. A Worker preserves Continuity only where repeated work in one semantic scope benefits from it; a Subagent receives a fresh context where narrow focus or Independence is more valuable.

Every `DispatchSpec` contains a self-contained work packet with the semantic objective and graph node, repository and input revisions, authority shape, named execution profile, allowed workspace and capabilities, source-backed contracts, relevant evidence, acceptance criteria, material risks, verification obligations, explicit exclusions, episode schema, and size budget. Repository packages may constrain packet size or file scope; the workflow does not impose universal file-count or changed-line limits.

Every dispatch also declares one authority shape orthogonal to its execution profile:

- **Scout:** investigates, plans, audits, reproduces, or prototypes within read-only or disposable scratch scope and returns a self-contained report and evidence. It cannot publish project changes or authorize implementation.
- **Ship:** may mutate an isolated project workspace inside the approved impact, publication, permission, and quality envelope and must return mutation and delivery evidence.

A scout conclusion or recommendation is evidence, not implementation authority. When implementation is separately authorized, the controller promotes the existing work item and evidence lineage to a ship dispatch instead of creating duplicate work. Scratch state is inventoried, only intended changes cross the authority seam, and any reproduction becomes reusable verification where applicable.

### Episode Return Interface

An episode is the compact, provenance-bearing result of one bounded execution action. It records:

- Dispatch, execution-graph node, actor, model, and resolved skill references.
- Objective, inputs, action scope, and outcome.
- Verified and unverified claims with primary-evidence references.
- Decisions, questions, authority needs, deviations, and residual risks.
- Repository mutations and produced artifact references.
- Continuation reference and the context justified for later reuse.

An episode is not authoritative truth and does not replace primary evidence, the run ledger, or the Judgment Dossier. Raw tactical traces remain ephemeral or separately referenced according to retention policy. Later dispatches consume episodes by reference rather than copying full worker context.

Execution-graph nodes represent variable semantic work, dependencies, worker bindings, and evidence obligations. Fixed lifecycle gates belong only to the controller state machine. Searches, commands, test runs, and tactical delegations remain episodes within a node unless they independently affect authority, dependency structure, review independence, or completion evidence.

### Execution Semantics

The workflow contract, execution graph, controller state machine, and Pi actors are distinct execution layers:

- The **workflow contract** defines the run's quality, authority, safety, evidence, and retention envelope.
- The **execution graph** represents the current organization of variable semantic work: nodes, dependencies, evidence obligations, worker bindings, and optional paths.
- The **controller state machine** owns the fixed lifecycle, legal transitions, graph revision, dispatch, cancellation, reconciliation, and closure.
- The **Pi actors** are addressable coordinator, worker, and subagent profiles with explicit identities, roles, permissions, scopes, and lifecycles.

Pi actors communicate through controller-routed dispatches, typed episode returns, and referenced artifacts rather than shared conversational context or direct mutation of authoritative run state. Dispatches and episodes carry actor, causation, graph revision, and evidence references. The controller supervises actor creation, completion, cancellation, failure, replacement, and unknown outcomes.

Graph evolution is explicit and revisioned. A coordinator may request or perform an authorized mutation, but the controller accepts or rejects it against the current graph revision and quality and authority envelope. Accepted revisions supersede earlier graph revisions without rewriting their history. The architecture uses actor-model semantics without requiring a particular actor framework.

### Model Routing

Models and Model Effort are selected independently by Cognitive Role, task shape, context needs, Continuity, Independence, and available capacity rather than treating one model or effort level as globally strongest. A stronger model does not justify a broader Model Context, and a longer-lived session is used only when its semantic Continuity is valuable. Routing effectiveness is evaluated from run outcomes instead of being fixed from social heuristics.

### Agent Deliberation

The coordinator can dispatch a specialist to question or challenge a claim and dispatch a response that references the challenge. These claim, challenge, and response episodes are durable and evidence-linked. The initial implementation does not provide peer mailboxes or open-ended worker conversations; one coordinator remains accountable for synthesis and the human-facing result.

### Judgment Dossier

Each run maintains one versioned Judgment Dossier as the authoritative reasoning artifact. Before implementation it records the Shared Understanding: problem and system model, language, evidence, options, trade-offs, assumptions, risks, chosen direction, and success evidence. After implementation it explains the realized system, supporting evidence, deviations, consequences, residual risks, and learning candidates. Review Surfaces project the dossier and its evidence for a particular human judgment without duplicating ownership.

### Event and Stream Interface

The runtime emits structured events for:

- Lifecycle, execution-graph, and work-node progress.
- Proposed, accepted, rejected, and superseded graph mutations.
- Worker creation, completion, failure, and cancellation.
- Dispatch creation, episode return, continuation, and rejection.
- Tool activity summaries.
- Questions, approvals, and permission requests.
- Produced artifacts and verification evidence.
- External imports and publications.
- Staleness, reconciliation, and cleanup transitions.
- Run-analysis results, learning candidates, promotion decisions, and invalidation triggers.

Clients reconnect to a run by identifier and resume from its canonical snapshot. Reducer-defined events after the snapshot advance that projection; clients may display the event history but do not assign it independent current-state semantics.

### Schema Registry

One versioned registry defines commands, command receipts, semantic records, snapshots, dispatches, episodes, attention items, dossier revisions, and external receipts. Every type declares its required envelope and values, producer and consumers, authority and acceptable evidence sources, payload requirements, size and retention budgets, compatibility behavior, and invalidation semantics.

`pi-workbench validate` checks repository packages, resolved profiles, graphs, records, evidence references, leases, and environment readiness mechanically. Unknown types, incompatible schema versions, invalid references, or authority-shape violations fail closed.

### Control, Attention, and Supervision

Exactly one controlling client holds the run's live control lease and may request mutating transitions. Other connected clients remain read-only until an explicit ownership transfer grants them control. The controller remains the sole run-state writer and Pi dispatcher regardless of which client owns the lease.

While any dispatch is in flight, one healthy controller supervision loop owns reconciliation. It consumes structured Pi lifecycle events, execution observations, timers, external adapter results, and authority changes. Routine progress, duplicates, and unchanged observations remain recorded or coalesced without waking a model. The controller creates attention only for an actionable condition such as:

- Missing or exceeded authority.
- A terminal result requiring synthesis, review, acceptance, or publication.
- Failure, cancellation, staleness, conflicting evidence, or unknown execution state.
- A material graph, quality, budget, workspace, or external-system conflict.
- A bounded external wait whose recheck condition has matured.

An `AttentionItem` identifies its run and graph revision, source event, category, urgency, affected work, reconciled current state, required action, evidence references, and deduplication key. The item is persisted before the controller acknowledges the source event, so coordinator-session replacement cannot silently lose actionable work. Coordinator and owner notifications are projections of pending attention rather than raw runtime signals.

Each named execution profile declares a finite attempt ladder. Failed independent review returns typed findings to the next authorized attempt. The controller pauses affected work and creates one deduplicated attention item when an attempt ladder or review-failure threshold is exhausted, a workspace becomes contaminated or unattributable, an input or approval becomes stale, an execution or external action has unknown outcome, or budget or authority is exhausted. Replanning occurs through a revisioned graph mutation rather than unbounded retry.

The supervision loop is owned by the live controller host and does not require a model session to remain active. Loss of the coordinator session triggers bounded Pi-session replacement or a persisted attention item. Controller-process exit, terminal-induced exit, reboot, and machine loss remain outside the V1 durability scope.

### Stable Workbench Shell

The shell owns:

- Repository, workspace, worktree, and run navigation.
- User, agent, and model identity.
- Authentication, authorization, and permission controls.
- Start, pause, resume, steer, stop, retry, and handoff controls.
- Notifications and pending-decision inbox.
- Recovery, reconciliation, and cleanup entry points.
- Hosting and isolation of bounded project surfaces.

### Project Surfaces

A Review Surface is the task-shaped human judgment interface over the current Run. It selects the relevant altitude and medium for the decision—such as a concise evidence summary, diff, rendered behavior, recording, prototype, architecture view, or operational result—and lets feedback attach to the exact outcome, claim, evidence, or behavior it addresses.

Repositories and workflows may provide:

- Declarative dashboards, forms, decision boards, timelines, dependency maps, and review views from a trusted interaction catalog.
- Sandboxed application views for complex experiences such as Atelier.
- Artifact viewers for diffs, tests, screenshots, recordings, reports, and prototypes.
- Structured terminal summaries and commands for every required workflow interaction.
- Agent-generated native skill surfaces using the harness's integrated Surface Builder capability.

Project surfaces cannot alter shell-owned permission, identity, or recovery controls.

### Initial Terminal Surface

The first pilot is operated through six terminal concepts:

```text
pi-workbench run
pi-workbench status
pi-workbench decide <attention-id>
pi-workbench control pause|resume|stop
pi-workbench validate
pi-workbench close
```

- `run` starts or attaches to a run.
- `status` renders the canonical snapshot, execution graph, active owner, progress, evidence references, and pending attention without a model turn.
- `decide` handles approval, rejection, response, acceptance, promotion, discard, and publication authorization according to the referenced attention-item schema.
- `control` changes live execution control without creating a new run.
- `validate` mechanically checks the resolved run contract and environment.
- `close` analyzes the run, gathers learning-candidate dispositions, seals retained evidence, previews cleanup, and performs owner-authorized collection.

The internal commands remain explicit, typed, revision-checked, and idempotent even when several decisions share the `decide` entry point. The terminal also exposes a structured event stream and durable artifacts using the same interface that later clients project.

The terminal is a projection and control surface over the durable run ledger; it does not own a separate workflow state machine. No graphical client is required for the initial pilot.

### External Adapters

Adapters read and write collaboration-relevant subsets of external systems. Every write is an explicit workflow action with an idempotency key, source run, actor, target version, and recorded result. External changes are imported as events and reconciled before they influence local execution.

## Initial Adaptive Workflow Contract

The initial implementation executes one versioned **adaptive feature-delivery** contract. The owner starts it explicitly. The contract declares required and optional capabilities instead of embedding machine-local paths, credentials, or assumptions. Pi validates the contract, shows its quality envelope and capabilities to the owner, and records its content hash before execution.

The contract accepts repository, task, risk, environment, and owner inputs, but the initial implementation does not select, compose, inherit, or resolve multiple workflow contracts.

### Quality and Authority Envelope

- Shared Understanding of the desired outcome, constraints, language, acceptance criteria, unresolved Material Questions, operational impact, and success evidence is explicit before autonomous mutation.
- Material judgment is ratified in a versioned dossier before implementation and reconciled against the realized system after implementation.
- The owner approves an autonomy envelope covering permissions, impact ceiling, budget, stopping conditions, and publication authority. Missing authority durably pauses the run.
- The controller is the sole writer of run state and the sole dispatcher of workers and subagents.
- The coordinator has no mutating project-workspace capability. Every deliverable repository mutation is attributable to a controller-approved ship dispatch; scout scratch mutations remain disposable evidence until explicitly promoted.
- Every mutating worker holds an exclusive workspace lease; independent reviewers use isolated or read-only scopes.
- Material implementation is checked by a worker that did not author it. The risk policy determines required review independence, lenses, and evidence depth.
- Completion claims map acceptance criteria and material risks to primary evidence. Model confidence alone cannot satisfy a requirement.
- Material deviations and authority expansion require owner approval. Non-material graph changes inside the envelope are recorded with rationale.
- External publication and production-impacting actions are explicit, idempotent, and owner-authorized.
- Run analysis, compounding, promotion review, evidence sealing, and cleanup occur before closure.

### Human-Attention Contract

The normal feature-delivery Run allocates Human Attention across two Principal Judgments and conditional In-Run Judgment:

1. **Before autonomous work:** establish Shared Understanding and approve the pre-implementation Judgment Dossier and Autonomy Envelope.
2. **During autonomous work:** request In-Run Judgment when a Material Question, evolving prototype, direct human experience, or proposed change outside the approved envelope can materially improve or redirect the outcome.
3. **After autonomous work:** present the realized outcome through a task-shaped Review Surface and ask the owner for Acceptance. The same action may explicitly authorize pull-request Publication while Acceptance and Publication remain separate durable transitions.

The Review Surface assembles the intended outcome, realized behavior, Primary Evidence, independent findings, deviations, consequences, residual risks, and precise feedback actions in the format appropriate to the judgment. Additional attention is created only for material ambiguity, missing authority, a graph revision outside the allowlist, failure, staleness, unknown outcomes, external conflicts, or required learning-candidate disposition. Routine progress and bounded retries remain visible without consuming a coordinator or owner turn.

### Fixed Controller Lifecycle

The controller advances every run through one fixed lifecycle:

`intake → judgment → authority → execution → verification → acceptance → publication → close`

- `intake` resolves the task, repository package, revisions, owner, and risk.
- `judgment` produces and ratifies the pre-implementation Judgment Dossier revision.
- `authority` records the approved autonomy, impact, budget, and publication envelope.
- `execution` runs authorized ship work in leased isolated workspaces.
- `verification` obtains evidence from an independent execution profile.
- `acceptance` presents criteria, evidence, deviations, and residual risks.
- `publication` performs an explicitly authorized idempotent external action.
- `close` analyzes the run, disposes learning candidates, seals evidence, and performs approved cleanup.

These states and their entry and exit predicates belong only to the controller state machine.

### Semantic Execution Graph

The Pi coordinator organizes variable semantic work from the current outcome, repository policy, risk, and evidence. It may revise that organization as new evidence arrives. The controller enforces quality, authority, safety, budget, isolation, independence, and evidence constraints without prescribing the semantic work sequence. Tactical actions and context synchronization are captured as episodes within graph nodes rather than as graph structure.

Investigation, deliberation, prototyping, design, implementation slices, remediation, and independent review are available graph-node patterns rather than universal ordered phases. Fixed lifecycle gates are not graph nodes. The coordinator selects only the semantic work justified by the task and may revisit its plan as new evidence arrives.

The real pilot and its controlled drills together exercise the product's defining seams:

- Durable local run state across fresh agent contexts.
- One active human owner with interactive and AFK control.
- At least one role-specific model worker.
- A scout investigation followed by explicit promotion of the same work item to ship authority.
- Linked claim, challenge, and response episodes when a real material judgment emerges, or through a bounded fixture otherwise.
- Ratified pre-implementation and post-implementation judgment snapshots.
- Terminal control plus a structured event stream suitable for later clients.
- A bounded terminal review summary and structured review artifact.
- Explicit external publication.
- Source-backed run analysis and compounding candidates.
- Promotion and cleanup at run closure.

## Pilot Boundary

The first real run targets PhotoQuest in an isolated worktree. The pilot task must be reversible, low impact, and independently verifiable through PhotoQuest's repository-native checks. The run may open or update a pull request after owner approval but does not deploy to production.

The pilot uses PhotoQuest's existing instructions, skills, hooks, tests, IntelliJ integration, browser tooling, and evidence conventions as workflow inputs. Those repository capabilities remain owned by PhotoQuest rather than being reimplemented in the workbench.

The pilot implements PhotoQuest plan 020, landing-page scroll-depth tracking. A scout dispatch checks the plan's assumptions and drift anchors against the current repository revision and returns a self-contained evidence report. The coordinator proposes the execution graph and presents its autonomy envelope and material decisions. After owner approval, the controller promotes that same work item and evidence lineage to ship authority before any mutation begins.

## Interactive and AFK Modes

Interactive mode streams detailed progress, opens relevant surfaces, and asks questions inline. AFK mode advances only through pre-authorized transitions, persists all decisions and evidence, pauses durably when authority is missing, and sends notifications. Switching mode does not create a new run.

## Team Collaboration

All team members use the same repository package and workflow protocol. Terminal and graphical users may see different projections. Non-terminal collaborators interact through bounded artifacts and decisions rather than agent commands.

Each run has exactly one active human owner or controlling client. The owner may orchestrate multiple Pi workers using different models. Ownership transfers explicitly through a portable, schema-validated handoff snapshot containing creator metadata, task and workflow versions, current state, pending decisions, artifact references, and external synchronization watermarks.

Pi collaboration services and cloud execution may connect to the same run and event protocol. They preserve the single-owner authority rule unless a future protocol explicitly introduces coordinated ownership.

## State and Knowledge Lifecycle

State belongs to one of these classes:

- **Ephemeral execution data:** prompts, raw tool outputs, live logs, and temporary files.
- **Durable run state:** canonical snapshot, append-only semantic records, decisions, approvals, attention, and evidence pointers.
- **Reviewable artifacts:** plans, diffs, reports, screenshots, recordings, and prototypes.
- **Durable project knowledge:** validated rules, skills, tests, hooks, ADRs, domain terms, and current source-backed guidance.

Knowledge candidates move through:

`ephemeral → candidate → active → retired → purged`

Run storage moves through:

`active → completed → promotion review → sealed → cleanup eligible → collected`

Cleanup performs a mark phase over active runs, pinned evidence, promoted knowledge, external references, and policy holds. Rebuildable caches and unreferenced scratch artifacts receive aggressive expiry. Raw traces have repository-defined debugging or compliance windows. A completed run cannot be collected until required decisions and reusable knowledge have been promoted or explicitly rejected.

Workspace release is separately fail-closed. A ship workspace remains leased while it is dirty, unlanded, missing required evidence, or otherwise not cleanup-eligible. Release requires confirmed delivery or explicit owner-authorized discard. A scout scratch workspace requires a sealed self-contained report, resolved completion obligations, and preservation of referenced evidence before it can be released.

## Staleness and Reconciliation

Before resuming or dispatching work, the runtime compares:

- Repository and worktree revision.
- Task source revision and external object version.
- Referenced specification and dependency versions.
- Workflow package, tool, and model versions.
- Input artifact hashes.
- Pending approval validity.
- Validation evidence and its invalidation scope.

Changed inputs move the run to an explicit reconciliation state. The runtime does not silently continue from stale assumptions.

## Run Analysis and Compounding

Every completed, stopped, or failed run produces a structured analysis from the durable event graph and referenced evidence. The analysis separates:

- **Outcome quality:** acceptance-criterion coverage, behavioral evidence, unresolved risk, review findings, and escaped defects when known.
- **Orchestration quality:** lifecycle and node duration, gate waiting time, retries, rework, delegation depth, worker and model outcomes, context pressure, budget use, tool failures, cancellation behavior, review yield, deliberation quality, and evidence completeness.
- **Routing efficiency:** cache reads and writes, session reuse, quota pressure, latency, model escalation, and quality outcomes by cognitive role.

A dedicated fresh-context Pi compounder reviews the analysis together with decisions, corrections, deviations, findings, and primary evidence. It emits typed candidates for project knowledge or workflow improvement. Every candidate declares its proposed destination and scope, provenance, supporting evidence, applicability, validation method, invalidation trigger, and relationship to existing knowledge.

Raw transcripts, model self-assessments, and unverified summaries remain evidence inputs rather than active knowledge. Candidate promotion and rejection are explicit ledger transitions. Rejected and superseded candidates follow the repository retention policy instead of remaining in standing context.

## User Stories

1. As a run owner, I want to start one explicit workflow, so that its behavior is understandable and reproducible.
2. As a terminal user, I want to operate the same run as GUI users, so that the workflow is not tied to one interface.
3. As a GUI user, I want a focused review surface, so that I can judge the workflow's output efficiently.
4. As a developer, I want local working state to survive agent context resets, so that the run remains resumable.
5. As a developer, I want external updates to be explicit, so that collaboration systems do not accidentally advance execution.
6. As an interactive operator, I want detailed progress and inline decisions, so that I can steer actively.
7. As an AFK operator, I want bounded autonomy and durable pauses, so that unattended work never invents missing authority.
8. As a reviewer, I want evidence assembled around the current decision, so that I can judge behavior rather than reconstruct the run.
9. As a workflow owner, I want role-specific models and permissions, so that workers receive only the capabilities they need.
10. As a developer, I want stale inputs detected before resumption, so that the agent does not continue from invalid assumptions.
11. As a developer, I want a portable handoff snapshot, so that another machine or teammate can resume the work deliberately.
12. As a repository owner, I want retention rules for workflow artifacts, so that useful evidence survives without keeping every trace.
13. As a repository owner, I want promotion gates for reusable knowledge, so that generated garbage does not become standing context.
14. As an auditor, I want provenance and hashes for retained artifacts, so that claims can be traced to their sources.
15. As a developer, I want cleanup previews and protected pins, so that automatic collection cannot remove required evidence.
16. As a workflow owner, I want each run analyzed from structured events and evidence, so that orchestration failures and wasted effort become visible.
17. As a repository owner, I want validated lessons proposed at the narrowest useful scope, so that the system improves without polluting standing context.
18. As a workflow owner, I want model routing evaluated by role-level quality and resource evidence, so that social heuristics do not become permanent policy without validation.
19. As a run owner, I want the model to construct and revise the work graph inside explicit quality and authority constraints, so that simple tasks remain simple and difficult tasks receive appropriate rigor.
20. As a decision maker, I want Shared Understanding of the problem, language, assumptions, options, disagreements, trade-offs, and success evidence before implementation, so that coding does not prematurely settle the design.
21. As a reviewer, I want the realized system, evidence, deviations, and residual risks assembled in a task-shaped Review Surface with precise feedback actions, so that I can judge consequences rather than reconstruct the run or only inspect a diff.
22. As an agent coordinator, I want specialists to produce linked claim, challenge, and response episodes, so that synthesis benefits from genuine disagreement without relying on hidden transcripts or peer mailboxes.
23. As a developer, I want to clone one harness repository and obtain its supported Pi skills and tool capabilities, so that the workflow does not depend on reconstructing a personal setup.
24. As a skill author, I want a stable harness interface for progress, decisions, artifacts, and user input, so that a skill can provide a focused experience without becoming tied to one client.
25. As a terminal user, I want every enhanced skill to retain a complete headless path, so that richer interfaces never become a prerequisite for using the workflow.
26. As a skill user, I want the agent to generate a focused native interface when I add a skill, so that the skill becomes understandable and interactive without manual frontend development.
27. As a skill author, I want successful generated surfaces to graduate with the skill, so that other users receive the proven interaction model when they clone the harness.
28. As a developer, I want an imported skill adapted to my repository's stack, tools, conventions, and verification practices, so that its workflow is useful without carrying irrelevant assumptions from its source project.
29. As a skill maintainer, I want repository adaptations to preserve upstream provenance and reusable behavior, so that project customization does not create opaque, unmaintainable forks.
30. As a run owner, I want investigations to be unable to become implementations without separate authority, so that a recommendation never silently expands into project mutation.
31. As an AFK operator, I want routine progress classified without a model turn and actionable conditions durably queued, so that unattended supervision is efficient without losing decisions or failures.
32. As a client developer, I want one canonical current-state snapshot, so that terminal and graphical views cannot disagree by interpreting event history differently.
33. As a repository owner, I want project work to remain leased until its delivery, report, evidence, or explicit discard obligation is satisfied, so that cleanup cannot erase unresolved work.
34. As a worker, I want one self-contained work packet and typed episode contract, so that execution does not depend on hidden conversation context.
35. As an operator, I want mechanical status, validation, and environment checks, so that routine inspection consumes no model attention.
36. As a workflow maintainer, I want fixed lifecycle gates represented once, so that the controller state machine and semantic work graph cannot disagree about authority or closure.
37. As a run owner, I want repeated failure to become one durable attention item, so that autonomous execution stops instead of retrying a false premise indefinitely.

## Implementation Decisions

- Pi is the workflow harness and exposes a durable run protocol to clients.
- Every model-backed role runs through Pi; model choice is a field of the Pi worker specification rather than a separate harness.
- Coordinator, worker, and subagent profiles use one parameterized Pi execution primitive and the same dispatch, episode, artifact, permission, budget, cancellation, and workspace-lease vocabulary.
- Coordinator, worker, and subagent describe execution continuity; scout and ship independently describe authority and expected outcome.
- The coordinator never receives a project-workspace write lease. Every deliverable mutation is performed by a controller-approved ship dispatch in an isolated workspace; scout scratch mutations cannot be delivered directly.
- The initial repository package exposes a finite set of named execution profiles, and the controller validates every resolved dispatch field.
- Every bounded dispatch returns a typed episode that preserves provenance and primary-evidence references without promoting its summary to authoritative truth.
- Every dispatch receives the smallest sufficient Model Context assembled from its Work Packet, resolved skills, referenced Episodes, and relevant Primary Evidence; unrelated histories and stale tool output remain outside it.
- The controller owns the fixed `intake → judgment → authority → execution → verification → acceptance → publication → close` lifecycle.
- Execution-graph nodes represent only variable semantic work, dependencies, worker bindings, and evidence obligations; fixed lifecycle gates are not graph nodes.
- Tactical work and context synchronization are recorded as episodes within their owning node.
- Every dispatch receives a self-contained work packet with source-backed inputs, authority, scope, risks, evidence obligations, and an expected episode schema.
- Workflows declare cognitive roles, required capabilities, effort, continuity, and independence; repository policy resolves or pins the concrete Pi model.
- Cache affinity never controls workflow correctness or resumption.
- Workflow definitions and repository policy are versioned separately from mutable run state.
- The local ledger is authoritative for execution and uses a worktree-independent `snapshot.json`, append-only `records.jsonl`, and content-addressed object store.
- External adapters are explicit, idempotent workflow steps.
- The shell and project surfaces have separate trust seams.
- Declarative surfaces use a trusted interaction catalog; complex surfaces use sandbox isolation.
- Every required rich interaction has a terminal representation.
- One schema registry versions commands, receipts, records, snapshots, dispatches, episodes, attention items, dossier revisions, and external receipts.
- The deterministic controller reducer alone assigns current-state semantics. All run views consume its canonical snapshot and attention records.
- Actionable attention is persisted before its source event is acknowledged; routine signals and duplicates do not wake a model.
- Exactly one controlling client holds the run's live control lease, and one controller supervision loop remains responsible while dispatches are in flight.
- Each execution profile has a finite attempt ladder; exhausted attempts, repeated review failure, staleness, contamination, unknown outcomes, and exhausted authority or budget create deduplicated durable attention and pause affected work.
- Parallel workers operate on dependency-independent tasks or isolated review axes.
- Cleanup and promotion are first-class terminal lifecycle actions.
- Run analysis and compounding precede retention and cleanup decisions.
- A run has one active human owner; ownership changes only through an explicit handoff transition.
- Local and cloud model executions use the same dispatch, episode, event, permission, and artifact contracts.
- The initial implementation executes one versioned adaptive workflow contract selected explicitly by the owner.
- The coordinator proposes a typed semantic work graph; the controller validates graph mutations against quality, authority, safety, budget, isolation, independence, and evidence requirements.
- Initial coordination is hub-and-spoke: the coordinator issues controller-routed dispatches and workers return episodes; workers do not maintain peer mailboxes.
- Deliberation uses linked claim, challenge, and response episodes. Every synthesis and controller transition references durable episodes or artifacts.
- One versioned Judgment Dossier owns the pre-implementation snapshot, deliberation history, and post-implementation snapshot.
- The Human-Attention Contract establishes Shared Understanding before autonomous work, permits conditional In-Run Judgment, and supports Acceptance through a task-shaped Review Surface.
- The workflow declares capabilities separately from private machine configuration.
- The run ledger records the workflow version and content hash before execution.
- The first real run targets PhotoQuest in an isolated worktree and excludes production deployment.
- The pilot task is PhotoQuest plan 020, revalidated against the run's starting revision.
- The initial terminal interface exposes `run`, `status`, `decide`, `control`, `validate`, and `close`; its internal commands remain typed, revision-checked, explicit, and idempotent.
- The harness repository vendors shared skills and Pi-owned resources while declaring external tool prerequisites separately from secrets and machine-local state.
- Skills use harness-owned interaction concepts and preserve a headless terminal fallback; enhanced surfaces remain optional projections.
- Resolved skills are dispatch-scoped capabilities whose exact versions are recorded in the resulting episode.
- The harness integrates semantic coordination and agent-driven Surface Builder capabilities for generating native skill experiences.
- Runtime surface adaptations may reorganize presentation and interaction without changing harness-owned authority or workflow state.
- Effective skill resolution combines the vendored upstream core, a reusable stack adaptation, a repository overlay, and optional run-local refinement.

## Future Validation Direction

- Test the highest common seam: a workflow contract executed through terminal commands and projected as structured events.
- Replay terminal commands and emitted events and assert equivalent durable ledger transitions.
- Verify deterministic state transitions independently from model output.
- Exercise `start`, `submit`, `inspect`, and `watch` through terminal and graphical test adapters; assert identical Run Controller semantics.
- Rebuild a fresh coordinator solely from `snapshot.json`, `records.jsonl`, and referenced objects.
- Validate valid and invalid commands, records, dispatches, episodes, attention items, dossier revisions, and receipts through the shared schema registry.
- Attempt to represent an invariant lifecycle gate as a semantic graph node; assert deterministic rejection.
- Feed stale, contradictory, missing, and prose-only observations into reconciliation; assert that the canonical snapshot reports `unknown` rather than reviving an old event or trusting a model claim.
- Project the same run through terminal, attention-inbox, AFK-digest, and graphical-view fixtures; assert identical current-state semantics.
- Crash or replace the coordinator after an actionable source event is observed; assert that its persisted attention item survives and the source event is not acknowledged first.
- Emit routine progress, duplicate lifecycle events, and unchanged observations; assert that they remain observable without launching a coordinator turn.
- Attempt concurrent control-lease acquisition and mutation from a read-only client; assert a single mutation owner and deterministic refusal.
- Generate valid and invalid graph mutations and assert deterministic validation, recorded rejection reasons, and repair without corrupting accepted graph revisions.
- Property-test dependency cycles, missing evidence obligations, lease conflicts, authority escalation, budget overflow, and attempts at author self-approval.
- Test delayed, duplicated, stale-revision, and budget-exhausting dispatches and episode returns; assert deterministic acceptance and bounded termination.
- Attempt to base synthesis and graph transitions on raw tactical chatter; assert that the controller requires a durable episode or artifact reference.
- Resume a worker from referenced episodes without copying another worker's transcript; assert that claims, evidence status, skills, and continuation provenance survive.
- Seed deliberations with unsupported consensus, unresolved conflicts, and contradicted evidence; assert that synthesis exposes them rather than silently flattening them.
- Contract-test repository packages, event schemas, snapshots, handoffs, external adapters, and surface capability negotiation.
- Test idempotent publication and conflict reconciliation against external-system fakes.
- Test interactive-to-AFK mode switching on the same run identifier.
- Test coordinator-session replacement from the canonical snapshot, semantic records, and referenced objects while the controller host remains alive.
- Contract-test coordinator, resumable-worker, and ephemeral-subagent lifecycles with different Pi models.
- Attempt project mutation from the coordinator and delivery from a scout dispatch; assert that the coordinator cannot acquire a project-workspace write lease and the scout cannot publish or convert scratch changes without promotion.
- Promote a completed scout to ship; assert preserved evidence lineage, explicit authority, clean mutation scope, and no duplicate graph work item.
- Attempt to release dirty, unlanded, unreported, and evidence-incomplete workspaces; assert that leases remain held until delivery, authorized discard, or sealed scout completion.
- Exhaust each configured attempt ladder and review-failure threshold; assert one deduplicated attention item and no further affected dispatch.
- Attempt to submit a dispatch with missing source-backed inputs, invented capabilities, an unrecognized profile, or an incompatible episode schema; assert deterministic rejection.
- Prove that no workflow transition depends on Claude Code, Codex CLI or app-server, or CLI-proxy state.
- Test staleness detection by changing each revision or hash input independently.
- Test cleanup with mark-and-sweep fixtures, pinned evidence, policy holds, orphaned blobs, and promotion gates.
- Seed runs with known retries, ineffective reviews, stale guidance, and useful corrections; assert that analysis metrics and compounding candidates preserve provenance and scope.
- Prove that raw transcripts and model self-assessments cannot become active knowledge without a recorded promotion transition.
- Simulate provider cache support, cache misses, model unavailability, and quota pressure; assert that routing preserves role capabilities and records the reason for every fallback.
- Security-test sandbox isolation and prove project surfaces cannot alter shell-owned controls.
- Use repository-specific acceptance suites for policy examples, including browser-visible PhotoQuest behavior.

## Out of Scope

- Replacing the full capabilities of IntelliJ, GitHub, Linear, Sentry, or CI systems.
- Making terminal and GUI clients visually or functionally identical.
- Allowing agent-generated surfaces to control authentication, permissions, or recovery.
- Treating conversation transcripts as canonical project knowledge.
- Unrecorded private agent conversations that influence run decisions.
- Peer worker mailboxes and open-ended worker-to-worker conversations in the initial implementation.
- Multiple coding-agent harnesses, terminal multiplexer backends, and terminal-screen parsing for execution state.
- Persistent coordinator hierarchies and public social-media task ingress.
- A blanket autonomy switch that bypasses the run's explicit authority and quality envelope.
- Mutable Markdown as authoritative run state.
- Model-authored lifecycle transitions or model-executed controller Git choreography.
- A universal scout-before-dispatch rule or plan-once restriction.
- Universal file-count or changed-line limits for work packets.
- Cost tiers that couple judgment depth, risk, model choice, and review policy into one setting.
- A daemon, database, distributed controller, or controller-process recovery in V1.
- Maximizing the number of concurrent model workers as a product goal.
- Live concurrent human control of one run.
- Publishing this draft to an external issue tracker during the architecture interview.
- Multiple workflow profiles, automatic workflow selection, and policy resolution.
- Personal, project-area, and run-local workflow variants.
- Workflow layering, conflict resolution, and upstream workflow contribution.
- Concurrent delivery of multiple independent product outcomes in one run.
- Production deployment from the pilot run.
- Agent-generated and repository-specific GUI composition in the pilot.
- A graphical run client and pi-gui integration in the pilot.
- Claude Code, Codex CLI or app-server, and CLI-proxy worker integrations.
- Copying credentials, subscription state, or platform-specific external tool binaries into the harness repository.
- Requiring every skill to implement a custom graphical interface.
- Allowing generated skill surfaces to own permissions, recovery, or authoritative workflow state.
- Rewriting vendored upstream skills independently in every repository without provenance or reusable adaptation layers.

## Deferred Design Questions

- Whether narrowly scoped compounding candidates may be promoted automatically under repository policy or all promotions require owner approval.
- The cadence and trigger policy for cross-run orchestration analysis.
- Whether the initial workflow pins exact Pi models or resolves capability-based role declarations at dispatch.
- The exact allowlisted mutation classes for in-progress semantic graph nodes.
- Whether dossier ratification is a controller-validated synthesizer action distinct from human approval, or every ratified snapshot requires human approval.
- The exact schema fields, compatibility rules, and sealing representation for commands, semantic records, events, and artifacts.
- Retention periods, promotion authority, and legal or compliance holds.
- The exact common skill interface, interaction vocabulary, and sandbox isolation seam.
- Whether a draft enhanced surface is generated when a skill is added, on first use, or only by explicit request.
- The promotion rule for sharing a generated surface with the vendored skill.
- Whether runtime surface adaptations remain run-local by default and what evidence allows promotion into the shared skill package.
- The representation and resolution rules for upstream, stack, repository, and run-local skill adaptations.
