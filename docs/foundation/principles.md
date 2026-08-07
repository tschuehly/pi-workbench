# Pi Workbench principles

These principles govern system-wide design choices. When two designs conflict and no contract
settles it, the guiding principle decides.

The doc has two altitudes. A short **guiding maxim** carries the intent and is the part to
remember; beneath each maxim, the **detailed principles** it refines preserve the exact
commitment. Detailed behavior still belongs to the owning document under
[`../contracts/`](../contracts/); settled trade-offs and exceptions belong in the
[decision record](decisions.md).

Every detailed principle appears under exactly one maxim. If a commitment fits no maxim, that is a
real gap, not a formatting choice.

## Attention — spend the scarce resource well

### 1. Human Attention is scarce and bracketed

Principal Judgments frame autonomous work before and after it; In-Run Judgment enters only for a
Material Question. Attention follows judgment leverage, operational impact, and recovery cost, not
routine activity.

- Human Attention is spent according to judgment leverage, operational impact, and recovery cost
  rather than routine workflow activity.
- Human Attention brackets autonomous work and enters it conditionally when an In-Run Judgment can
  materially improve the outcome.

### 2. The interface protects attention

Human-facing state is action-first and interruption-resilient: required judgment leads, routine
activity stays separate, place is preserved, and what changed since the last judgment is explained.

- Human-facing state assumes interruption and context switching: it externalizes memory,
  distinguishes activity from action, preserves place, and explains what changed since the last
  judgment.
- Graphical interaction is action-first and interruption-resilient by default: required judgment
  leads, routine activity is perceptually and structurally separate, completed outcomes are
  concrete, and deeper evidence remains available on demand.

### 3. Discovery and review are bounded

Parallelism is limited by dependencies, isolation, and review capacity; the shortest path to
decision-changing evidence outranks unbounded discovery; an attention request pauses only the work
it affects.

- Parallelism is bounded by dependencies, isolation, and review capacity.
- The shortest path to decision-changing evidence takes priority over unbounded issue discovery or
  review activity.
- Attention requests pause only affected work when dependencies and authority allow independent
  work to continue.

### 4. Work shape follows context, not rank

Repository and task context shape Attention Allocation and the semantic work graph; Working Mode
dimensions adjust per Run; a loop or graph is an execution shape, never a maturity level.

- Repository and task context shape Attention Allocation and the semantic work graph.
- A loop or graph is an execution shape selected for the outcome, not a workflow or maturity level
  in itself.

## Authority — who and what may decide and mutate

### 5. Models propose; deterministic modules dispose

Models choose and revise the semantic work graph; the controller owns the fixed lifecycle, side
effects, and the one authoritative reduced state; coordinators reason but never mutate a project.
Routine activity is reconciled mechanically, so models enter only when judgment is actionable.

- The controller owns the fixed lifecycle; the model chooses and revises the semantic work graph
  inside it.
- The coordinator reasons about project work but never mutates a project directly.
- Immutable events record facts; only the deterministic controller reducer defines current run
  state.
- Fixed lifecycle gates exist only in the controller state machine rather than being duplicated as
  execution-graph nodes.
- Watchers classify and reconcile routine execution mechanically; models enter only when
  interpretation or judgment is actionable.
- Routine execution activity remains observable without consuming model attention.

### 6. Authority is structural, never textual

Permission lives in leases, envelopes, and schemas that services enforce — not in prompt text. An
Entry Preset cannot grant a guarantee the underlying service does not enforce.

- New maxim, grounded in Decision 52 (prompt instructions are not the authority mechanism) and the
  Entry Preset definition in [vocabulary](vocabulary.md) and [operating levels](operating-levels.md).

### 7. Uncertainty fails closed

Unknown or contradictory state resolves to `unknown` rather than a guess. Unrecognized types,
unreleased workspaces, and unmatched model bindings stop rather than proceed.

- New maxim, grounded in Decisions 54 (classify to `unknown`), 59 (fail-closed workspace release),
  61 (unknown schema types fail closed), and 88 (no silent model-binding fallback).

### 8. One human owner is accountable per Run

A Run may use many model workers, but exactly one owner holds steering and authority at a time.
Ownership transfers only through an explicit, portable handoff.

- New maxim, grounded in Decision 11 (one active human owner per run).

## Context and state — what persists, what is thrown away

### 9. Model Context is disposable; Run state is durable

No model session is authoritative Run state; Logical Actor identity and accountability outlive
replaceable model sessions.

- Model Context is disposable; Run state is resumable.
- Logical Actor identity and accountability outlive replaceable model sessions; no model context is
  authoritative Run state.

### 10. Work moves as contracts, not conversations

Every Dispatch receives a self-contained Work Packet and returns a typed, validated Episode.
Durable references carry results forward instead of full conversation histories.

- Every dispatch has a self-contained input contract and every result has a mechanically validated
  typed episode contract.
- Each Pi actor receives only the context justified by its bounded work; durable references carry
  forward results instead of full conversation histories.

### 11. Bindings are assigned by role and measured

Model capability, Model Effort, Continuity, and Independence are set by Cognitive Role and measured
rather than assumed.

- Model capability, Model Effort, Continuity, and Independence are assigned by Cognitive Role and
  measured rather than assumed.

### 12. State classes stay distinct and compound deliberately

Working state, collaboration state, and durable knowledge remain separate. Local working state
drives execution while external systems are systems of record synced explicitly and idempotently.
Generated state expires or promotes; only validated Learning Candidates become knowledge.

- Working state, collaboration state, and durable project knowledge are distinct.
- External side effects are explicit and idempotent.
- Generated state has an expiry or promotion path.
- Every run analyzes its outcome and execution, then compounds validated lessons without promoting
  raw agent output as knowledge.

## Evidence — how the outcome earns trust

### 13. Judgment is preserved and evaluated against

Judgment survives as source-backed artifacts with one accountable synthesis. Implementation is
judged against those artifacts on a task-shaped Review Surface that joins intent, behavior, Primary
Evidence, deviations, and risk.

- Judgment is preserved as source-backed artifacts; implementation is evaluated against those
  artifacts.
- Deliberation is represented by durable, evidence-linked episodes and one accountable synthesis.
- Acceptance is supported by a task-shaped Review Surface that joins intent, realized behavior,
  Primary Evidence, deviations, risks, feedback, and available actions.

### 14. Verification is independent and evidence-backed

Material claims are checked by an actor that did not produce them and are supported by Primary
Evidence, not model confidence.

- New maxim, grounded in the Independence and Primary Evidence definitions in
  [vocabulary](vocabulary.md) and the Quality and Authority Envelope in
  [`../contracts/workflow.md`](../contracts/workflow.md).

## Boundaries — where ownership stops

### 15. PI WEB owns experience, never authority

The user-facing client delivers every interaction over typed protocols but never owns workflow
state. Trust-sensitive controls stay outside agent-generated surfaces.

- PI WEB owns the user experience without owning workflow semantics.
- User-facing Workbench interaction is implemented in PI WEB over typed protocols.
- Trust-sensitive controls remain outside agent-generated surfaces.

### 16. Workstreams restore attention without Run authority

Workstreams persist cross-session attention at meaningful changes, preserving source events with a
separately projected re-entry state, and make no managed-recovery claim.

- Workstreams preserve cross-session attention without borrowing the authority or recovery claims of
  managed Runs.
- Cross-session persistence occurs at meaningful attention changes; raw transcripts and routine
  activity do not become standing context by default.
- Workstream ledgers preserve source events while current re-entry state is projected separately and
  combined synthesis is generated only when needed.

## Not a principle

The former principle "PI WEB's attention surface is part of the V1 vertical slice" is a scope and
roadmap statement, not a timeless design commitment. It is tracked in the [decision
record](decisions.md), not here.
