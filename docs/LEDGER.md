# Pi Project Workbench — Decision Ledger

Status: evolving through the architecture interview. This file is the compact restart point for the conversation.

## Objective

Create a Pi-based project workbench that allocates Human Attention across concurrent project Runs and adapts Working Mode, tools, verification, and Review Surfaces to repository capabilities, desired outcome, uncertainty, operational risk, reversibility, and available attention. Portfolio, project, terminal, and graphical clients operate the same controller protocol and durable Run state.

## Evidence Ledgers

- [Pi ecosystem](ledgers/pi-ecosystem.md)
- [PhotoQuest Ralph](ledgers/photoquest-ralph.md)
- [AIHero](ledgers/aihero.md)
- [AI Engineer wiki](ledgers/ai-engineer-wiki.md)
- [Recent repositories](ledgers/recent-repositories.md)
- [Model-routing field notes](ledgers/model-routing-x.md)
- [Current Quality Loop](ledgers/current-quality-loop.md)
- [Skill interface](ledgers/skill-interface.md)
- [Slate](ledgers/slate.md)
- [FirstMate](ledgers/firstmate.md)
- [Brigade](ledgers/brigade.md)
- [T3 Code](ledgers/t3code.md)

## Agreed Decisions

1. **Stable shell, bounded dynamic surfaces.** The shell owns trust-sensitive controls such as identity, permissions, run control, recovery, workspaces, and notifications. Repositories and agents may supply task-specific surfaces through constrained protocols.
2. **Local working state drives execution.** GitHub, Linear, Sentry, CI, and similar systems remain collaboration systems and external systems of record. They do not implicitly drive the local workflow state machine.
3. **External synchronization is explicit.** Publishing or importing an issue, PR, comment, incident, or status is a visible, idempotent workflow step with provenance and reconciliation behavior.
4. **One workflow protocol, multiple clients.** Terminal and GUI users share workflow definitions, state transitions, permissions, and artifacts. They do not need feature-identical interfaces.
5. **Repository defaults are insufficient on their own.** Effective workflow policy combines repository defaults, task intent, risk classification, and an explicit user override.
6. **Interactive and AFK operation share one run.** They are different control and presentation modes over the same durable ledger, not separate engines.
7. **Model workers are role-specific.** Claude, Codex, and other models are selected together with task, tools, permissions, reasoning budget, and review role.
8. **Run state is outside model context.** Agent conversations are disposable execution contexts. Resumption uses durable state, checkpoints, and referenced artifacts.
9. **Cleanup is a required lifecycle operation.** Completion must be followed by a promotion and retention review before scratch state becomes eligible for deletion.
10. **The specification records intended behavior; evidence stays in ledgers.** This keeps the spec compact while preserving provenance and disagreements.
11. **One active human owner per run.** A run may use many model workers, but exactly one person or controlling client owns steering and authority at a time. Ownership transfers through an explicit portable handoff.
12. **Collaboration and cloud execution extend the protocol.** Pi may later connect shared collaboration services and cloud agents to the same run contract without making live distributed synchronization a first-version requirement.
13. **The owner can select the workflow manually.** A run may begin from an explicit owner selection, an agent recommendation, or a repository default. The chosen workflow and rationale are recorded, and repository safety floors remain binding.
14. **Every user can author workflows.** Manual choice includes creating and composing a workflow for one run, not only selecting a predefined repository profile.
15. **Personal workflows can become shared workflows.** Users may contribute workflows upstream after adapting them for shared capabilities, repository policy, and team review.
16. **Workflow resolution includes environment and ownership.** Available tools, operating system, local setup, and the project area owned by the user influence which workflow capabilities are available and useful.
17. **Workflows compose in layers.** The default resolution order is shared baseline, project-area overlay, personal environment overlay, then run overlay. A standalone workflow is valid by importing no shared workflow modules.
18. **Every run records a resolved workflow contract.** Pi materializes the selected layers into one immutable, validated quality and authority envelope and records its content hash. The run-specific execution graph is separately versioned and revisable.
19. **The initial implementation contains one adaptive workflow contract.** Workflow selection, personal variants, layering, conflict resolution, and upstream contribution are product direction, not first-workflow scope.
20. **One fixed lifecycle surrounds variable semantic work.** The controller advances `intake → judgment → authority → execution → verification → acceptance → publication → close`. The coordinator organizes and revises the semantic work inside that lifecycle without duplicating invariant gates as graph nodes.
21. **Human authority brackets autonomous work.** The owner approves the pre-execution Judgment Dossier and Autonomy Envelope, material deviations, final Acceptance, and Publication. Acceptance may explicitly authorize pull-request Publication while remaining a separate durable transition. Pre-authorized work may continue in AFK mode on the same Run.
22. **PhotoQuest is the pilot repository.** The first run uses an isolated worktree, a reversible low-impact change, repository-native verification, and no production deployment.
23. **PhotoQuest plan 020 is the pilot task.** The workflow revalidates the existing landing-page scroll-depth tracking plan against the current repository revision, obtains fresh owner approval, then implements and verifies it.
24. **V1 is a graphical attention vertical slice over trustworthy controller semantics.** The terminal and minimal graphical client consume the same Run protocol from the start. The graphical slice must expose portfolio attention, project and Run workspaces, revision-aware evidence, scoped conversation, and Working Mode without owning workflow state; generated repository surfaces and permanent shell selection remain outside the pilot.
25. **Pi is the only model-worker harness.** Planning, implementation, review, and verification agents run as Pi sessions or Pi processes. Claude, Codex, and other models are selected inside Pi; the workflow does not launch Claude Code, Codex CLI or app-server, or a CLI proxy.
26. **Every bounded execution dispatch is controller-mediated.** The coordinator submits typed dispatch requests. The deterministic controller validates role, model, budget, permissions, workspace lease, skills, inputs, and episode schema before launching the Pi execution.
27. **Run analysis and compounding are workflow requirements.** Every run must evaluate both delivered outcomes and orchestration behavior, then extract source-backed candidates for reusable project knowledge and workflow improvement before retention and cleanup decisions.
28. **The model designs the run-specific semantic work graph.** A Pi coordinator proposes variable semantic work from repository, task, risk, and current evidence. The deterministic controller validates graph revisions against the quality and authority envelope while retaining sole ownership of the fixed lifecycle.
29. **Judgment artifacts are the primary value surface.** Before implementation, the run makes its problem model, options, trade-offs, assumptions, risks, and chosen direction reviewable. After implementation, it explains the realized system, evidence, deviations, consequences, residual risks, and learning candidates.
30. **Specialists deliberate through coordinator-arranged episodes.** The coordinator dispatches evidence-linked questions, proposals, challenges, and responses. Linked episodes preserve identities, artifact revisions, claim status, and evidence references; one coordinator remains accountable for synthesis.
31. **Decision-relevant deliberation is durable.** An episode that introduces or changes a claim, assumption, evidence reference, disagreement, decision candidate, authority need, risk, or execution-graph choice is retained and referenced by synthesis. Mechanical progress chatter may remain ephemeral.
32. **The pilot has one authoritative Judgment Dossier.** It contains the pre-execution snapshot, linked deliberation Episode references, and post-execution snapshot. Repository- and task-specific presentations are generated views rather than separately authoritative reasoning artifacts.
33. **The core V1 interfaces are established.** The fixed lifecycle, semantic work graph, deep module interfaces, durable storage shape, schema registry, terminal fallback, minimal graphical attention slice, and bounded-failure behavior define the initial implementation. Exact schema fields, routing bindings, retention values, and graphical interaction contracts remain to be validated through the pilot.
34. **The harness is distributed as one cloneable Git repository.** It carries the shared Pi runtime package, orchestration capabilities, curated skills, prompts, adapters, configuration, provenance, and bootstrap checks needed to reproduce the supported development environment.
35. **The distribution vendors skills and provisions external tools.** Shared skills, Pi extensions, prompts, small adapters, and required resources live in the harness repository with provenance. External executables and services are versioned capabilities; credentials, subscriptions, and machine-specific state remain local.
36. **The stable Pi harness is separate from `skill-incubator`.** The incubator remains the experimental laboratory. Proven capabilities graduate into the curated repository that users clone.
37. **Skills are first-class harness capabilities.** Skills are optimized for the harness and can expose structured progress, decisions, artifacts, inputs, and outputs through harness-owned interfaces, while the harness preserves their portable agent behavior.
38. **The agent can generate an enhanced interface for a skill.** When a skill is added or refined, a Pi worker can interpret its workflow and human interaction needs, then create a native harness surface for its decisions, artifacts, progress, inputs, outputs, and actions.
39. **The Atelier pattern is integrated into the harness UI.** Semantic coordination and surface construction remain separate responsibilities, but generated skill surfaces appear as native project-workbench experiences rather than separate Atelier applications.
40. **Enhanced interfaces are runtime-flexible.** The coordinating agent can reshape a skill surface as the task, repository context, artifacts, and decisions evolve. Runtime presentation changes remain projections over stable harness-owned workflow state and authority.
41. **Skills resolve against the target repository.** When a skill is added, the agent adapts it to the detected stack, available tools, project conventions, safety policy, and verification practices while preserving its upstream purpose and provenance.
42. **V1 durability covers Pi-session crash only.** *(R1, confirmed on surface 2026-07-17)* V1 guarantees replacement of a failed or exhausted Pi model session while the controller host process remains alive. Controller-process exit, terminal-induced exit, reboot, and machine loss are outside the supported V1 failure scope. "AFK" means unattended live-process operation — pre-authorized transitions, persisted pending-authority state, best-effort notifications while the host lives — not background-process durability. SPEC user stories 4/11 (resumable across resets, portable handoff) are explicitly post-V1.
43. **The pilot is one real delivery plus controlled drills.** *(R2, confirmed on surface 2026-07-17)* Plan 020 exercises scout investigation, explicit promotion to ship authority, judgment, implementation, independent verification, acceptance, and explicit PR publication naturally. Session replacement, durable attention, fresh-context resume, AFK pause, stale revision, duplicate command, and cleanup are deliberate drills around the run. Deliberation/replanning is exercised only if a real material question emerges, otherwise in a separate bounded fixture.
44. **Non-material graph revision is autonomous.** *(R3, confirmed on surface 2026-07-17)* The coordinator may revise the execution graph inside the approved envelope without waking the owner; every revision is versioned and journaled. Ratification semantics, knowledge-promotion authority, and uncertain-materiality behavior remain open as their own Review Units.
45. **V1 uses one concise protocol with Run-specific execution shape.** Repository capabilities, Run intent, uncertainty, impact, reversibility, and available Human Attention resolve a Working Mode inside one Workflow Contract. PhotoQuest exercises evidence-dense delivery while embabel-me exercises hypothesis-driven exploration and direct human judgment; neither repository is forced through one universal loop.
46. **Execution graph, controller state machine, and Pi actors are distinct execution layers.** The workflow contract defines the run envelope; the execution graph represents variable semantic work; the controller state machine owns the fixed lifecycle, legal transitions, and graph revision; and coordinator, worker, and subagent profiles use addressable actor semantics with controller-routed dispatches, episode returns, explicit lifecycles, and no direct mutation of authoritative run state. This does not require a particular actor framework or expand V1 graph-mutation authority.
47. **Typed episodes are the universal execution return interface.** Every bounded Pi dispatch ends or pauses with a compact, provenance-bearing episode containing its outcome, claim status, evidence, mutations, decisions, authority needs, residual risks, and continuation reference. Episodes support context transfer but do not replace primary evidence, the ledger, or the Judgment Dossier.
48. **The execution graph remains semantic and coarse-grained.** Graph nodes represent variable meaningful work, dependencies, worker bindings, and evidence obligations. Fixed lifecycle gates exist only in the controller state machine. Searches, commands, tests, and tactical delegations remain episodes inside a node unless they independently affect authority, dependency structure, review independence, or completion evidence.
49. **One parameterized Pi execution primitive implements Broker, Coordinator, Worker, and Subagent profiles.** Scope, continuity, interaction mode, role, model, permissions, workspace, skills, inputs, independence, budget, and expected Episode schema are Dispatch fields rather than separate runtime implementations.
50. **Initial agent coordination is hub-and-spoke through episodes.** The coordinator dispatches bounded work and receives typed episodes. Deliberation is represented by linked claim, challenge, and response episodes. Peer worker mailboxes and open-ended worker conversations are not part of the initial implementation.
51. **Skills are resolved and activated per dispatch.** Only the relevant vendored core and adaptations enter an execution context, their exact versions are recorded in its episode, and their instructions leave active context when the episode ends unless resolved again.
52. **The coordinator is structurally non-mutating.** It never receives a project-workspace write lease. Deliverable repository mutation is possible only through a controller-approved ship dispatch in an isolated workspace; a scout may receive explicitly disposable scratch scope. Prompt instructions are not the authority mechanism.
53. **Dispatch authority is either scout or ship.** Scout and ship are authority and outcome shapes independent of coordinator, worker, and subagent execution profiles. A scout may investigate and produce evidence but cannot publish or authorize implementation. Separately authorized implementation promotes the existing work item to ship and preserves its evidence lineage.
54. **Current state is a deterministic projection, not an event interpretation.** Immutable semantic records and live execution observations feed the controller-owned reducer that produces the canonical run snapshot. Raw logs, terminal output, and model messages are evidence only; unresolved or contradictory observations produce `unknown`.
55. **Model attention is driven by durable actionable items.** The controller classifies lifecycle, timer, authority, evidence, and reconciliation events mechanically. It persists an attention item before acknowledging its source event and wakes a coordinator or owner only for an actionable condition; routine progress and duplicates consume no model turn.
56. **One control lease owns live mutation and supervision.** Exactly one controlling client may mutate a run. Other clients are read-only, and a healthy controller supervision loop must remain active while dispatches are in flight. This does not expand the confirmed V1 durability scope beyond the live controller host.
57. **All Run views consume one canonical projection.** Terminal summaries, portfolio and project attention, AFK digests, notifications, and the graphical attention client derive from versioned snapshots and Attention Items rather than parsing raw events or chats independently.
58. **V1 dispatch uses finite named execution profiles.** A repository package exposes a small, versioned set of profiles that resolve model requirements, effort, continuity, permissions, workspace kind, skills, independence, and episode schema. The coordinator selects a profile; the controller validates the resolved fields and rejects invented permission bundles.
59. **Workspace release is fail-closed.** A mutating workspace remains leased while it is dirty, unlanded, missing required evidence, or otherwise not cleanup-eligible. Release requires confirmed delivery, explicit authorized discard, or a sealed scout report that satisfies the workflow contract.
60. **V1 durable storage has three primitives.** A repository-associated, worktree-independent anchor stores one canonical `snapshot.json`, one append-only semantic `records.jsonl`, and immutable content-addressed objects. Raw runtime chatter remains ephemeral or referenced rather than becoming authoritative state.
61. **One schema registry governs the run protocol.** Commands, receipts, records, snapshots, dispatches, episodes, attention items, dossier revisions, and external receipts declare their producers, consumers, authority, evidence rules, size and retention budgets, and compatibility behavior. Unknown or incompatible types fail closed.
62. **Every dispatch receives a self-contained work packet.** It carries the semantic objective, revisions, authority shape, named profile, allowed capabilities and workspace, source-backed contracts, evidence, criteria, risks, verification obligations, exclusions, episode schema, and size budget. Repository policy may constrain packet scope without universal file-count or changed-line limits.
63. **The terminal surface has six concepts.** `run`, `status`, `decide`, `control`, `validate`, and `close` project the Run Controller interface. Internal decisions and actions remain typed, revision-checked, explicit, and idempotent even when several decision types share `decide`.
64. **Autonomous failure is bounded.** Each named execution profile has a finite attempt ladder. Exhausted attempts, repeated independent-review failure, staleness, workspace contamination, unknown outcomes, and exhausted authority or budget create one deduplicated durable attention item and pause affected work.
65. **Four deep modules define the initial implementation seams.** The Run Controller owns lifecycle and coordination behind `start`, `submit`, `inspect`, and `watch`; Pi Execution owns `dispatch`, `observe`, and `cancel`; Repository Workspace owns `lease`, `inspect`, `land`, and `release`; Artifact Store owns immutable `put`, `get`, and `pin` operations.
66. **V1 Ship execution has a concrete bounded contract.** A Ship Work Packet carries exact source-backed contracts, optional executable path scope, repository examples, exclusions, validation commands, and invalidation rules. Each successful Ship Episode returns a mutation receipt. Validation evidence is bound to the exact candidate workspace fingerprint, and the controller alone may land that fingerprint. The PhotoQuest pilot permits three implementation attempts per semantic slice and prefers one green, reviewable slice per commit; these are repository-profile policies rather than universal lifecycle rules.
67. **Attention brokerage has portfolio, project, and Run scopes.** The Portfolio Broker routes priorities and Human Attention across projects; a Project Broker coordinates capabilities, conflicts, and concurrent Runs in one repository; one Run Coordinator remains accountable for each owner-declared outcome. Higher scopes receive bounded Episodes from focused lower-scope interaction rather than complete conversations.
68. **Broker cooperation uses a fixed typed protocol.** Brokers may propose Runs, submit authorized starts and guidance, set priorities, inspect canonical projections, request prepared Review Surfaces, and request control transitions. Schemas and controllers enforce revisions, idempotency, and authority; system prompts describe behavior but do not constitute the protocol or grant authority.
69. **Working Mode is resolved rather than globally enumerated.** Outcome, repository capabilities, uncertainty, impact, reversibility, and available Human Attention determine alignment depth, interaction cadence, execution shape, evidence strategy, and stopping conditions. Named modes may emerge from run evidence but are not a universal maturity ladder.
70. **Outcome evidence governs planning and review.** The Coordinator seeks the shortest safe path to evidence that can confirm, disconfirm, or redirect the desired outcome. A quality loop is a bounded capability over declared claims, evidence, attempts, finding dispositions, and stopping conditions; it cannot continue merely until models stop finding improvements.
71. **Skills and capabilities resolve per Dispatch.** Harness availability flows through repository approval, the Run Working Mode, a named Execution Profile, and the Work Packet. A subordinate Dispatch does not inherit all parent skills, permissions, evidence, or context, and every Episode records the exact resolved capability versions.
72. **Logical Actors outlive disposable model sessions.** Broker, Coordinator, and Worker identity, scope, and accountability live in durable Workbench state and referenced Run state. Context rotation occurs at semantic synchronization points, and a fresh session reconstructs from canonical projections, material Episodes, Primary Evidence, and a validated Continuation Artifact rather than accumulated chat.
73. **Watching and context curation are separate responsibilities.** A deterministic non-model Watcher reconciles execution observations and creates actionable attention. A fresh Context Curator prepares source-backed continuation context independently of the actor being reconstructed; it cannot rewrite authoritative records or omit mechanically protected authority, decisions, disagreement, evidence, uncertainty, mutations, or pending attention.
74. **Human-facing state is interruption-resilient and decision-shaped.** The shell preserves focus, explains what changed, separates activity from action, and anchors feedback to exact revisions. Experimental and delivery results reach the owner through progressive Review Surfaces that state the judgment, recommendation, alternatives, consequences, reversibility, deferral behavior, representative evidence, contradictions, and available actions.

## Repository Policy Examples

### PhotoQuest

- Optimize rapid product iteration and observable production correctness.
- Treat wedding-critical paths as high impact.
- Require browser or Playwright evidence for user-facing behavior.
- Preserve reproducible failure evidence and production-relevant verification.

### Embabel work

- Optimize sophisticated design, learning, and value discovery before production.
- Invest more judgment in product, domain, and architecture decisions before and after implementation.
- Permit exploratory implementation with explicit residual risks.
- Promote durable architectural and domain decisions selectively.

## Provisional Decisions

1. **PI WEB and T3 Code are competing graphical-shell candidates.** Evaluate both through small adapters over the same Run protocol fixture. Neither shell may own authoritative Run state, reinterpret a Run as a native session or thread, or launch Pi through a shell-owned provider abstraction. Avoid a permanent fork until the adapter proves the required integration and its maintenance cost.
2. **Repository packages declare workflow capabilities.** They select policies, adapters, tools, validation commands, model roles, retention rules, and available surfaces.
3. **Model routing follows cognitive role and context shape within named profiles.** Repository profiles declare required capabilities, effort, independence, continuity, and permissions; Pi binds an available model when the profile resolves. Persistent workers preserve useful scope context, while subagents provide fresh independent judgment.
4. **Skill interfaces use progressive enhancement.** Every skill remains usable headlessly and through the terminal. The harness can generate and evolve a richer native surface without giving that surface ownership of workflow state or trust-sensitive controls.
5. **Runtime surface changes are run-local by default.** Proven improvements may be proposed for promotion into the vendored skill's shared default interface.
6. **Skill customization is layered.** The effective skill combines a vendored upstream core, reusable stack adaptation, repository overlay, and optional run-local refinement. Generic improvements can be promoted to a broader layer; repository-specific knowledge remains local.

## Deferred Beyond The Initial Workflow

- Multiple selectable workflow profiles.
- Personal and project-area workflow variants.
- Layered workflow resolution and conflict handling.
- Upstream workflow contribution.
- Automatic Workflow Contract selection across repository, environment, ownership, and task risk.
- Agent-generated project interfaces and full graphical presentation parity with the terminal.
- A PI WEB and T3 Code graphical-shell bake-off over the proven Run protocol.

## Deferred Design Decisions

1. **Compounding authority:** whether every knowledge or workflow candidate requires owner approval or narrowly scoped candidates may be promoted automatically under repository policy.
2. **Analysis cadence:** whether cross-run analysis is periodic, threshold-triggered, or explicitly started by the owner in addition to per-run analysis.
3. **Retention defaults:** which artifacts the first workflow retains, promotes, or deletes.
4. **Protocol details:** the exact schema fields, compatibility rules, and sealing representation for commands, semantic records, events, and artifacts.
5. **Model binding:** whether workflow definitions pin exact models or declare role capabilities that a repository policy resolves at dispatch.
6. **In-progress graph mutation:** the exact allowlisted mutation classes for semantic nodes that already have active or completed episodes.
7. **Ratification semantics:** whether dossier ratification means a stable synthesizer-owned revision distinct from human approval, or whether every ratified snapshot must be human-approved.
8. **Skill interface scope:** which common interaction concepts belong in the stable harness interface and which remain skill-specific extensions.
9. **Interface generation moment:** whether adding a skill automatically creates a draft enhanced surface or generation begins only on first use or explicit request.
10. **Surface promotion:** how a successful runtime adaptation becomes part of the shared skill interface rather than remaining run-local.
11. **Skill overlay representation:** how upstream, stack, repository, and run-local adaptations are stored and resolved.
12. **Broker durability:** how project and portfolio projections, proposals, priorities, and Broker continuation references are represented durably while each Run ledger remains authoritative for its own execution.
13. **Working Mode resolution:** the exact input schema, owner override, recommendation behavior, and validation rules for resolving alignment, interaction cadence, execution shape, evidence strategy, and stopping conditions inside the single Workflow Contract.
14. **Context rotation:** the exact Continuation Artifact schema, size budgets, pressure thresholds, protected fields, and reconciliation checks used when replacing a model session.
15. **Graphical attention contract:** the exact interaction schemas for focus restoration, changes-since-last-judgment, revision-aware feedback, progressive Review Surfaces, and scoped conversation.

## Resume Brief

The initial implementation uses one fixed controller lifecycle around a revisable semantic work graph, one controller-owned canonical projection, typed Pi Episodes, durable actionable attention, Portfolio and Project Brokers, one accountable Coordinator per Run, scout and ship authority shapes, finite named Execution Profiles, fail-closed workspace leases, disposable model sessions reconstructed from Continuation Artifacts, and worktree-independent snapshot/records/object storage. Terminal operation is organized around `run`, `status`, `decide`, `control`, `validate`, and `close`; the minimal graphical client exposes portfolio attention, project and Run workspaces, revision-aware evidence, scoped conversation, and Working Mode over the same protocol.

The pilot is PhotoQuest plan 020 plus controlled drills for session replacement, durable attention, fresh-context resumption, AFK authority pause, stale decisions, duplicate publication, workspace integrity, concurrent Run projection, interruption-resilient graphical review, and cleanup. The second V1 repository package is embabel-me, which exercises hypothesis-driven exploration, experimental comparison, direct human judgment, and outcome-directed review over the same lifecycle and protocol.

Graphical shell selection remains provisional. PI WEB and T3 Code must consume the same framework-neutral Run client contract; a direct Pi provider connector inside T3 Code is outside the intended architecture because Pi Execution remains a controller-owned deep module.

Remaining decisions concern compounding authority, cross-Run analysis cadence, retention values,
exact schema fields and sealing representation, concrete model binding, in-progress graph mutation
classes, dossier ratification, Broker durability, Working Mode resolution, context rotation,
graphical attention contracts, and post-V1 skill-interface and generated-surface details.
