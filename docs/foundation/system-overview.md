# Pi Workbench system overview

> **Status:** Evolving specification. This document defines the system shape and routes readers to
> authoritative contracts. Exact schema fields and implementation details remain subject to pilot
> validation.

Pi Workbench V1 is an **attended human–Pi workflow** for allocating Human Attention across
interactive Workstreams. The graphical client is intended to reuse PI WEB runtime and selected
leaf modules while replacing its application shell. Managed Runs, the Run Controller, workspace
isolation, durable execution, and Working Mode controls are not implemented.

Use the [vocabulary](vocabulary.md) for canonical language, [principles](principles.md) for
system-wide design rules, [requirements](requirements.md) for V1 outcomes and validation, and the
[decision record](decisions.md) for settled trade-offs.

## Current, intended, and unbuilt

| State | System boundary |
| --- | --- |
| **Current** | The terminal is the working surface. V1 supports standalone and Workstream-associated Pi sessions, typed Workstream operations, attended bounded child execution, and automatically persisted correctable checkpoints. |
| **Intended V1 client** | One complete Pi Chat per macOS window, first with a graphical composer and then a toggleable workspace file viewer/editor. The client remains non-authoritative. |
| **Intended Working Mode** | Prompt-guided `Alignment: Vibe / Align / Plan / Spec` and independent Checking. No selector, persistence, visible display, or mechanical mutation gate is implemented; prior-choice restoration is outside the current design. |
| **Unbuilt managed system** | Run Controller, managed execution, enforced workspace isolation, durable Run state, unattended execution, and controller-mediated recovery. |

Working Mode configures behavior, never permission. The managed architecture remains documented so
the attended workflow does not accidentally claim its guarantees. Historical managed-system
decisions are collected in [Level 4 concepts](../research/level-4-concepts.md).

## Why the system exists

Development work spans agent conversations, IDEs, terminals, worktrees, repository files,
collaboration systems, continuous integration (CI), and generated review artifacts. These tools
expose activity but do not provide one trustworthy lifecycle for local agent work.

Human Attention is scarce. Continuous supervision wastes it; unattended work becomes unsafe when
intent, authority, evidence, and recovery depend on chat history. Model Context is also scarce:
broad histories, standing instructions, and one model for every Cognitive Role make work slower
and less reliable.

Pi Workbench must let models perform more bounded work without hiding who owns judgment, which
mutations are authorized, what evidence supports a result, or how work resumes after context loss.

## V1 product model

Pi is the only model-worker harness. One human works directly with one interactive lead Pi under
continuous Human Attention. The lead may launch bounded, ephemeral child Pi processes as visible
attended tool activity and remains accountable for their assignments and results. A child may run
non-blocking only within its attended lead session; no child execution survives session shutdown.

Delegation nests exactly one level: lead → durable Worker → leaf Subagent. A `coordinator` Worker
holds one scope's context and delegates its work to fresh leaf Subagents, while leaf profiles receive
no delegation tool, so recursion terminates. A nested leaf must run in the foreground and settle
before its Worker dispatch returns; cancelling a Worker removes its uncollected leaves, and
cancelling one leaf leaves its Worker alive. This is workflow containment rather than a sandbox:
`bash` stays inside the attended local trust boundary, so unsupported deeper nesting is detected
through telemetry and hierarchy evaluations, not shell interception.

A Chat may remain standalone or be associated with exactly one user-local Workstream. A Workstream
lets the owner leave and resume without treating chat history as current state. It may span
repositories and contain several concurrent interactive sessions, Human Tasks, files, artifacts,
and links to managed Runs, but it grants no managed authority or recovery guarantee.

The graphical Workbench client reuses PI WEB's server, session daemon, transport, and selected leaf
UI modules without adopting the existing application shell. The first slice is one Chat per macOS
window. Workstreams remain available through their typed protocol and temporary terminal skill
until observed use justifies a graphical slice.

## Workstreams and attention

A Workstream is the owner's finite cross-session attention container. Its sparse ledger preserves
source events at meaningful attention changes. A separate deterministic projection exposes active
sessions, latest checkpoints, unresolved Human Tasks, links, revisions, and closure without
persisting a combined narrative, raw transcripts, routine activity, or linked file contents.

The active Pi session writes a checkpoint automatically when attention changes meaningfully. The
owner may correct it afterwards; a later checkpoint supersedes an earlier one. Closing a
Workstream requires explicit human instruction and preserves unresolved context without deleting
files.

The owner currently inspects Workstream projections through the terminal skill. A later graphical
slice will present the same canonical projection directly. No FirstMate or other model broker
performs portfolio synthesis.

## Managed Run model (unbuilt)

A managed Run is one durable pursuit of an owner-declared outcome. Every managed Run uses the fixed
controller lifecycle:

`intake → judgment → authority → execution → verification → acceptance → publication → close`

The lifecycle defines when judgment, authority, mutation, verification, Acceptance, Publication,
analysis, and cleanup are valid. A Pi Coordinator organizes only the variable semantic work inside
that envelope through a revisioned Semantic Execution Graph. Models may propose graph changes; the
controller validates them and performs side effects.

Before autonomous mutation, the owner approves Shared Understanding and the Autonomy Envelope. The
owner supplies In-Run Judgment only for Material Questions and judges the realized outcome through
a task-shaped Review Surface. Acceptance and Publication remain separate actions even when one
owner interaction authorizes both.

### Managed attention scopes

The managed model separates three accountability scopes:

- A **Portfolio Broker** routes priorities and Human Attention across projects.
- A **Project Broker** coordinates repository capabilities, conflicts, and concurrent Runs.
- A **Run Coordinator** remains accountable for one Run's semantic work, evidence, and synthesis.

Brokers do not own Run lifecycle state. Focused work returns bounded Episodes rather than complete
lower-scope transcripts. Pending judgment blocks only affected work when independent authorized
work can continue.

## Deep modules

Five deep modules contain trusted behavior. Only the Workstream Store serves the current V1
continuity workflow; the managed modules define unbuilt boundaries.

| Module | Small interface | Owns |
| --- | --- | --- |
| [Workstream Store](../contracts/workstreams.md) | `create`, `append`, `inspect`, `list`, `watch`, `close` | Sparse cross-session ledgers, current projections, session association, and closure |
| [Run Controller](../contracts/controller.md) | `start`, `submit`, `inspect`, `watch` | Lifecycle reduction, commands, canonical projections, attention, dispatch coordination, and reconciliation |
| [Pi Execution](../contracts/execution.md) | `dispatch`, `observe`, `cancel` | Pi actors, Work Packets, Episodes, model execution, continuity, and cancellation |
| [Repository Workspace](../contracts/controller.md#repository-workspace-module) | `lease`, `inspect`, `land`, `release` | Deterministic workspace isolation, mutation inventory, landing, and cleanup eligibility |
| [Artifact Store](../contracts/controller.md#artifact-store-module) | `put`, `get`, `pin` | Immutable content-addressed evidence and retention metadata |

The [Workstream contract](../contracts/workstreams.md) owns V1 cross-session attention, sparse
ledgers, attended checkpointing, and closure. The [interface contract](../contracts/interfaces.md)
owns graphical Workbench client behavior. The [harness contract](../contracts/harness.md) owns
distribution, skills, and repository adaptation. The managed sections of the workflow, controller,
and execution contracts describe unbuilt Run boundaries and do not expand V1.

## Managed execution and authority (unbuilt)

Every managed Dispatch receives a self-contained Work Packet containing the objective, revisions,
authority, profile, capabilities, evidence, risks, verification obligations, exclusions, and
expected Episode schema. The system resolves concrete models and Model Effort by Cognitive Role,
context needs, Independence, continuity, capacity, and policy.

Coordinator, Worker, and Subagent describe execution continuity. Scout and Ship describe authority:

- A **Scout** may investigate, audit, reproduce, or create disposable prototypes, but cannot
  deliver project changes.
- A **Ship** may mutate only an approved isolated workspace and must return attributable mutation
  and verification evidence.

The Coordinator never receives a project-workspace write lease. Only the Repository Workspace
module lands a validated candidate. Pushing, pull-request creation, and other external effects are
explicit Publication actions.

## State, evidence, and context

Run state is durable; Model Context is disposable. The controller reducer produces one canonical
snapshot from immutable semantic records and reconciled execution observations. Raw logs, chat
messages, terminal output, and model claims are not authoritative state.

Workstream continuity is separate from managed Run durability. Each bounded managed Dispatch
returns an Episode that records outcomes, claims, evidence, mutations, authority needs, and
justified continuation context. Episodes carry results across context boundaries but do not
replace Primary Evidence or the Judgment Dossier.

Logical Actors outlive model sessions. A fresh Context Curator can prepare a source-backed
Continuation Artifact from canonical state, material Episodes, and Primary Evidence. Required
authority, decisions, disagreement, uncertainty, mutations, and pending attention remain
mechanically protected during reconstruction.

Every retained artifact has a promotion or expiry path. Run analysis and compounding precede
cleanup. Raw model output cannot become durable project knowledge without an explicit promotion
transition.

## Clients and integrations

The Workbench client consumes canonical protocol projections and never owns Run or Workstream
state. Its intended first graphical slice presents one complete Pi Chat per macOS window,
delivering the reused graphical composer first and a toggleable workspace file viewer/editor
second. The existing PI WEB shell and legacy Workbench plugin remain fallback and evidence, not the
target composition.

**Current state:** the replacement graphical client is not implemented, so the terminal remains the
working surface. Use the [`workstreams`](../../skills/workstreams/SKILL.md) skill to operate
Workstreams until a later client slice adds their re-entry surface.

Later attention surfaces lead with required judgment, keep autonomous activity secondary, and join
intent, realized behavior, evidence, deviations, and residual risks. Workstreams remain the primary
cross-session attention container even though the first graphical slice deliberately starts with
Chat.

External systems such as GitHub, Linear, Sentry, and CI remain collaboration surfaces. Import and
Publication are explicit, idempotent adapter operations. External events never advance the local
lifecycle implicitly.

## V1 boundary

V1 is defined by the [requirements](requirements.md),
[execution contract](../contracts/execution.md), and
[Workstream contract](../contracts/workstreams.md). It covers standalone and
Workstream-associated sessions, reconnect-safe attended session launch, automatically persisted
correctable checkpoints, restart and resume, Human Tasks and links, and human-instructed closure.
The archived Level 1 plan preserves the earlier PI WEB-first sequence only as provenance.

V1 does not include autonomous model-session replacement, a Run Controller, managed execution,
unattended work, or FirstMate. Browser or Workbench web-client replacement must preserve session
and Workstream state without restarting PI WEB's session daemon. Machine loss, multi-user control,
and portable cross-machine handoff remain outside V1.

The complete V1 outcomes and validation conditions are in [requirements.md](requirements.md).

## Out of scope

- Replacing IntelliJ, GitHub, Linear, Sentry, CI, or PI WEB's operational shell capabilities.
- Multiple coding-agent harnesses or provider-specific coding CLIs as Worker runtimes.
- Treating conversations, mutable Markdown, terminal output, or model-authored transitions as
  authoritative Run state.
- Peer worker mailboxes, open-ended worker conversations, or agent hierarchies deeper than the one
  bounded lead → Worker → leaf level.
- Workers that create, dispatch, or retire other Workers.
- Model-backed log watching, terminal-screen parsing, or maximizing worker count as a product goal.
- A blanket autonomy switch, universal Working Mode ladder, cost tier, Scout-first rule,
  plan-once rule, or universal file-size limit.
- Claiming managed authority, recovery, or workspace isolation for the attended workflow.
- Concurrent human control or concurrent delivery of unrelated product outcomes inside one Run.
- Production deployment from the pilot.
- Implicit external synchronization or publication.
- Agent-generated ownership of authentication, permissions, recovery, workspace leases, or Run
  state.
- Arbitrary graphical composition or global CSS injection.
- A daemon, database, Run Controller, or managed execution in V1.
- Treating Working Mode selection as managed Run authority.
- Copying credentials, subscription state, sessions, machine-local configuration, or external
  binaries into the harness repository.
