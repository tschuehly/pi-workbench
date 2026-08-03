# Pi Workbench system overview

Status: evolving specification. This document defines the system shape and routes readers to the authoritative contracts. Exact schema fields and implementation details remain subject to pilot validation.

Canonical language is defined in the [vocabulary](vocabulary.md). System-wide principles are in [principles.md](principles.md), product outcomes and validation are in [requirements.md](requirements.md), and settled trade-offs are in the [decision record](decisions.md).

## Problem

Development work is spread across agent conversations, IDEs, terminals, worktrees, repository files, collaboration systems, CI, and generated review artifacts. These tools expose activity but do not provide one trustworthy lifecycle for local agent work.

Human Attention is the scarce resource. Continuous supervision wastes it, while unattended work becomes unsafe when intent, authority, evidence, and recovery depend on chat history. Model Context is also scarce: broad histories, standing instructions, and one model for every Cognitive Role make work slower and less reliable.

Pi Workbench must let models perform more bounded work without obscuring who owns judgment, which mutations are authorized, what evidence supports the result, or how work resumes after context loss.

## Product model

Pi Workbench V1 allocates Human Attention across interactive Workstreams. Pi is the model runtime,
and PI WEB is the user-facing client of the typed Workstream protocol.

V1 implements [Operating Level 1: Pair](operating-levels.md): one human works directly with one
interactive lead Pi while Human Attention is continuous. The lead may use bounded ephemeral child
Pi processes as attended tool activity and remains accountable for their assignments and results.
Interactive sessions start inside a user-local Workstream so the owner can leave and resume without
treating chat history as current state. V1 provides no agreed-before execution gate, background
semantic work, unattended execution, managed Run authority, enforced workspace isolation, or
controller-mediated recovery.

The Operating Levels specification separately defines Levels 2–4 as concepts. They are not V1
features or roadmap commitments. The managed Run architecture below describes the Level 4 authority
boundary so Level 1 does not accidentally claim its guarantees.

## Managed Run model

A Run is one durable pursuit of an owner-declared outcome. Every managed Run uses the fixed controller lifecycle:

`intake → judgment → authority → execution → verification → acceptance → publication → close`

The lifecycle defines when judgment, authority, mutation, verification, Acceptance, Publication, analysis, and cleanup are valid. A Pi Coordinator organizes only the variable semantic work inside that envelope through a revisioned Semantic Execution Graph. Models may propose graph changes; the controller validates them and performs side effects.

The owner approves Shared Understanding and the Autonomy Envelope before autonomous mutation, supplies In-Run Judgment only for Material Questions, and judges the realized outcome through a task-shaped Review Surface. Acceptance and Publication remain separate actions even when one owner interaction authorizes both.

## Attention scopes

A Workstream is the owner's finite cross-session attention container. It may hold several concurrent interactive sessions and link human tasks, files, repositories, artifacts, and managed Runs. It is user-local and cross-repository. Its sparse ledger and derived projection support re-entry without becoming an execution-authority boundary.

In V1, the owner inspects Workstream projections directly in PI WEB to decide what to resume. No
FirstMate or other model broker performs portfolio synthesis.

The Level 4 concept separates three managed accountability scopes:

- A **Portfolio Broker** routes priorities and Human Attention across projects.
- A **Project Broker** coordinates repository capabilities, conflicts, and concurrent Runs.
- A **Run Coordinator** remains accountable for one Run's semantic work, evidence, and synthesis.

Brokers do not own Run lifecycle state. Focused work returns bounded Episodes rather than complete lower-scope transcripts. Pending judgment blocks only affected work when independent authorized work can continue.

## Deep modules

Five deep modules contain the trusted behavior:

| Module | Small interface | Owns |
| --- | --- | --- |
| [Workstream Store](../contracts/workstreams.md) | `create`, `append`, `inspect`, `list`, `watch`, `close` | Sparse cross-session ledgers, current projections, session association, and closure |
| [Run Controller](../contracts/controller.md) | `start`, `submit`, `inspect`, `watch` | Lifecycle reduction, commands, canonical projections, attention, dispatch coordination, and reconciliation |
| [Pi Execution](../contracts/execution.md) | `dispatch`, `observe`, `cancel` | Pi actors, Work Packets, Episodes, model execution, continuity, and cancellation |
| [Repository Workspace](../contracts/controller.md#repository-workspace-module) | `lease`, `inspect`, `land`, `release` | Deterministic workspace isolation, mutation inventory, landing, and cleanup eligibility |
| [Artifact Store](../contracts/controller.md#artifact-store-module) | `put`, `get`, `pin` | Immutable content-addressed evidence and retention metadata |

The [Workstream contract](../contracts/workstreams.md) owns V1 cross-session attention, sparse
ledgers, attended checkpointing, and closure. The [interface contract](../contracts/interfaces.md)
owns PI WEB client behavior. The [harness contract](../contracts/harness.md) owns distribution,
skills, and repository adaptation. Workflow, controller, and execution contracts describe Level 4
boundaries and do not expand V1.

## Execution and authority

Every managed Dispatch receives a self-contained Work Packet with objective, revisions, authority, profile, capabilities, evidence, risks, verification obligations, exclusions, and expected Episode schema. Concrete models and Model Effort are resolved by Cognitive Role, context needs, Independence, continuity, capacity, and policy.

Coordinator, Worker, and Subagent describe execution continuity. Scout and Ship describe authority:

- A **Scout** may investigate, audit, reproduce, or create disposable prototypes, but cannot deliver project changes.
- A **Ship** may mutate only an approved isolated workspace and must return attributable mutation and verification evidence.

The Coordinator never receives a project-workspace write lease. The Repository Workspace module alone lands a validated candidate. Pushing, pull-request creation, and other external effects are explicit Publication actions.

## State, evidence, and context

Run state is durable; Model Context is disposable. The controller reducer produces one canonical snapshot from immutable semantic records and reconciled execution observations. Raw logs, chat messages, terminal output, and model claims are not authoritative state.

Workstream continuity is separate from Run durability. Pi Workbench stores concise semantic entries
only at meaningful attention changes and mechanically projects active sessions, their latest
confirmed checkpoints, unresolved human tasks, links, and closure state. In V1 the active Pi session
proposes a checkpoint only when the owner explicitly requests one, and the owner may correct it
before confirming persistence. No combined narrative is persisted.

Each bounded Dispatch returns an Episode that records outcomes, claims, evidence, mutations, authority needs, and justified continuation context. Episodes carry results across context boundaries but do not replace Primary Evidence or the Judgment Dossier.

Logical Actors outlive model sessions. A fresh Context Curator can prepare a source-backed Continuation Artifact from canonical state, material Episodes, and Primary Evidence. Required authority, decisions, disagreement, uncertainty, mutations, and pending attention remain mechanically protected during reconstruction.

Every retained artifact has a promotion or expiry path. Run analysis and compounding precede cleanup; raw model output cannot become durable project knowledge without an explicit promotion transition.

## Clients and integrations

PI WEB consumes the Run and Workstream protocols and canonical projections. It is the selected user-facing shell and remains a client, never the owner of Run or Workstream state.

PI WEB is attention-first: required judgment leads, autonomous activity remains visible but secondary, and Review Surfaces join intent, realized behavior, evidence, deviations, and residual risks. Workstreams are the primary home for interactive sessions and provide re-entry views across repositories; Projects and managed Runs remain separate linked views.

External systems such as GitHub, Linear, Sentry, and CI remain collaboration surfaces. Import and Publication are explicit, idempotent adapter operations; external events never advance the local lifecycle implicitly.

## V1 boundary

V1 is the Level 1 human–Pi pair-programming workflow defined in the
[approved Level 1 plan](../plans/level-1.md). It covers Workstream selection, reconnect-safe attended session
launch, explicit owner-confirmed checkpoints, restart and resume through PI WEB, human tasks and
links, and closure.

V1 does not include autonomous model-session replacement, a Run Controller, managed execution,
unattended work, or FirstMate. Browser and PI WEB web-process restart must preserve Workstream state;
machine loss, multi-user control, and portable cross-machine handoff remain outside V1.

The complete V1 outcomes and acceptance matrix are in [requirements.md](requirements.md).

## Out of scope

- Replacing IntelliJ, GitHub, Linear, Sentry, CI, or PI WEB's operational shell capabilities.
- Multiple coding-agent harnesses or provider-specific coding CLIs as Worker runtimes.
- Treating conversations, mutable Markdown, terminal output, or model-authored transitions as authoritative Run state.
- Peer worker mailboxes, open-ended worker conversations, or unbounded recursive agent hierarchies in the initial implementation.
- Model-backed log watching, terminal-screen parsing, or maximizing worker count as a product goal.
- A blanket autonomy switch, universal Working Mode ladder, cost tier, Scout-first rule, plan-once rule, or universal file-size limit.
- Claiming managed authority, recovery, or workspace isolation for Level 1.
- Concurrent human control or concurrent delivery of unrelated product outcomes inside one Run.
- Production deployment from the pilot.
- Implicit external synchronization or publication.
- Agent-generated ownership of authentication, permissions, recovery, workspace leases, or Run state.
- Arbitrary graphical composition or global CSS injection.
- A daemon, database, Run Controller, or managed execution in V1.
- Selecting or implementing Levels 2–4 in V1.
- Copying credentials, subscription state, sessions, machine-local configuration, or external binaries into the harness repository.
