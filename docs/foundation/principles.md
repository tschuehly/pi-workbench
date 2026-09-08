# Pi Workbench principles

> **Use these principles when no contract settles a system-wide design choice.** Detailed behavior
> belongs in the owning [`../contracts/`](../contracts/) document; settled trade-offs and exceptions
> belong in the [decision record](decisions.md).

The 17 guiding principles below carry both the memorable rule and its exact commitment. Each
principle appears under one theme. A commitment that fits no theme reveals a design gap.

## Attention: spend the scarce resource well

### 1. Human Attention is scarce and bracketed

Spend Human Attention according to judgment leverage, operational impact, and recovery cost—not
routine activity. Principal Judgments frame autonomous work before and after it. Human Attention
enters In-Run work only when an In-Run Judgment can materially improve the outcome of a Material
Question.

### 2. The interface protects attention

Design human-facing state for interruption and context switching. Lead with required judgment;
separate routine activity perceptually and structurally; preserve the reader's place; explain what
changed since the last judgment; make completed outcomes concrete; and keep deeper evidence
available on demand.

### 3. Discovery and review are bounded

Bound parallelism by dependencies, isolation, and review capacity. Prefer the shortest path to
decision-changing evidence over unbounded discovery or review. An attention request pauses only
the work it affects when dependencies and authority allow other work to continue. Coordination
scales Human Attention across concurrent work without transferring execution authority to the
coordinator.

### 4. Work shape follows context, not rank

Repository and task context determine Attention Allocation and the semantic work graph. Select
Working Mode axes per task. A loop or graph is an execution shape chosen for the outcome, not a
workflow rank or maturity level.

## Authority: who and what may decide and mutate

### 5. Models propose; deterministic modules dispose

The model chooses and revises the semantic work graph inside a fixed lifecycle. The controller
alone owns that lifecycle, validates changes, performs side effects, and reduces immutable events
into authoritative current Run state. Fixed lifecycle gates exist only in the controller state
machine, not as duplicated execution-graph nodes.

The coordinator reasons about project work but never mutates a project directly. Watchers classify
and reconcile routine execution mechanically, keeping it observable without consuming model
attention. Models enter only when interpretation or judgment is actionable.

### 6. Authority is structural, never textual

Services enforce permission through leases, envelopes, and schemas—not prompt text. Working Mode
configures behavior; it cannot grant a guarantee that the underlying service does not enforce.

This principle is grounded in Decision 52, Decision 69, and the Working Mode definitions in the
[vocabulary](vocabulary.md) and [Working Mode](working-mode.md).

### 7. Uncertainty fails closed

Resolve unknown or contradictory state to `unknown`, never to a guess. Stop on unrecognized types,
unreleased workspaces, or unmatched model bindings instead of proceeding.

This principle is grounded in Decisions 54, 59, 61, and 88.

### 8. One human owner is accountable per Run

A Run may use many model workers, but exactly one human owner holds steering and authority at a
time. Ownership transfers only through an explicit, portable handoff.

This principle is grounded in Decision 11.

## Context and state: what persists and what is discarded

### 9. Model Context is disposable; Run state is durable

Run state is resumable; Model Context is disposable. Logical Actor identity and accountability
outlive replaceable model sessions. No model session or context is authoritative Run state.

### 10. Work moves as contracts, not conversations

Every Dispatch receives a self-contained Work Packet and returns a mechanically validated, typed
Episode. Give each Pi actor only the context its bounded work justifies. Carry results forward as
durable references rather than complete conversation histories.

### 11. Bindings are assigned by role and measured

Assign model capability, Model Effort, Continuity, and Independence by Cognitive Role, and measure
them rather than assuming them.

### 12. State classes stay distinct and compound deliberately

Keep working state, collaboration state, and durable project knowledge distinct. Local working
state drives execution; external systems remain systems of record and synchronize only through
explicit, idempotent side effects. Generated state must expire or follow a promotion path.

Every Run analyzes its outcome and execution, then compounds validated Learning Candidates. Raw
agent output does not become durable knowledge.

## Evidence: how the outcome earns trust

### 13. Judgment is preserved and evaluated against

Preserve judgment as source-backed artifacts and evidence-linked Episodes with one accountable
synthesis. Evaluate implementation against those artifacts. Acceptance uses a task-shaped Review
Surface that joins intent, realized behavior, Primary Evidence, deviations, risks, feedback, and
available actions.

### 14. Verification is independent and evidence-backed

An actor that did not produce a material claim checks it against Primary Evidence, not model
confidence.

This principle uses the Independence and Primary Evidence definitions in
[vocabulary](vocabulary.md) and the Quality and Authority Envelope in the
[workflow contract](../contracts/workflow.md).

## Boundaries: where ownership stops

### 15. The Workbench client owns experience, never authority

Pi Workbench owns its client composition while PI WEB may provide runtime and leaf modules. Every
user-facing Workbench interaction crosses a typed protocol; the client never owns workflow state.
Trust-sensitive controls remain outside agent-generated surfaces.

### 16. Workstreams restore attention without Run authority

Workstreams preserve cross-session attention without claiming managed Run authority or recovery.
They persist source events only at meaningful attention changes; raw transcripts and routine
activity do not become standing context by default. A separate projection provides current
re-entry state, and combined synthesis is generated only when needed.

## Evolution: grow from observed need

### 17. Build the next thing, not the whole system

Add one axis, contract, or module only when observed need justifies it. Ship the smallest useful
part, learn from it, and defer the rest.

## What is not a principle

The former claims that PI WEB must own the complete experience and that its attention surface is
the V1 vertical slice were roadmap and scope choices, not timeless design commitments. Their
replacements are recorded in the [decision record](decisions.md).
