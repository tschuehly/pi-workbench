# Workflow Specification

Defines the supported Workflow Contract, Human Attention, Controller Lifecycle, Semantic Execution Graph, operating-mode, reconciliation, and compounding behavior.

This document is authoritative for this contract. [The system specification](../SPEC.md) remains authoritative for system-wide behavior and boundaries.

## Initial Adaptive Workflow Contract

The initial implementation executes one versioned **adaptive project-work** contract. The owner starts it explicitly. The contract supports evidence-producing investigation, experimentation, prototyping, and attributable delivery under one quality and authority envelope. It declares required and optional capabilities instead of embedding machine-local paths, credentials, or assumptions. Pi validates the contract, shows its quality envelope and capabilities to the owner, and records its content hash before execution.

The contract accepts repository, task, risk, environment, and owner inputs, but the initial implementation does not select, compose, inherit, or resolve multiple workflow contracts.

## Quality and Authority Envelope

- Shared Understanding of the desired outcome, constraints, language, acceptance basis, unresolved Material Questions, operational impact, and success evidence is explicit before autonomous work.
- Material judgment is ratified in a versioned dossier before execution and reconciled against the realized outcome afterward.
- The owner approves an autonomy envelope covering permissions, impact ceiling, budget, stopping conditions, and publication authority. Missing authority durably pauses the run.
- The controller is the sole writer of run state and the sole dispatcher of workers and subagents.
- The coordinator has no mutating project-workspace capability. Every deliverable repository mutation is attributable to a controller-approved ship dispatch; scout scratch mutations remain disposable evidence until explicitly promoted.
- Every mutating worker holds an exclusive workspace lease; independent reviewers use isolated or read-only scopes.
- Material claims and implementation are checked by a Worker that did not author them when the risk policy requires Independence. The policy determines required review independence, lenses, and evidence depth.
- Completion claims map acceptance criteria and material risks to primary evidence. Model confidence alone cannot satisfy a requirement.
- Material deviations and authority expansion require owner approval. Non-material graph changes inside the envelope are recorded with rationale.
- External publication and production-impacting actions are explicit, idempotent, and owner-authorized.
- Run analysis, compounding, promotion review, evidence sealing, and cleanup occur before closure.

## Human-Attention Contract

The Run resolves who the owner aligns with, how direct the interaction should be, which evidence is
needed for review, and what independent work may continue while attention is pending. Portfolio
priority and cross-project trade-offs are handled with the Portfolio Broker; repository direction,
capabilities, conflicts, and candidate Runs are handled with the Project Broker; Shared
Understanding, semantic work, and outcome synthesis are handled with the accountable Run
Coordinator. The owner may interact directly with a prototype or other evolving result through a
Review Surface, with feedback routed to the Run Coordinator and anchored to the inspected revision.

The Run allocates Human Attention across two Principal Judgments and conditional In-Run Judgment:

1. **Before autonomous work:** establish Shared Understanding and approve the pre-execution Judgment Dossier and Autonomy Envelope.
2. **During autonomous work:** request In-Run Judgment when a Material Question, evolving prototype, direct human experience, or proposed change outside the approved envelope can materially improve or redirect the outcome.
3. **After autonomous work:** present the realized outcome through a task-shaped Review Surface and ask the owner for Acceptance. The same action may explicitly authorize pull-request Publication while Acceptance and Publication remain separate durable transitions.

The contract records the alignment participant and depth, interaction cadence, permitted direct
Worker interaction, planned direct-experience surfaces, escalation conditions, review participant,
required independent challenge, result packaging, and the effect of deferment. A pending judgment
pauses only affected graph nodes or Runs when dependencies and authority permit unrelated work to
continue.

The Review Surface assembles the intended outcome, realized behavior, Primary Evidence, independent
findings, deviations, consequences, residual risks, and precise feedback actions in the format
appropriate to the judgment. Experimental work presents the question, predeclared comparison
criteria, what was tried, representative successes and failures, contradictions, recommendation,
remaining uncertainty, and available next actions instead of concatenating Worker reports.
Additional attention is created only for material ambiguity, missing authority, a graph revision
outside the allowlist, failure, staleness, unknown outcomes, external conflicts, or required
learning-candidate disposition. Routine progress and bounded retries remain visible without
consuming a Broker, Coordinator, or owner turn.

## Fixed Controller Lifecycle

The controller advances every run through one fixed lifecycle:

`intake → judgment → authority → execution → verification → acceptance → publication → close`

- `intake` resolves the task, repository package, revisions, owner, and risk.
- `judgment` produces and ratifies the pre-execution Judgment Dossier revision, including hypotheses and comparison criteria when the Run is exploratory.
- `authority` records the approved autonomy, impact, budget, and publication envelope.
- `execution` runs authorized Scout and Ship work in read-only, disposable scratch, or leased isolated workspaces according to authority.
- `verification` obtains independent evidence for the material claims, behavior, and mutations required by the Working Mode.
- `acceptance` presents criteria, evidence, deviations, and residual risks.
- `publication` performs an explicitly authorized idempotent external action or records that the accepted Run has no publication action.
- `close` analyzes the run, disposes learning candidates, seals evidence, and performs approved cleanup.

These states and their entry and exit predicates belong only to the controller state machine.

## Semantic Execution Graph

The Pi coordinator organizes variable semantic work from the current outcome, repository policy, risk, and evidence. It may revise that organization as new evidence arrives. The controller enforces quality, authority, safety, budget, isolation, independence, and evidence constraints without prescribing the semantic work sequence. Tactical actions and context synchronization are captured as episodes within graph nodes rather than as graph structure.

Investigation, deliberation, prototyping, design, implementation slices, remediation, and independent review are available graph-node patterns rather than universal ordered phases. Fixed lifecycle gates are not graph nodes. The coordinator selects only the semantic work justified by the task and may revisit its plan as new evidence arrives.

The real pilot and its controlled drills together exercise the product's defining seams:

- Durable local run state across fresh agent contexts.
- One active human owner with interactive and AFK control.
- At least one role-specific model worker.
- A scout investigation followed by explicit promotion of the same work item to ship authority.
- Linked claim, challenge, and response episodes when a real material judgment emerges, or through a bounded fixture otherwise.
- Ratified pre-execution and post-execution judgment snapshots.
- Terminal control and a minimal graphical attention client over one structured event and artifact protocol.
- A bounded terminal review summary and revision-aware graphical Review Surface over the same judgment.
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
