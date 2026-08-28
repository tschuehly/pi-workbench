# Pi Workbench decisions

Status: evolving decision record. This file owns settled current and intended behavior; every
unimplemented decision states that boundary explicitly.

Decisions describing the unbuilt Run Controller, execution graph, and managed Run moved to [Level 4 concepts](../research/level-4-concepts.md) on 2026-08-26. They keep their original numbers, so the gaps below are expected and every existing reference stays valid.

## Objective

Create a Pi-based project workbench that allocates Human Attention across concurrent Workstreams and project Runs and adapts Working Mode, tools, verification, and Review Surfaces to repository capabilities, desired outcome, uncertainty, operational risk, reversibility, and available attention. The Workbench client operates typed protocols without owning their durable state and reuses PI WEB below its application shell.

## Research evidence

- [Pi ecosystem](../research/sources/pi-ecosystem.md)
- [Pi package catalog evaluation](../research/sources/pi-package-evaluation.md) and [generated package index](../research/generated/pi-packages-index.md)
- [Pi subagent implementation evidence](../research/sources/subagent-implementations.md)
- [Subagent/worker monitoring and communication](../research/sources/subagent-worker-monitoring-and-communication.md)
- [PhotoQuest Ralph](../research/sources/photoquest-ralph.md)
- [AIHero](../research/sources/aihero.md)
- [AI Engineer wiki](../research/sources/ai-engineer-wiki.md)
- [Recent repositories](../research/sources/recent-repositories.md)
- [Model-routing field notes](../research/sources/model-routing-x.md)
- [Prompt-cache economics](../research/sources/prompt-cache-economics.md)
- [DODOREACH Pi tool-shaping](../research/sources/dodo-reach-pi-tool-shaping.md)
- [Current Quality Loop](../research/sources/current-quality-loop.md)
- [Skill interface](../research/sources/skill-interface.md)
- [Slate](../research/sources/slate.md)
- [FirstMate](../research/sources/firstmate.md)
- [Brigade](../research/sources/brigade.md)
- [T3 Code](../research/sources/t3code.md)
- [Multidimensional Working Mode proposal](../research/reports/multidimensional-working-mode-proposal.md) — withdrawn on 2026-08-26; Decision 69 later admitted only the Alignment axis justified by observed failure beside Checking, while [Working Mode](working-mode.md) keeps all other dimensions deferred
- [Agent-usage session audit](../research/reports/agent-usage-session-audit-2026-08-27.md) — evidence that attended work can cross a product and architecture commitment boundary despite strong Checking
- [Model evaluation campaign proposal](../research/reports/model-evaluation-campaign-proposal.md) — proposed controlled model, effort, skill, and harness comparisons; not authoritative behavior

## Agreed Decisions

**You do not need to read this file.** The [README](../../README.md) is written for you; this is
context an agent loads on demand. It is grouped so that when you do need to check something, you
can read one group of five instead of forty.

Numbers are original and permanent. Gaps mean a decision moved to [Level 4
concepts](../research/level-4-concepts.md) because it describes behavior that does not exist.

### Scope — what is and is not built

Read these five if you only read one group. They separate the implemented attended workflow from
the next intended Working Mode control and from unbuilt managed execution.

24. **V1 grows through usable attended client slices.** *(Owner-revised on 2026-08-28; supersedes the PI WEB Workstream vertical-slice framing.)* The first graphical slice is one Pi Chat per macOS window with two owner-selected checkpoints: first a proper graphical composer, then a toggleable workspace file viewer/editor beside Chat. The editor rejects stale saves rather than silently overwriting newer agent or external changes. Workstreams retain their typed Store and temporary terminal interface until observed use justifies their graphical slice.
45. **V1 uses the concise Workstream protocol.** Repository-specific managed Working Modes and Workflow Contracts are outside V1.
79. **Operating Levels are retired.** *(Owner-settled on 2026-08-27; replaces the 2026-08-26 preset design.)* Pair, Agree, Contract, and Manage no longer bundle unrelated behavior or act as user controls. Working Mode exposes only independent axes justified by observed need. Historical plan, evidence, and code names containing “Level 1” retain provenance but define no current domain concept. Current launch prompts still using that phrase remain implementation debt in the Working Mode plan rather than authoritative vocabulary.
80. **V1 is an attended human–Pi workflow.** *(Owner-confirmed during attended design on 2026-08-10; terminology revised 2026-08-27.)* One human pairs with one interactive lead Pi under continuous Human Attention. The lead may launch bounded ephemeral child Pi processes as visible, cancellable tool activity and remains accountable for reconciliation. A child may run non-blocking in the background only inside the attended lead session and must be observed, collected, or cancelled there; Decision 98 defines its sole synthetic terminal-completion turn, and no execution survives session shutdown. Correcting an assignment requires cancellation and a new child invocation because V1 does not attach messages to a running child. In-session backgrounding grants no unattended authority, durable execution, or managed recovery.
82. **The current V1 has no implemented Working Mode control.** *(Revised 2026-08-28.)* Sessions remain ordinary attended Pi sessions without an Alignment selector, persistent mode display, or mechanical mutation gate. Working Mode may be stated as prompt guidance in conversation. The owner-confirmed intended behavior is specified in [Working Mode](working-mode.md); the [Working Mode plan](../plans/working-mode.md) requires evidence from prompt-guided use before any extension, state model, persistence, or interface is approved.

### Working with Pi — mode, models, delegation

How you control Pi's behavior, how models are picked, and what a delegated child Pi may and may not do.

7. **Model workers are role-specific.** Claude, Codex, and other models are selected together with task, tools, permissions, reasoning budget, and review role.
25. **Pi is the only model-worker harness.** Planning, implementation, review, and verification agents run as Pi sessions or Pi processes. Claude, Codex, and other models are selected inside Pi; the workflow does not launch Claude Code, Codex CLI or app-server, or a CLI proxy.
69. **Working Mode has independent Alignment and Checking axes.** *(Owner-revised on 2026-08-28; replaces both the 2026-08-26 Operating Level design and the 2026-08-27 read-only Discovering design.)* `Alignment: Vibe | Align | Plan | Spec` controls how much Shared Understanding the owner judges at once: Vibe is normal collaboration in chat; Align is a prompt-guided trial before one unconfirmed product, architecture, scope, or quality choice becomes durable implementation or parallel work; Plan requires accepted whole-task direction; and Spec requires accepted behavior, constraints, and acceptance evidence while implementation strategy remains adaptive. `Checking: light | tests | adversarial` independently states the minimum completion evidence, with no universal default. A new context starts in Vibe; prior-choice restoration is outside the current design. Working Mode creates no durable plan file, configures behavior rather than permission, and has no mechanical mutation gate. Human Attention and delegation remain separate rather than additional axes. Selection and persistent presentation are not implemented; Decision 82 records current behavior and the [Working Mode plan](../plans/working-mode.md) keeps implementation deferred pending observed evidence. If repository configuration is later adopted, its committed path is `.pi-workbench/config.json`; its schema, format, and adoption remain deferred. See [Working Mode](working-mode.md).
78. **Pi execution supports both interactive continuity and ephemeral delegation.** An interactive lead uses a Pi session hosted by PI WEB. A bounded Subagent receives one Dispatch and returns one Episode, while a resumable Worker may receive later controller-mediated Dispatches under the same Logical Actor identity. Follow-up interaction never bypasses controller validation or turns a Pi session into authoritative Run state. An unmanaged adapter may preserve a local Pi session but cannot claim Run authority, workspace rights, or controller-mediated status.
81. **V1 model binding may cover the interactive lead and bounded children.** Model and Model Effort may vary by Cognitive Role without changing the attended V1 posture. Child bindings grant no durable actor identity, workspace rights, or managed authority.
87. **Attended child execution uses a Workbench-owned Pi adapter.** `packages/pi-execution-adapter/` owns resolved Pi RPC launch, normalized observation, cancellation, timeout, and cleanup behind `dispatch`, `observe`, and `cancel`; `extensions/subagent/` remains a thin attended tool and presentation adapter. One tool invocation launches one fresh child process for one bounded assignment. The implementation reuses no external package's workflow, authority, worktree, or ledger.
88. **Attended child model binding is explicit and fail-closed.** The parent supplies a bundled child profile and Cognitive Role, never a model. The thin tool adapter resolves a fresh provider-qualified model and Model Effort through the harness routing policy; Pi Execution accepts only that resolved binding, verifies the launched runtime, and performs no silent fallback. Children receive fresh self-contained assignments rather than parent transcript forks.
89. **Attended child sessions are inspectable but unmanaged.** Pi persists child sessions in its standard machine-local store and the result retains the session identifier, but V1 never automatically resumes a failed child. Children share the attended parent's local trust boundary: Pi tool allowlists are enforced, while filesystem, process, and network sandboxing remain explicitly absent. No child outlives the attended parent.
93. **Attended durable workers are identity plus a resumed session, never a waiting process.** `packages/worker-registry/` records machine-local worker identity, scope, repository binding, session lineage, and bounded receipts; each worker action is one bounded attended dispatch that resumes the recorded Pi session with a fresh verified binding. One dispatch at a time per worker, dead-owner locks are reclaimed only after liveness verification, Independence roles remain subagent-only, and retirement is immutable. Worker identity survives the attended session while execution never does; no Run authority, workspace lease, or managed recovery is granted.
98. **An explicitly backgrounded attended child may wake its lead once on terminal completion.** *(Owner-approved on 2026-08-11; scoped clarification of Decision 80's continuous-Human-Attention boundary.)* After a background Subagent reaches a typed terminal outcome, or after a background Worker reaches that outcome and its registry receipt settles and dispatch lock releases, the Subagent extension may send one deduplicated bounded `followUp` message with `triggerTurn: true`. If a background Worker receipt cannot settle, one separately deduplicated bounded `outcome_unknown` attention wakeup may report that failure without claiming lock release; a foreground receipt failure returns `outcome_unknown` directly. The message identifies the execution and outcome but retains the result behind `subagent_collect`; it asks the lead to collect and reconcile exactly once. An active collection suppresses a not-yet-sent wakeup and re-arms it if collection detaches before terminal; explicit cancellation and session shutdown suppress late wakeups. The synthetic turn grants no retry, relaunch, Acceptance, Publication, durable execution, or managed recovery authority. Periodic cache pings remain unapproved.
99. **Attended system guidance prefers background execution for delegated Subagents and Worker dispatches.** *(Owner-approved on 2026-08-11.)* The extension's system-prompt guidance tells the lead to set `background: true` for most delegated work so Human Attention remains available and Decision 98 can wake the lead at terminal completion. Foreground blocking remains an explicit exception when the child result is the immediate dependency and no useful lead work or attended response can continue before it returns. This is prompt guidance, not a mechanical default, scheduler, durable lifetime, or authority expansion. The lead still reconciles every background result, and cache-retention economics remain subject to measurement.
101. **Task consequence may constrain the selected Checking floor and sizes independent fan-out.** *(Owner-approved on 2026-08-27; terminology revised after Decision 69.)* The owner always chooses Checking; until the control ships, that choice exists only as prompt guidance stated in conversation. Explicit owner direction, repository policy, or the consequence of a wrong conclusion may reject an insufficient choice: medium consequence requires one independent judgment or challenge; high consequence requires two parallel challengers from distinct non-author model families; critical consequence adds independent review at the evidence-bearing boundary and separate synthesis. Parallel judges receive the same claim and Primary Evidence with distinct lenses, cannot see one another's answers before synthesis, and never substitute for deterministic evidence. Missing required families or quota blocks the panel rather than silently reducing it. This is promptable intended behavior; the current router cannot enforce a multi-family panel until policy, resolver, launcher, and tests accept explicit judge-family selection.

### Workstreams — attention across sessions

How leaving and coming back works: what is stored, what is projected, and what is never claimed.

33. **The core Workstream interface is the Workstream Store.** Its six operations, deterministic projection, typed client transport, attended session association, automatic correctable checkpoints, and restart behavior define the implemented continuity module. The graphical client may arrive in a later slice; managed lifecycle and execution interfaces remain unbuilt concepts.
42. **V1 durability covers sessions and Workstreams across client replacement.** Replacing a browser window or Workbench web client does not restart PI WEB's session daemon; session launch and Workstream observation reconcile after reconnect. Automatic model-session replacement, machine loss, portable cross-machine handoff, and controller recovery are outside V1.
83. **Workstreams provide finite cross-session attention continuity.** *(Revised on 2026-08-28 for the standalone Chat slice.)* A user-local Workstream may span repositories, contain several concurrent interactive sessions, retain Human Tasks, and link files, artifacts, and managed Runs. A session may remain a standalone Chat; once associated, it has exactly one home Workstream. A Workstream grants no Run authority or managed recovery guarantee.
84. **Workstream persistence is sparse and split from current state.** Agents append concise semantic records only at meaningful attention changes. A separate mechanical projection exposes each session's latest checkpoint, unresolved human tasks, links, and closure state; raw transcripts, routine activity, and repeated combined summaries are excluded.
85. **Checkpoints persist automatically; closing a Workstream requires a human.** *(Owner-revised on 2026-08-26; supersedes the prior attended-confirmation rule.)* The active Pi session writes a checkpoint directly when meaningful attention changes, without waiting for the owner to confirm each field. A checkpoint is a correctable projection of where the work stands, so the cost of a wrong one is an edit, not a loss — and requiring confirmation reliably produced stale checkpoints instead of accurate ones. The owner may correct or replace any checkpoint afterwards, and a later checkpoint supersedes an earlier one. Closure stays explicit and human-instructed because it ends the Workstream's active life. The owner inspects Workstream projections directly without FirstMate, and V1 still launches no watcher-triggered or fresh-context checkpoint turn.
86. **Workstream closure preserves context without forcing cleanup.** Completed Workstreams remain closed; later work on the same topic starts a new linked Workstream. Pi Workbench recommends resolving tasks and scratch files but does not block closure or delete files without human confirmation.
90. **Failed launches and stale checkpoints are explicit Workstream state.** A failed launch remains in the canonical projection with its checkout anchor and provenance. Checkpoint staleness changes only through a typed record naming the latest confirmed checkpoint and clears only on confirmed replacement; no client infers either state from conversation or tool activity.
91. **Durable Human Task answers are separate from live session asks.** An answerable task declares its answer kind, options, source session, and materiality. Revision-checked answer records preserve the answer and receipt. No client implicitly copies or atomically combines a live `ask_user` submission with a Workstream answer.
94. **Standalone Chats preserve explicit ownership.** *(Partially activated and trial direction revised by the owner on 2026-08-28.)* A new standalone Chat is PI WEB-runtime session state and requires a complete location; it is not automatically a Workstream. Promotion, standalone-session linking or unlinking, and rename remain inactive until a later Workstream client slice lands their exact contract, schema, Store behavior, and reconciliation. Ordinary typed Workstream reference links remain supported. Any future promotion preserves the native session identity and creates exactly one Workstream home through an idempotent operation. The separately approved `Reconcile and End` trial may later add a session-local owner-facing Session Summary for someone returning to the same Pi session. It is unimplemented, is not read automatically for next-day re-entry, and does not replace the canonical Workstream checkpoint used by a fresh session.
96. **Attended Workstream session creation uses one host-neutral coordinator.** Candidate inspection, prompt framing, pending-before-create ordering, confirmation, cancellation, known failure, revision retry, and owning-host reconciliation live in `packages/workstream-session-coordination/`. PI WEB supplies an adapter and any future terminal client must supply its own; the Workstream Store remains limited to durable records and deterministic projection.

### The graphical client

What the client owns and, more importantly, what it must never own. The replacement is not implemented; see the README.

1. **Stable client, bounded dynamic surfaces.** As each slice arrives, the client keeps trust-sensitive controls such as identity, permissions, run control, recovery, workspaces, and notifications outside agent-generated project surfaces.
4. **The Workbench client reuses PI WEB below the application shell.** *(Owner-revised on 2026-08-28.)* PI WEB retains the server, session daemon, transport, and useful leaf client modules. Pi Workbench owns the user-facing composition and adds protocol interactions one usable slice at a time; no client owns workflow state.
74. **Human-facing state is interruption-resilient and decision-shaped.** The shell preserves focus, explains what changed, separates activity from action, and anchors feedback to exact revisions. Experimental and delivery results reach the owner through progressive Review Surfaces that state the judgment, recommendation, alternatives, consequences, reversibility, deferral behavior, representative evidence, contradictions, and available actions.
75. **Delivered attention surfaces are attention-first by default.** *(Revised on 2026-08-28; the first Chat slice has no cross-session attention surface.)* When an attention slice arrives, it answers what needs the owner's judgment now, separates required action from work progressing independently, and makes completed outcomes and re-entry state visible. Each focused Attention Item leads with the required judgment, materiality, recommended response, consequences, deferral behavior, and typed actions before progressively disclosing evidence.
76. **Workbench client usefulness precedes upstream generalization.** *(Owner-revised on 2026-08-28 after the bounded plugin became a second shell.)* Build the smallest usable client in the PI WEB fork and reuse internal modules directly while the product seam is being proven. Extract or upstream a generic seam only after repeated fork conflict or a second real client demonstrates the need.
92. **The first Workbench client root is an input-first Chat composition.** *(Owner-revised on 2026-08-28.)* The existing AppKit wrapper hosts one selected Chat per window. The web client first reuses PI WEB's graphical Prompt Editor, then adds a toggleable right-hand file viewer/editor adapted to a narrow file-only context. Shell profiles, plugin-owned navigation, the broad workspace panel context, and the registry-driven Pi menu are legacy evidence rather than the target composition.
95. **The unified-shell candidate is stopped and archived.** *(Owner-revised on 2026-08-28.)* Its controlled-session harness, runtime isolation, complete session identity, reconnect checks, and typed Workstream mechanics remain reusable evidence. The separately routed Workstream Store lock-recovery experiment retains approval because durable-worker locking still depends on its finding. The file viewer/editor is the first archived capability returned to scope by explicit owner direction after current terminal work exposed the need; this does not reactivate shell fidelity, unified navigation, continuation UI, message-tree, child-card, installation, or release phases.

### The harness and skills

How this repository distributes itself and its Pi capabilities.

34. **The harness is distributed as one cloneable Git repository.** It carries the shared Pi runtime package, orchestration capabilities, curated skills, prompts, adapters, configuration, provenance, and bootstrap checks needed to reproduce the supported development environment.
35. **The distribution vendors skills and provisions external tools.** Shared skills, Pi extensions, prompts, small adapters, and required resources live in the harness repository with provenance. External executables and services are versioned capabilities; credentials, subscriptions, and machine-specific state remain local.
37. **Skills are first-class harness capabilities.** Skills are optimized for the harness and can expose structured progress, decisions, artifacts, inputs, and outputs through harness-owned interfaces, while the harness preserves their portable agent behavior.

### Evidence and quality

What makes a result trustworthy, and what an unattended run may assume.

27. **Run analysis and compounding are workflow requirements.** Every run must evaluate both delivered outcomes and orchestration behavior, then extract source-backed candidates for reusable project knowledge and workflow improvement before retention and cleanup decisions.
70. **Outcome evidence governs planning and review.** The Coordinator seeks the shortest safe path to evidence that can confirm, disconfirm, or redirect the desired outcome. A quality loop is a bounded capability over declared claims, evidence, attempts, finding dispositions, and stopping conditions; it cannot continue merely until models stop finding improvements.
97. **Bounded non-agent model queries use Stateless Model Calls.** *(Owner-approved candidate on 2026-08-10; terminology renamed by the owner on 2026-08-11; not active behavior until the utility, routing gate, receipt, and tests in Experiment 1a land.)* The initial path is an out-of-process Workbench utility whose host owns one injected `ModelRuntime` and calls `completeSimple()`; a Pi extension never constructs another runtime in-session, and direct `ctx.modelRegistry.complete()` remains deferred until Pi exposes equivalent Model Effort mapping or Workbench proves a fail-closed mapper. Each call declares the `mechanics` Cognitive Role and resolves its provider-qualified model, Model Effort, and quota admission immediately before invocation through the harness routing policy; bindings are not reused, and fresh exhaustion, missing bindings, and response-binding mismatch fail closed. The utility permits one provider dispatch with retries and deferred responses disabled, without an AgentSession, tools, Continuity, or actor identity; it owns bounded input and output plus an abort deadline. Its receipt carries the resolved binding including effort, returned provider/model metadata, quota admission, outcome, usage, and input-evidence references. An attending caller exposes that bounded receipt in tool-result details so the session can evaluate it. A Stateless Model Call may summarize or classify already gathered evidence for optional presentation, but never gates a transition, substitutes for a mechanically decidable fact, grants authority, or mutates canonical state. Work requiring tools, iteration, durable context, Independence, or semantic execution remains a Subagent, Worker, or managed Dispatch.
100. **Continuous AFK production defaults to an ordinary Goal with controller-owned safety.** *(Owner-confirmed after the 2026-08-12 AFK retrospective.)* The project controller owns resumability, idempotency, concurrency, artifact acceptance, and terminal settlement. Goal orchestration states the outcome, authority bounds, deadlines, and final audit without imposing per-phase review, checkpoint, compaction, or reviewer-recovery loops. `execute-plan-afk-goal` remains experimental and may return only as a thin plan-to-Goal launcher; reviewer unavailability blocks the affected acceptance decision, not unrelated reversible queue work. See the [AFK Goal session retrospective](../research/reports/afk-goal-session-retrospective-2026-08-12.md).

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

1. **Repository packages declare workflow capabilities.** They select policies, adapters, tools, validation commands, model roles, retention rules, and available surfaces.
2. **Model routing follows cognitive role and context shape within named profiles.** Repository profiles declare required capabilities, effort, independence, continuity, and permissions; Pi binds an available model when the profile resolves. Persistent workers preserve useful scope context, while subagents provide fresh independent judgment.
3. **Skill interfaces use progressive enhancement inside delivered Workbench client slices.** Skills remain executable by Pi, while graphical interactions arrive only when their slice is useful and never own workflow state or trust-sensitive controls.
4. **Runtime surface changes are run-local by default.** Proven improvements may be proposed for promotion into the vendored skill's shared default interface.
5. **Skill customization is layered.** The effective skill combines a vendored upstream core, reusable stack adaptation, repository overlay, and optional run-local refinement. Generic improvements can be promoted to a broader layer; repository-specific knowledge remains local.
6. **Advanced Workbench attention remains gated.** V1 rejects a model-prepared combined Workstream brief, keeps bounded child Pi execution in Chat tool activity until structured parent/child metadata exists, and defers browser/OS escalation until a typed materiality and notification-deduplication policy is approved.

## Deferred Beyond The Initial Workflow

- Multiple selectable workflow profiles.
- Personal and project-area workflow variants.
- Layered workflow resolution and conflict handling.
- Upstream workflow contribution.
- Automatic Workflow Contract selection across repository, environment, ownership, and task risk.
- Agent-generated project interfaces beyond the initial PI WEB surfaces.

## Deferred Design Decisions

1. **Compounding authority:** whether every knowledge or workflow candidate requires owner approval or narrowly scoped candidates may be promoted automatically under repository policy.
2. **Analysis cadence:** whether cross-run analysis is periodic, threshold-triggered, or explicitly started by the owner in addition to per-run analysis.
3. **Retention defaults:** which artifacts the first workflow retains, promotes, or deletes.
4. **Protocol details:** the exact schema fields, compatibility rules, and sealing representation for commands, semantic records, events, and artifacts.
5. **Model binding:** whether workflow definitions pin exact models or declare role capabilities that a repository policy resolves at dispatch.
6. **Graph mutation and materiality:** the exact allowlisted mutation classes for semantic nodes that already have active or completed Episodes, and how the controller handles a proposed mutation whose materiality cannot be established mechanically.
7. **Ratification semantics:** whether dossier ratification means a stable synthesizer-owned revision distinct from human approval, or whether every ratified snapshot must be human-approved.
8. **Skill interface scope:** which common interaction concepts belong in the stable harness interface and which remain skill-specific extensions.
9. **Interface generation moment:** whether adding a skill automatically creates a draft enhanced surface or generation begins only on first use or explicit request.
10. **Surface promotion:** how a successful runtime adaptation becomes part of the shared skill interface rather than remaining run-local.
11. **Skill overlay representation:** how upstream, stack, repository, and run-local adaptations are stored and resolved.
12. **Broker durability:** how project and portfolio projections, proposals, priorities, and Broker continuation references are represented durably while each Run ledger remains authoritative for its own execution.
13. **Context rotation:** the exact Continuation Artifact schema, size budgets, pressure thresholds, protected fields, and reconciliation checks used when replacing a model session.
14. **PI WEB attention schemas:** the exact wire fields and client-specific interaction details for the established attention entry, focus restoration, changes-since-last-judgment, revision-aware feedback, progressive Review Surfaces, and scoped conversation contract.
15. **Validation boundary:** the exact split between mechanically enforceable controller invariants and provenance-bearing human or model judgment attestations for materiality, evidence sufficiency, Independence in substance, and Judgment Dossier completeness.
16. **Terminal-extension compatibility in PI WEB:** whether PI WEB should emulate enough of Pi's TUI contract to run existing `ctx.mode === "tui"` extension paths unchanged, beginning with the `pi-goal` manager. A virtual component host appears feasible, and `pi-tui-kit` already separates declarative menus from TUI/RPC adapters, but globally claiming TUI mode could activate unsupported assumptions in unrelated extensions. Defer implementation until a bounded experiment defines the capability claim and verifies component rendering, keyboard input, nested dialogs, resize, reconnect, cancellation, and disposal without making extension state authoritative in PI WEB. See the [Pi ecosystem evidence ledger](../research/sources/pi-ecosystem.md).
17. **Child-execution cache posture:** how attended leads keep 10-minute-plus subagent and worker dispatches affordable after Decision 99 made background-first launch guidance the owner preference — whether long cache retention (`PI_CACHE_RETENTION=long`) becomes the default lead posture, which immediate-dependency cases should remain foreground exceptions, whether children expected to outlast the retention TTL must dispatch immediately after a checkpoint, and whether environment or skill guidance should supplement the extension's background-first prompt. A blocked foreground dispatch issues no parent requests, so the parent cache always expires under short retention; mid-call recap reporting is mechanically impossible, and periodic status polls beat one miss only for children under roughly fifty minutes. Candidate cache policy remains Recommendation 7 in [prompt-cache economics](../research/sources/prompt-cache-economics.md); use measured cache-miss evidence (`showCacheMissNotices`) before changing cache-retention defaults or adding periodic pings.
