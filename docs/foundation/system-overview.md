# Pi Workbench system overview

Status: evolving specification. This document defines the system shape and routes readers to the authoritative contracts. Exact schema fields and implementation details remain subject to pilot validation.

Canonical language is defined in the [vocabulary](vocabulary.md). System-wide principles are in [principles.md](principles.md), product outcomes and validation are in [requirements.md](requirements.md), and settled trade-offs are in the [decision record](decisions.md).

## Problem

Development work is spread across agent conversations, IDEs, terminals, worktrees, repository files, collaboration systems, CI, and generated review artifacts. These tools expose activity but do not provide one trustworthy lifecycle for local agent work.

Human Attention is the scarce resource. Continuous supervision wastes it, while unattended work becomes unsafe when intent, authority, evidence, and recovery depend on chat history. Model Context is also scarce: broad histories, standing instructions, and one model for every Cognitive Role make work slower and less reliable.

Pi Workbench must let models perform more bounded work without obscuring who owns judgment, which mutations are authorized, what evidence supports the result, or how work resumes after context loss.

## Product model

Pi Workbench allocates human and model attention across interactive Workstreams and durable project Runs. Pi is the only model-worker runtime. A deterministic Run Controller owns lifecycle and authoritative state; PI WEB is the user-facing client of its typed Run protocol.

The product has two entry paths:

- **Entry Presets 1–3** start visibly unmanaged Pi workflows for progressively richer interactive delegation. Interactive sessions start inside a user-local Workstream so the owner can resume attention across sessions, but they do not claim Run identity, controller authority, enforced workspace isolation, or durable recovery.
- **Entry Preset 4** starts a controller-managed Run and resolves its Working Mode, Workflow Contract, Human-Attention Contract, and Autonomy Envelope. The Run may be linked to the Workstream that prompted it without sharing authority or state.

A higher Entry Preset number is a different starting posture, not a universal quality or maturity ranking.

## Managed Run model

A Run is one durable pursuit of an owner-declared outcome. Every managed Run uses the fixed controller lifecycle:

`intake → judgment → authority → execution → verification → acceptance → publication → close`

The lifecycle defines when judgment, authority, mutation, verification, Acceptance, Publication, analysis, and cleanup are valid. A Pi Coordinator organizes only the variable semantic work inside that envelope through a revisioned Semantic Execution Graph. Models may propose graph changes; the controller validates them and performs side effects.

The owner approves Shared Understanding and the Autonomy Envelope before autonomous mutation, supplies In-Run Judgment only for Material Questions, and judges the realized outcome through a task-shaped Review Surface. Acceptance and Publication remain separate actions even when one owner interaction authorizes both.

## Attention scopes

A Workstream is the owner's finite cross-session attention container. It may hold several concurrent interactive sessions and link human tasks, files, repositories, artifacts, and managed Runs. It is user-local and cross-repository. Its sparse ledger and derived projection support re-entry without becoming an execution-authority boundary.

FirstMate is the owner-facing Portfolio Broker profile for cross-session interaction. It reads Workstream projections and linked Run attention to help the owner decide what to resume, while the Workstream service and Run Controller retain their respective state ownership.

Pi Workbench separates three managed accountability scopes:

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

The [Workstream contract](../contracts/workstreams.md) owns cross-session attention, sparse ledgers, checkpointing, and FirstMate behavior. The [Workflow contract](../contracts/workflow.md) owns quality, authority, Human Attention, semantic work, staleness, and compounding policy. The [interface contract](../contracts/interfaces.md) owns supervision and client behavior. The [harness contract](../contracts/harness.md) owns distribution, skills, repository adaptation, and Entry Presets.

## Execution and authority

Every managed Dispatch receives a self-contained Work Packet with objective, revisions, authority, profile, capabilities, evidence, risks, verification obligations, exclusions, and expected Episode schema. Concrete models and Model Effort are resolved by Cognitive Role, context needs, Independence, continuity, capacity, and policy.

Coordinator, Worker, and Subagent describe execution continuity. Scout and Ship describe authority:

- A **Scout** may investigate, audit, reproduce, or create disposable prototypes, but cannot deliver project changes.
- A **Ship** may mutate only an approved isolated workspace and must return attributable mutation and verification evidence.

The Coordinator never receives a project-workspace write lease. The Repository Workspace module alone lands a validated candidate. Pushing, pull-request creation, and other external effects are explicit Publication actions.

## State, evidence, and context

Run state is durable; Model Context is disposable. The controller reducer produces one canonical snapshot from immutable semantic records and reconciled execution observations. Raw logs, chat messages, terminal output, and model claims are not authoritative state.

Workstream continuity is separate from Run durability. Pi Workbench stores concise semantic entries only at meaningful attention changes and mechanically projects active sessions, their latest checkpoints, unresolved human tasks, links, and closure state. A fresh context prepares each semantic checkpoint; FirstMate derives any combined “what next?” synthesis on demand rather than persisting repeated summaries.

Each bounded Dispatch returns an Episode that records outcomes, claims, evidence, mutations, authority needs, and justified continuation context. Episodes carry results across context boundaries but do not replace Primary Evidence or the Judgment Dossier.

Logical Actors outlive model sessions. A fresh Context Curator can prepare a source-backed Continuation Artifact from canonical state, material Episodes, and Primary Evidence. Required authority, decisions, disagreement, uncertainty, mutations, and pending attention remain mechanically protected during reconstruction.

Every retained artifact has a promotion or expiry path. Run analysis and compounding precede cleanup; raw model output cannot become durable project knowledge without an explicit promotion transition.

## Clients and integrations

PI WEB consumes the Run and Workstream protocols and canonical projections. It is the selected user-facing shell and remains a client, never the owner of Run or Workstream state.

PI WEB is attention-first: required judgment leads, autonomous activity remains visible but secondary, and Review Surfaces join intent, realized behavior, evidence, deviations, and residual risks. Workstreams are the primary home for interactive sessions and provide re-entry views across repositories; Projects and managed Runs remain separate linked views.

External systems such as GitHub, Linear, Sentry, and CI remain collaboration surfaces. Import and Publication are explicit, idempotent adapter operations; external events never advance the local lifecycle implicitly.

## V1 boundary

V1 validates one adaptive Workflow Contract through PI WEB. The first external delivery pilot is PhotoQuest plan 020 in an isolated worktree with no production deployment. Embabel work exercises hypothesis-driven exploration against the same lifecycle and records.

V1 durability covers replacement of a failed or exhausted Pi model session while the controller host remains alive. Controller-process exit, reboot, machine loss, a distributed controller, and multi-user concurrent control remain outside V1.

The complete product outcomes and acceptance matrix are in [requirements.md](requirements.md). Detailed pilot and policy decisions are in [decisions.md](decisions.md).

## Out of scope

- Replacing IntelliJ, GitHub, Linear, Sentry, CI, or PI WEB's operational shell capabilities.
- Multiple coding-agent harnesses or provider-specific coding CLIs as Worker runtimes.
- Treating conversations, mutable Markdown, terminal output, or model-authored transitions as authoritative Run state.
- Peer worker mailboxes, open-ended worker conversations, or unbounded recursive agent hierarchies in the initial implementation.
- Model-backed log watching, terminal-screen parsing, or maximizing worker count as a product goal.
- A blanket autonomy switch, universal Working Mode ladder, cost tier, Scout-first rule, plan-once rule, or universal file-size limit.
- Claiming managed authority, recovery, or workspace isolation for Entry Presets 1–3.
- Concurrent human control or concurrent delivery of unrelated product outcomes inside one Run.
- Production deployment from the pilot.
- Implicit external synchronization or publication.
- Agent-generated ownership of authentication, permissions, recovery, workspace leases, or Run state.
- Arbitrary graphical composition or global CSS injection.
- A daemon, database, distributed controller, or controller-process recovery in V1.
- Multiple selectable or layered Workflow Contracts in the initial implementation.
- Copying credentials, subscription state, sessions, machine-local configuration, or external binaries into the harness repository.
