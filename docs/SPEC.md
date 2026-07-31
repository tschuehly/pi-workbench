# Pi Project Workbench — Evolving Specification

Status: evolving specification. The V1 lifecycle, core module interfaces, durable storage shape, attention-centered client concepts, and minimal graphical vertical slice are established; exact schema fields and implementation details remain to be validated through the pilot.

Canonical domain language is defined in [CONTEXT.md](CONTEXT.md).

## Problem Statement

Development work is distributed across agent conversations, IntelliJ, terminals, worktrees, repository files, GitHub, Linear, Sentry, CI, generated review pages, and project-specific scripts. Each repository and task needs a different balance of exploration, judgment, autonomy, verification, review, and external collaboration. External project-management tools are useful collaboration surfaces but are a poor execution state machine for local agent work.

Human Attention is scarce and loses value when people must continuously supervise routine work or reconstruct intent, decisions, evidence, and consequences from scattered artifacts. Model Context and Model Effort are also constrained: loading broad histories into every agent, using one model for every Cognitive Role, or preserving continuity where independent judgment is needed makes execution slower, less focused, and harder to evaluate.

Chat serializes communication even when project work is parallel, visual, and changing quickly. Plans, approval requests, progress, evidence, corrections, and completed work become one interleaved timeline; a question may become stale while independent work advances, and a person must juggle tabs and remember which state each conversation represents. A terminal-only pilot can validate controller mechanics but cannot validate this Human-Attention problem.

Long-running agent work also creates substantial temporary state. Without explicit promotion and cleanup rules, ledgers, handoffs, traces, generated artifacts, cached research, and obsolete plans become stale context that harms both people and agents.

## Solution

Provide a Pi-based project workbench that allocates human and model attention across concurrent durable Runs. Portfolio and Project Attention Brokers route priorities, guidance, and prepared judgments without replacing the Coordinator accountable for each Run. Before requiring managed Run infrastructure, the shell offers explicit numbered Entry Presets for progressively adopting interactive Pi and multi-model delegation. Levels 1–3 remain visibly unmanaged Pi workflows; Level 4 enters a managed Run. Each Run establishes Shared Understanding and a resolved Working Mode before autonomous work, routes bounded Dispatches by Cognitive Role, Model Effort, Continuity, and Independence, requests In-Run Judgment when it can materially improve the outcome, and supports Acceptance through a task-shaped Review Surface.

The workbench has a stable trusted shell and one versioned adaptive Workflow Contract. Pi is the only model-worker runtime. A durable local run ledger drives execution. Terminal and graphical clients consume the same run protocol and render interactions appropriate to their capabilities. External systems are connected through explicit import and Publication steps.

The initial workflow defines its quality and authority envelope, capabilities, tools, model roles, permissions, surfaces, external synchronization, evidence requirements, and retention lifecycle. Repository capabilities, Run intent, uncertainty, impact, reversibility, and available Human Attention resolve a Working Mode rather than selecting a universal maturity level. A fixed deterministic controller lifecycle surrounds a revisable graph of variable semantic work. A Pi coordinator organizes that work inside the envelope, while the controller alone advances lifecycle state and performs side effects. Loops, experimental graphs, planning, implementation, and review are bounded execution capabilities; the primary human value is reviewable Judgment before autonomous work, selectively during it, and when evaluating the realized outcome.

## High-Level Product Shape

- Pi is the only agent runtime and can use different models for different cognitive roles.
- A Portfolio Broker allocates attention across projects, and a Project Broker coordinates concurrent Runs inside one repository without replacing their Run Coordinators.
- One project may run several independent outcomes in parallel; each remains a separate Run with its own authority, evidence, lifecycle, and accountable Coordinator.
- Attention Allocation matches human judgment moments and model capability, effort, context, continuity, and independence to the repository and task.
- Working Mode is resolved per Run from the desired outcome, repository capabilities, uncertainty, impact, reversibility, and available Human Attention; no fixed global catalog or maturity ladder is required.
- Four numbered Entry Presets provide an explicit adoption path without redefining Working Mode: Levels 1–3 start unmanaged Pi workflows, while Level 4 starts a controller-managed Run.
- The controller advances one fixed lifecycle; the model dynamically organizes only the variable semantic work inside it.
- Stable guardrails preserve human authority, workspace isolation, durable state, evidence, explicit external actions, and recovery.
- The coordinator organizes evidence-linked claim, challenge, and response episodes into one accountable synthesis.
- One Judgment Dossier makes the important reasoning reviewable before execution and reconciles it with the realized outcome afterward.
- Every Dispatch receives the smallest self-contained Model Context justified by its Cognitive Role; Episodes carry useful results across context boundaries without copying full tactical histories.
- Implementation and verification are adaptable execution capabilities rather than a universal sequence of ceremonies.
- Human Attention is concentrated in two Principal Judgments and requested during execution only when an In-Run Judgment has material value.
- Review Surfaces assemble the realized outcome, relevant context, Primary Evidence, and target-anchored actions in the format appropriate to the human judgment.
- The minimal graphical client makes portfolio, project, Run, attention, evidence, and scoped-conversation state visible while terminal clients retain complete structured control paths.
- Every run analyzes its outcome and orchestration, compounds validated learning, and cleans up disposable state.
- One cloneable harness repository supplies the shared Pi capabilities and curated skills; target repositories add project-specific overlays.
- Skills are portable agent capabilities that may progressively add richer project- and task-appropriate interfaces through harness-owned APIs.
- Skills resolve from a portable upstream core through stack and repository adaptations, so the same capability fits each codebase without losing provenance.
- A Pi agent can generate an integrated harness surface for a skill using the same semantic Surface Builder pattern proven by Atelier.
- Skill surfaces can change during a run as the task, evidence, decisions, and repository context evolve.
- Mechanical status, validation, configuration health, and routine supervision consume no model turn.
- Logical Actors retain durable identity while their Pi model sessions remain disposable and reconstructable from source-backed Continuation Artifacts.

Exact schema fields, routing bindings, retention values, and client-specific graphical interaction schemas remain intentionally unspecified until exercised by the pilot.

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
24. The shortest path to decision-changing evidence takes priority over unbounded issue discovery or review activity.
25. A loop or graph is an execution shape selected for the outcome, not a workflow or maturity level in itself.
26. Human-facing state assumes interruption and context switching: it externalizes memory, distinguishes activity from action, preserves place, and explains what changed since the last judgment.
27. Attention requests pause only affected work when dependencies and authority allow independent work to continue.
28. Logical Actor identity and accountability outlive replaceable model sessions; no model context is authoritative Run state.
29. Watchers classify and reconcile routine execution mechanically; models enter only when interpretation or judgment is actionable.
30. A graphical attention surface is part of the V1 vertical slice because attention allocation, visual evidence, and concurrent work cannot be validated through terminal mechanics alone.
31. Graphical interaction is action-first and interruption-resilient by default: required judgment leads, routine activity is perceptually and structurally separate, completed outcomes are concrete, and deeper evidence remains available on demand.

## Actors

- Developer using Pi in a terminal.
- Developer using the graphical workbench.
- Non-terminal collaborator reviewing artifacts and making bounded decisions.
- Workflow owner maintaining the initial workflow contract.
- Portfolio Broker routing priorities and Human Attention across projects.
- Project Broker coordinating repository capabilities, conflicts, and concurrent Runs without owning their lifecycle state.
- Deterministic controller validating transitions, reducing current state, dispatching Pi executions, and owning workspace and supervision leases.
- Pi coordinator interpreting owner intent, organizing work, selecting bounded dispatches, and synthesizing results without mutating target projects.
- Pi worker performing planning, implementation, research, review, verification, context curation, run analysis, or compounding with a role-specific model.
- Deterministic Watcher reconciling execution observations, timers, leases, and external waits without a model turn.
- External system adapter connecting GitHub, Linear, Sentry, CI, IntelliJ, and similar systems.

## System Architecture

### Attention Brokerage and Concurrent Runs

The Workbench presents three coordination scopes without collapsing them into one conversation or
one authority hierarchy:

- The **Portfolio Broker** routes attention, priorities, and authorized Run proposals across projects.
- The **Project Broker** coordinates repository capabilities, resource conflicts, and several
  concurrent Runs in one project.
- Each **Run Coordinator** remains accountable for one owner-declared outcome, its semantic work,
  evidence, and human-facing synthesis.

The owner may enter a project or Run scope and communicate directly with the relevant Broker or
Coordinator. The higher Broker receives a bounded Episode when that focused interaction ends; it
does not ingest the complete lower-scope conversation. A pending judgment blocks only affected
graph nodes or Runs when other work remains dependency-independent and authorized.

Brokers communicate through one versioned, typed protocol rather than relying on prompt obedience.
Its semantic operations cover:

```text
propose run
start authorized run
guide revisioned run or project work
set portfolio or project priority
inspect and watch canonical projections
request a prepared Review Surface
pause, resume, stop, or transfer control
```

Responses include revisioned proposals, receipts, project projections, Attention Items, capability
needs, cross-Run conflicts, progress digests, Review Surface references, and outcome Episodes. A
Broker may propose work autonomously, but starting a Run or expanding material scope requires
explicit authority or a previously approved envelope. System-prompt overlays describe scope,
repository language, and communication behavior; controllers and schemas enforce authority,
revisions, and legal operations.

Portfolio and Project Brokers use the same parameterized Pi execution primitive with different
scope, source projections, allowed commands, profiles, and expected Episode schemas. They are
Logical Actors whose model sessions may be replaced without changing their identity or authority.
A Broker or planner may request bounded supporting Subagent Dispatches for investigation,
comparison, challenge, or preparation. The controller resolves each Work Packet and capability set;
the Subagent inherits neither the requesting actor's context nor its authority and returns one typed
Episode to the accountable actor.

### Detailed Contracts

The following specifications own the detailed supported behavior of each stable system contract:

- [Harness and Skills](specs/harness-and-skills.md): distribution, repository adaptation, skill resolution, and generated surfaces.
- [Controller and Durable State](specs/controller-and-state.md): controller interfaces, durable records, workspaces, and immutable artifacts.
- [Pi Execution](specs/execution.md): workers, Dispatches, Episodes, execution semantics, deliberation, and protocol schemas.
- [Attention and Interfaces](specs/attention-and-interfaces.md): supervision, graphical and terminal clients, Review Surfaces, and external adapters.
- [Workflow](specs/workflow.md): quality and authority, Human Attention, lifecycle, Semantic Execution Graph, operation modes, reconciliation, and compounding.

Exact wire and persistence shapes belong to the schema registry. Package documentation describes implementation and operation without redefining these contracts.

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
20. As a decision maker, I want Shared Understanding of the problem, language, assumptions, options, disagreements, trade-offs, and success evidence before execution, so that autonomous work does not prematurely settle the direction.
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
38. As a portfolio owner, I want one attention view across projects, so that I can allocate judgment without juggling agent chats and tabs.
39. As a project owner, I want several independent Runs to progress concurrently, so that one pending judgment does not stop unrelated authorized work.
40. As an interruptible reviewer, I want the Workbench to preserve my place and show what changed since my previous judgment, so that resumption does not depend on working memory.
41. As a decision maker, I want experimental results compared against predeclared criteria in a progressive Review Surface, so that I can judge the next direction without reading Worker reports or logs.
42. As a Broker, I want a typed protocol for proposals, guidance, control, attention, and prepared review, so that cooperation does not depend on prompt obedience or shared chat history.
43. As a long-lived Logical Actor, I want my model session to be replaceable from a source-backed Continuation Artifact, so that continuity does not require retaining an increasingly stale context window.
44. As a repository owner, I want installed capabilities resolved into only the Dispatches that need them, so that global skill availability does not pollute every Worker context or expand authority.
45. As a new Pi user, I want an explicit numbered Entry Preset, so that I can begin with fast interactive work and adopt deeper delegation gradually.
46. As an interactive operator, I want the shell to distinguish unmanaged Pi workflows from managed Runs, so that convenience orchestration is never mistaken for enforced authority or recovery.
47. As a PI WEB user, I want Level selection in a first-class primary view, so that the adoption posture is visible and understandable rather than hidden in prompts or a narrow side panel.

## Implementation Decisions

- Pi is the workflow harness and exposes a durable run protocol to clients.
- Portfolio and Project Brokers use a typed, revisioned protocol over canonical project and Run projections; they route attention and authorized requests without owning Run lifecycle state.
- Every model-backed role runs through Pi; model choice is a field of the Pi worker specification rather than a separate harness.
- Coordinator, worker, and subagent profiles use one parameterized Pi execution primitive and the same dispatch, episode, artifact, permission, budget, cancellation, and workspace-lease vocabulary.
- Coordinator, worker, and subagent describe execution continuity; scout and ship independently describe authority and expected outcome.
- The coordinator never receives a project-workspace write lease. Every deliverable mutation is performed by a controller-approved ship dispatch in an isolated workspace; scout scratch mutations cannot be delivered directly.
- The initial repository package exposes a finite set of named execution profiles, and the controller validates every resolved dispatch field.
- Every bounded dispatch returns a typed episode that preserves provenance and primary-evidence references without promoting its summary to authoritative truth.
- Every dispatch receives the smallest sufficient Model Context assembled from its Work Packet, resolved skills, referenced Episodes, and relevant Primary Evidence; unrelated histories and stale tool output remain outside it.
- Logical Actor identity outlives replaceable model sessions. Fresh Context Curator Dispatches produce source-backed Continuation Artifacts while required authority, decisions, disagreement, evidence, uncertainty, and pending attention remain mechanically preserved.
- The controller owns the fixed `intake → judgment → authority → execution → verification → acceptance → publication → close` lifecycle.
- Execution-graph nodes represent only variable semantic work, dependencies, worker bindings, and evidence obligations; fixed lifecycle gates are not graph nodes.
- Tactical work and context synchronization are recorded as episodes within their owning node.
- Every dispatch receives a self-contained work packet with source-backed inputs, authority, scope, risks, evidence obligations, and an expected episode schema.
- Every Ship Work Packet is directly executable: it identifies exact source-backed contracts, optional normalized path scope, repository examples, exclusions, validation commands, and evidence invalidation rules.
- Ship validation evidence is bound to the exact candidate workspace fingerprint. Any subsequent content mutation invalidates it, and the controller refuses to land a different fingerprint.
- Every successful Ship Episode contains a mutation receipt covering changed paths, scope evidence, validation, acceptance coverage, public-interface changes, deviations, unresolved claims, and residual risks.
- The Repository Workspace module alone lands validated candidates. Per-slice commits are repository policy; pushing and pull-request creation remain explicit Publication actions.
- Workflows declare cognitive roles, required capabilities, effort, continuity, and independence; repository policy resolves or pins the concrete Pi model.
- Cache affinity never controls workflow correctness or resumption.
- Workflow definitions and repository policy are versioned separately from mutable run state.
- The local ledger is authoritative for execution and uses a worktree-independent `snapshot.json`, append-only `records.jsonl`, and content-addressed object store.
- External adapters are explicit, idempotent workflow steps.
- The shell and project surfaces have separate trust seams.
- The V1 client surface includes portfolio attention, project and Run workspaces, revision-aware evidence, scoped conversation, and Working Mode presentation over the same controller protocol as the terminal.
- The Graphical Attention Contract makes pending judgment the default graphical entry point, separates required action from autonomous activity, restores the owner's place, and defines an action-first progressive Review Surface without changing controller authority.
- Declarative surfaces use a trusted interaction catalog; complex surfaces use sandbox isolation.
- Every required rich interaction has a terminal representation.
- One schema registry versions commands, receipts, records, snapshots, dispatches, episodes, attention items, dossier revisions, and external receipts.
- The deterministic controller reducer alone assigns current-state semantics. All run views consume its canonical snapshot and attention records.
- Actionable attention is persisted before its source event is acknowledged; routine signals and duplicates do not wake a model.
- A deterministic Watcher performs routine supervision; Brokers consume reconciled snapshots and Attention Items rather than raw execution logs.
- Exactly one controlling client holds the run's live control lease, and one controller supervision loop remains responsible while dispatches are in flight.
- Each execution profile has a finite attempt ladder; exhausted attempts, repeated review failure, staleness, contamination, unknown outcomes, and exhausted authority or budget create deduplicated durable attention and pause affected work.
- Parallel workers operate on dependency-independent tasks or isolated review axes.
- Cleanup and promotion are first-class terminal lifecycle actions.
- Run analysis and compounding precede retention and cleanup decisions.
- A run has one active human owner; ownership changes only through an explicit handoff transition.
- Local and cloud model executions use the same dispatch, episode, event, permission, and artifact contracts.
- The initial implementation executes one versioned adaptive workflow contract selected explicitly by the owner.
- The coordinator proposes a typed semantic work graph; the controller validates graph mutations against quality, authority, safety, budget, isolation, independence, and evidence requirements.
- Working Mode is resolved inside the one Workflow Contract from Run intent, repository capabilities, uncertainty, impact, reversibility, and available Human Attention; loops and graphs remain execution shapes rather than global modes or separate workflows.
- Planning prioritizes the shortest safe path to decision-changing evidence, and every review Dispatch has an outcome-relevant claim, evidence obligation, attempt bound, finding disposition, and stopping condition.
- Initial coordination is hub-and-spoke: the coordinator issues controller-routed dispatches and workers return episodes; workers do not maintain peer mailboxes.
- Deliberation uses linked claim, challenge, and response episodes. Every synthesis and controller transition references durable episodes or artifacts.
- One versioned Judgment Dossier owns the pre-execution snapshot, deliberation history, and post-execution snapshot.
- The Human-Attention Contract establishes Shared Understanding before autonomous work, permits conditional In-Run Judgment, and supports Acceptance through a task-shaped Review Surface.
- The workflow declares capabilities separately from private machine configuration.
- Entry Presets are repository-owned Pi package resources and UI configuration, not Workflow Contracts or authority grants. Levels 1–3 may launch unmanaged Pi leads and child processes but cannot claim controller mediation, durable Run identity, enforced workspace rights, or Run evidence.
- Level 1 uses one editing lead with read-only advisors. Level 2 permits lead-directed parallel read and write subagents with advisory directory partitions. Level 3 adds mandatory Grill with Docs, an approved implementation contract, fresh-context slices, independent cross-family review, and a two-correction-cycle bound. Level 4 enters the managed Run lifecycle.
- Unmanaged model routing resolves Cognitive Role together with Entry Preset into an Execution Profile and concrete model binding; missing independent capacity remains explicit rather than silently weakening the requested role.
- The run ledger records the workflow version and content hash before execution.
- The first real run targets PhotoQuest in an isolated worktree and excludes production deployment.
- The pilot task is PhotoQuest plan 020, revalidated against the run's starting revision.
- The terminal interface exposes `run`, `status`, `decide`, `control`, `validate`, and `close`; its internal commands remain typed, revision-checked, explicit, and idempotent and provide fallback equivalence for the graphical attention slice.
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
- Run several independent Runs under one Project Broker; assert that their lifecycle, authority, evidence, and control leases remain separate while project attention and conflicts are reconciled.
- Submit stale, unauthorized, and duplicate Broker protocol operations; assert revision checks, idempotent receipts, and deterministic refusal without prompt interpretation.
- Rebuild a fresh coordinator solely from `snapshot.json`, `records.jsonl`, and referenced objects.
- Rotate Broker, Coordinator, and Worker sessions at synchronization points; assert reconstruction from validated Continuation Artifacts without transcript dependence or loss of required disagreement, authority, evidence, uncertainty, or attention.
- Validate valid and invalid commands, records, dispatches, episodes, attention items, dossier revisions, and receipts through the shared schema registry.
- Attempt to represent an invariant lifecycle gate as a semantic graph node; assert deterministic rejection.
- Feed stale, contradictory, missing, and prose-only observations into reconciliation; assert that the canonical snapshot reports `unknown` rather than reviving an old event or trusting a model claim.
- Project the same run through terminal, attention-inbox, AFK-digest, and graphical-view fixtures; assert identical current-state semantics.
- Resume the graphical client after unrelated and affected work changes; assert preserved focus, accurate change summaries, stale-feedback marking, and current evidence ordering.
- Open every fixture Attention Item from the portfolio surface; assert that required judgment, materiality, recommendation, consequences, deferral behavior, affected work, and available actions are discoverable without reading logs or chat.
- Project routine progress beside pending attention; assert that autonomous activity remains visible but cannot compete with or be mistaken for required owner action.
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
- Mutate an allowed file after a green validation result; assert that the workspace fingerprint changes, the evidence becomes stale, and landing is rejected until the candidate is revalidated.
- Add, delete, rename, stage, and leave untracked paths outside a Ship Work Packet's declared scope; assert deterministic detection before review and before landing.
- Resume an in-flight Ship Dispatch with matching and mismatching lease, base revision, graph revision, packet hash, scope hash, and workspace fingerprint; assert continuation only for the fully reconciled case.
- Submit a Ship Episode without a complete mutation receipt or with an interface-contract claim unsupported by landed source; assert rejection or an unverified claim rather than silent promotion.
- Exhaust the PhotoQuest Ship profile's three-attempt correction ladder; assert one deduplicated Attention Item, preservation of the candidate diff and failure evidence, and no model takeover or landing.
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
- Unbounded recursive agent hierarchies, model-backed log watching, and public social-media task ingress.
- A blanket autonomy switch that bypasses the run's explicit authority and quality envelope.
- Mutable Markdown as authoritative run state.
- Model-authored lifecycle transitions or model-executed controller Git choreography.
- A universal scout-before-dispatch rule or plan-once restriction.
- Treating numbered Entry Presets as a universal Working Mode ladder, quality ranking, Workflow Contract, or authority mechanism.
- Claiming controller enforcement, durable Run recovery, or isolated workspace safety for unmanaged Levels 1–3.
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
- Agent-generated graphical composition, complete terminal parity in presentation, or commitment to a permanent third-party graphical shell in the pilot.
- Claude Code, Codex CLI or app-server, and CLI-proxy worker integrations.
- Copying credentials, subscription state, or platform-specific external tool binaries into the harness repository.
- Requiring every skill to implement a custom graphical interface.
- Allowing generated skill surfaces to own permissions, recovery, or authoritative workflow state.
- Rewriting vendored upstream skills independently in every repository without provenance or reusable adaptation layers.

## Deferred Design Questions

- Whether narrowly scoped compounding candidates may be promoted automatically under repository policy or all promotions require owner approval.
- The cadence and trigger policy for cross-run orchestration analysis.
- Whether the initial workflow pins exact Pi models or resolves capability-based role declarations at dispatch.
- The exact allowlisted mutation classes for in-progress semantic graph nodes and the controller behavior when a proposed mutation's materiality cannot be established mechanically.
- Whether dossier ratification is a controller-validated synthesizer action distinct from human approval, or every ratified snapshot requires human approval.
- The exact split between mechanically enforceable controller invariants and provenance-bearing human or model judgment attestations for materiality, evidence sufficiency, Independence in substance, and Judgment Dossier completeness.
- The exact schema fields, compatibility rules, and sealing representation for commands, semantic records, events, and artifacts.
- Retention periods, promotion authority, and legal or compliance holds.
- The exact common skill interface, interaction vocabulary, and sandbox isolation seam.
- The durable representation of portfolio and project projections, proposals, priorities, and Broker continuation references while each Run ledger remains authoritative for execution.
- The exact Working Mode input schema, owner override, recommendation behavior, and validation rules inside the single Workflow Contract.
- The Continuation Artifact schema, size budgets, rotation thresholds, protected fields, and reconstruction checks for replaceable model sessions.
- The exact graphical wire schemas and client-specific interactions for focus restoration, changes since the previous judgment, revision-aware feedback, progressive Review Surfaces, and scoped conversation.
- Whether a draft enhanced surface is generated when a skill is added, on first use, or only by explicit request.
- The promotion rule for sharing a generated surface with the vendored skill.
- Whether runtime surface adaptations remain run-local by default and what evidence allows promotion into the shared skill package.
- The representation and resolution rules for upstream, stack, repository, and run-local skill adaptations.
