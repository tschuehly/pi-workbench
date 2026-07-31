# Graphical Attention Contract

Status: intended V1 interaction contract.

This document defines how graphical clients present canonical attention and Run state. The
[Attention and Interface Specification](specs/attention-and-interfaces.md) remains authoritative
for Attention Item creation, Broker behavior, controller authority, and terminal equivalence.

## Outcome

The graphical client opens on the owner's highest-priority pending judgment in Broker order and
answers one question: **What needs my judgment now?** Routine activity remains observable without
competing with required action. When no judgment is pending, the client states that no owner action
is required and opens the activity progressing without the owner.

The surface reduces the work required to start, resume, and complete a judgment. Action-first,
interruption-resilient presentation is the default rather than an optional mode.

## Authority and State Boundary

The surface consumes canonical portfolio, project, and Run projections, reconciled Attention Items,
Judgment Dossier revisions, and Primary Evidence. The controller remains authoritative for Run
state and legal actions. Brokers may order, combine, defer, or prepare attention within their scope;
the client does not invent urgency, materiality, authority, or completion from activity streams.

Every action that may change Run state submits a typed, revision-checked command through the Run
Controller and renders its receipt. Passive inspection remains available without the control
lease.

## Attention Entry Surface

The default view separates two lanes:

1. **Needs judgment** contains pending Attention Items ordered by the responsible Broker.
2. **Progressing without me** contains observable activity and completed outcomes that require no
   owner action.

The first viewport presents the current focus and a small ordered preview of subsequent attention.
The complete queue remains accessible. Presentation limits never discard or defer durable Attention
Items.

Each queue item states:

1. The required judgment or action.
2. Why it is material now.
3. The affected project, Run, and work.
4. What is blocked and what continues independently.
5. What changed since the owner's previous judgment in that scope.

## Focused Attention Surface

Opening an Attention Item preserves its scope and revision and presents the minimum sufficient first
layer:

1. **Required judgment** — one concrete question or action.
2. **Recommended response** — the proposed action, expected effect, and evidence basis; when no
   response has been prepared, the surface says so.
3. **Consequences** — material alternatives, trade-offs, reversibility, and residual risk.
4. **Deferral behavior** — what pauses, what continues, and which condition makes the item stale.
5. **Actions** — one perceptually and structurally primary action plus the bounded alternatives
   permitted by the item schema.

Deeper layers expose comparison criteria, representative successes and failures, contradictions,
independent challenge, Primary Evidence, source Episodes, and the relevant Judgment Dossier
revision. Current evidence is perceptually primary; superseded evidence remains traceable.

Human-effort estimates appear only when evidence supports them. The surface states the estimate's
assumptions and uses a range when uncertainty matters; otherwise, it omits the estimate.

## Re-entry and Place Preservation

The client restores the owner's selected portfolio, project, Run, work item, artifact, and inspected
revision, then identifies whether that revision remains current. On return it shows:

1. The last judgment made in that scope, or that no previous judgment exists.
2. Concrete outcomes completed since that judgment.
3. New or changed Attention Items.
4. Feedback or evidence made stale by a newer revision.
5. The next required action.

The change summary is derived from canonical revisions and records. It does not summarize raw chat
or terminal output as current state.

## Presentation Rules

- Lead with the action or judgment; place supporting context beside or beneath it.
- Use numbered steps only when the owner must perform a sequence and show the current position.
- State failures as cause, impact, and available recovery action without alarmist language.
- Make completed outcomes visible through concrete evidence, without scores, streaks, or decorative
  gamification.
- Keep tangential activity out of the focused surface; link it to its owning Run or artifact scope.

These rules govern portfolio, project, Run, Review, and generated skill surfaces. A generated or
repository-specific surface may change medium and layout but must preserve the same attention,
revision, evidence, and authority semantics.

## Acceptance Fixture

A graphical-shell candidate satisfies this contract when the shared recorded Run fixture proves:

1. The owner can identify the required judgment and primary action without reading logs or chat,
   or can tell that no action is required.
2. Required action is perceptually and structurally distinct from activity that continues without the owner.
3. Re-entry restores place and accurately explains changes from canonical revisions.
4. Stale feedback and superseded evidence cannot appear current.
5. Every Run-state action produces the same typed outcome as its terminal representation.
