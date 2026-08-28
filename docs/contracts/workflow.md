# Workflow Specification

Every managed Run follows one versioned Workflow Contract and one fixed controller lifecycle. Variable semantic work lives in a revisioned execution graph; quality, authority, Human Attention, evidence, reconciliation, and closure remain deterministic contract obligations. This document defines those boundaries and the initial adaptive project-work contract.

This document is authoritative for this contract. [The system overview](../foundation/system-overview.md) remains authoritative for system-wide behavior and boundaries.

This contract defines an unbuilt managed Run boundary. Attended V1 uses no Workflow Contract.

## Initial Adaptive Workflow Contract

The initial implementation executes one versioned **adaptive project-work** contract, started explicitly by the owner. It supports evidence-producing investigation, experimentation, prototyping, and attributable delivery under one quality and authority envelope.

The contract declares required and optional capabilities instead of embedding machine-local paths, credentials, or assumptions. Before execution, Pi:

1. validates the contract;
2. shows its quality envelope and capabilities to the owner; and
3. records its content hash.

The contract accepts repository, task, risk, environment, and owner inputs. The initial implementation does not select, compose, inherit, or resolve multiple Workflow Contracts.

## Quality and Authority Envelope

Every Run must satisfy these invariants:

- Shared Understanding of the desired outcome, constraints, language, acceptance basis, unresolved Material Questions, operational impact, and success evidence is explicit before autonomous work.
- Material judgment is ratified in a versioned Judgment Dossier before execution and reconciled against the realized outcome afterward.
- The owner approves an Autonomy Envelope covering permissions, impact ceiling, budget, stopping conditions, and publication authority. Missing authority durably pauses the Run.
- The controller is the sole writer of Run state and the sole dispatcher of Workers and Subagents.
- The Coordinator has no mutating project-workspace capability. Every deliverable repository mutation is attributable to a controller-approved Ship Dispatch. Scout scratch mutations remain disposable evidence until explicitly promoted.
- Every mutating Worker holds an exclusive workspace lease. Independent reviewers use isolated or read-only scopes.
- When the risk policy requires Independence, a Worker that did not author the material claims or implementation checks them. The policy determines required review independence, lenses, and evidence depth.
- Completion claims map acceptance criteria and material risks to Primary Evidence. Model confidence alone cannot satisfy a requirement.
- Material deviations and authority expansion require owner approval. Non-material graph changes inside the envelope are recorded with rationale.
- External Publication and production-impacting actions are explicit, idempotent, and owner-authorized.
- Run analysis, compounding, promotion review, evidence sealing, and cleanup occur before closure.

## Human-Attention Contract

The Run resolves who the owner aligns with, how direct the interaction should be, what evidence review requires, and what independent work may continue while attention is pending.

The owner aligns at the scope closest to the judgment:

- The **Portfolio Broker** handles portfolio priority and cross-project trade-offs.
- The **Project Broker** handles repository direction, capabilities, conflicts, and candidate Runs.
- The accountable **Run Coordinator** handles Shared Understanding, semantic work, and outcome synthesis.

The owner may interact directly with a prototype or another evolving result through a Review Surface. Feedback is routed to the Run Coordinator and anchored to the inspected revision.

### Principal and In-Run Judgments

The Run allocates Human Attention across two Principal Judgments and conditional In-Run Judgment:

1. **Before autonomous work:** Establish Shared Understanding and approve the pre-execution Judgment Dossier and Autonomy Envelope.
2. **During autonomous work:** Request In-Run Judgment when a Material Question, evolving prototype, direct human experience, or proposed change outside the approved envelope can materially improve or redirect the outcome.
3. **After autonomous work:** Present the realized outcome through a task-shaped Review Surface and ask the owner for Acceptance. The same action may explicitly authorize pull-request Publication, but Acceptance and Publication remain separate durable transitions.

The contract records:

- the alignment participant and depth;
- interaction cadence;
- permitted direct Worker interaction;
- planned direct-experience surfaces;
- escalation conditions;
- review participant;
- required independent challenge;
- result packaging; and
- the effect of deferment.

A pending judgment pauses only affected graph nodes or Runs when dependencies and authority permit unrelated work to continue.

### Review Surface content

The Review Surface assembles the intended outcome, realized behavior, Primary Evidence, independent findings, deviations, consequences, residual risks, and precise feedback actions in the format appropriate to the judgment.

Experimental work presents the question, predeclared comparison criteria, what was tried, representative successes and failures, contradictions, recommendation, remaining uncertainty, and available next actions. It does not concatenate Worker reports.

Additional attention is created only for:

- material ambiguity;
- missing authority;
- a graph revision outside the allowlist;
- failure or staleness;
- unknown outcomes;
- external conflicts; or
- required learning-candidate disposition.

Routine progress and bounded retries remain visible without consuming a Broker, Coordinator, or owner turn.

## Judgment Dossier

Each Run maintains one versioned Judgment Dossier as its authoritative reasoning artifact.

Before implementation, the dossier records the Shared Understanding: problem and system model, language, evidence, options, trade-offs, assumptions, risks, chosen direction, and success evidence.

After implementation, the dossier explains the realized system, supporting evidence, deviations, consequences, residual risks, and learning candidates.

Review Surfaces project the dossier and its evidence for a particular human judgment without duplicating ownership.

## Fixed Controller Lifecycle

The controller advances every Run through one fixed lifecycle:

`intake → judgment → authority → execution → verification → acceptance → publication → close`

- `intake` resolves the task, repository package, revisions, owner, and risk.
- `judgment` produces and ratifies the pre-execution Judgment Dossier revision, including hypotheses and comparison criteria when the Run is exploratory.
- `authority` records the approved autonomy, impact, budget, and publication envelope.
- `execution` runs authorized Scout and Ship work in read-only, disposable scratch, or leased isolated workspaces according to authority.
- `verification` obtains independent evidence for the material claims, behavior, and mutations required by the managed Run's Workflow Contract.
- `acceptance` presents criteria, evidence, deviations, and residual risks.
- `publication` performs an explicitly authorized, idempotent external action or records that the accepted Run has no publication action.
- `close` analyzes the Run, disposes learning candidates, seals evidence, and performs approved cleanup.

These states and their entry and exit predicates belong only to the controller state machine.

## Semantic Execution Graph

The Pi Coordinator organizes variable semantic work from the current outcome, repository policy, risk, and evidence. It may revise that organization as evidence arrives.

The controller enforces quality, authority, safety, budget, isolation, Independence, and evidence constraints without prescribing the semantic work sequence. Tactical actions and context synchronization are Episodes within graph nodes, not graph structure.

Investigation, deliberation, prototyping, design, implementation slices, remediation, and independent review are available graph-node patterns rather than universal ordered phases. Fixed lifecycle gates are not graph nodes. The Coordinator selects only the semantic work justified by the task and may revisit its plan as new evidence arrives.

### Pilot seam coverage

The real pilot and controlled drills together exercise these defining seams:

- Durable local Run state across fresh agent contexts.
- One active human owner with interactive and AFK control.
- At least one role-specific model Worker.
- A Scout investigation followed by explicit promotion of the same work item to Ship authority.
- Linked claim, challenge, and response Episodes when a real material judgment emerges, or through a bounded fixture otherwise.
- Ratified pre-execution and post-execution judgment snapshots.
- Workbench client control and attention views over one structured event and artifact protocol.
- A bounded status summary and revision-aware Review Surface over the same judgment.
- Explicit external Publication.
- Source-backed Run analysis and compounding candidates.
- Promotion and cleanup at Run closure.

## Outcome-Directed Planning and Review

The Coordinator selects the shortest safe path to evidence that can confirm, disconfirm, or redirect the desired outcome.

A low-certainty Run may establish hypotheses, representative inputs, comparison criteria, and stopping conditions before choosing an implementation direction. A Run with a known outcome may use one Dispatch, a bounded loop, or a dependency graph according to its scope and evidence obligations.

Review is a capability applied to material claims and risks, not an unbounded search for more issues. Every review Dispatch declares:

- the claim under review;
- why it matters to the outcome;
- required Primary Evidence;
- finding disposition;
- attempt bound; and
- stopping condition.

An early behavioral experiment or direct human experience may take priority over broad internal review when it can invalidate the direction more cheaply. A quality loop cannot continue merely until models stop proposing improvements.

Experimental branches return comparable Episodes against criteria established before their results are interpreted. The Coordinator synthesizes successes, failures, contradictions, and residual uncertainty. When required, an independent challenge profile checks material conclusions. The human receives a task-shaped Review Surface rather than Worker logs or concatenated reports.

## PhotoQuest Pilot Boundary

The first real Run targets PhotoQuest in an isolated worktree. The pilot task must be reversible, low impact, and independently verifiable through PhotoQuest's repository-native checks. The Run may open or update a pull request after owner approval but does not deploy to production.

The pilot uses PhotoQuest's existing instructions, skills, hooks, tests, IntelliJ integration, browser tooling, and evidence conventions as workflow inputs. PhotoQuest owns those repository capabilities; Pi Workbench does not reimplement them.

The pilot implements PhotoQuest plan 020, landing-page scroll-depth tracking. A Scout Dispatch checks the plan's assumptions and drift anchors against the current repository revision and returns a self-contained evidence report. The Coordinator proposes the execution graph and presents its Autonomy Envelope and material decisions. After owner approval and before any mutation, the controller promotes the same work item and evidence lineage to Ship authority.

## Interactive and AFK Modes

Interactive mode streams detailed progress, opens relevant surfaces, and asks questions inline.

AFK mode advances only through pre-authorized transitions, persists all decisions and evidence, pauses durably when authority is missing, and sends notifications.

Switching mode does not create a new Run.

## Team Collaboration

All team members use the same repository package, Workbench client, PI WEB runtime, and workflow protocol. Collaborators interact through bounded artifacts and decisions rather than agent commands.

Each Run has exactly one active human owner or controlling client. The owner may orchestrate multiple Pi Workers using different models.

Ownership transfers explicitly through a portable, schema-validated handoff snapshot containing:

- creator metadata;
- task and workflow versions;
- current state and pending decisions;
- artifact references; and
- external synchronization watermarks.

Pi collaboration services and cloud execution may connect to the same Run and event protocol. They preserve the single-owner authority rule unless a future protocol explicitly introduces coordinated ownership.

## State and Knowledge Lifecycle

State belongs to one of four classes:

- **Ephemeral execution data:** prompts, raw tool outputs, live logs, and temporary files.
- **Durable Run state:** canonical snapshot, append-only semantic records, decisions, approvals, attention, and evidence pointers.
- **Reviewable artifacts:** plans, diffs, reports, screenshots, recordings, and prototypes.
- **Durable project knowledge:** validated rules, skills, tests, hooks, architecture decision records (ADRs), domain terms, and current source-backed guidance.

Knowledge candidates move through:

`ephemeral → candidate → active → retired → purged`

Run storage moves through:

`active → completed → promotion review → sealed → cleanup eligible → collected`

Cleanup performs a mark phase over active Runs, pinned evidence, promoted knowledge, external references, and policy holds. Rebuildable caches and unreferenced scratch artifacts receive aggressive expiry. Raw traces have repository-defined debugging or compliance windows.

A completed Run cannot be collected until required decisions and reusable knowledge have been promoted or explicitly rejected.

### Workspace release

Workspace release is separately fail-closed.

A Ship workspace remains leased while it is dirty, unlanded, missing required evidence, or otherwise not cleanup-eligible. Release requires confirmed delivery or explicit owner-authorized discard.

A Scout scratch workspace requires a sealed, self-contained report, resolved completion obligations, and preservation of referenced evidence before release.

## Staleness and Reconciliation

Before resuming or Dispatching work, the runtime compares:

- Repository and worktree revision.
- Task source revision and external object version.
- Referenced specification and dependency versions.
- Workflow package, tool, and model versions.
- Input artifact hashes.
- Pending approval validity.
- Validation evidence and its invalidation scope.

Changed inputs move the Run to an explicit reconciliation state. The runtime does not silently continue from stale assumptions.

## Run Analysis and Compounding

Every completed, stopped, or failed Run produces a structured analysis from the durable event graph and referenced evidence. The analysis separates:

- **Outcome quality:** acceptance-criterion coverage, behavioral evidence, unresolved risk, review findings, and escaped defects when known.
- **Orchestration quality:** lifecycle and node duration, gate waiting time, retries, rework, delegation depth, Worker and model outcomes, context pressure, budget use, tool failures, cancellation behavior, review yield, deliberation quality, and evidence completeness.
- **Routing efficiency:** cache reads and writes, session reuse, quota pressure, latency, model escalation, and quality outcomes by Cognitive Role.

A dedicated fresh-context Pi compounder reviews the analysis with decisions, corrections, deviations, findings, and Primary Evidence. It emits typed candidates for project knowledge or workflow improvement.

Every candidate declares:

- its proposed destination and scope;
- provenance and supporting evidence;
- applicability;
- validation method and invalidation trigger; and
- relationship to existing knowledge.

Raw transcripts, model self-assessments, and unverified summaries remain evidence inputs rather than active knowledge. Candidate promotion and rejection are explicit ledger transitions. Rejected and superseded candidates follow the repository retention policy instead of remaining in standing context.
