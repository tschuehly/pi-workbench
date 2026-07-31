# Attention and Interface Specification

Defines the supported supervision, attention, terminal, graphical, Review Surface, and external-adapter contracts.

This document is authoritative for attention and interface behavior. [The system specification](../SPEC.md) remains authoritative for system-wide behavior and boundaries.

## Control, Attention, and Supervision

Exactly one controlling client holds the run's live control lease and may request mutating transitions. Other connected clients remain read-only until an explicit ownership transfer grants them control. The controller remains the sole run-state writer and Pi dispatcher regardless of which client owns the lease.

While any dispatch is in flight, one healthy controller supervision loop owns reconciliation. Its deterministic Watcher consumes structured Pi lifecycle events, execution observations, timers, leases, external adapter results, and authority changes. Routine progress, duplicates, and unchanged observations remain recorded or coalesced without waking a model. The controller creates attention only for an actionable condition such as:

- Missing or exceeded authority.
- A terminal result requiring synthesis, review, acceptance, or publication.
- Failure, cancellation, staleness, conflicting evidence, or unknown execution state.
- A material graph, quality, budget, workspace, or external-system conflict.
- A bounded external wait whose recheck condition has matured.

An `AttentionItem` identifies its run and graph revision, source event, category, urgency, affected work, reconciled current state, required action, evidence references, and deduplication key. The item is persisted before the controller acknowledges the source event, so coordinator-session replacement cannot silently lose actionable work. Coordinator and owner notifications are projections of pending attention rather than raw runtime signals.

Portfolio and Project Brokers consume canonical projections and pending Attention Items rather than
watching raw logs. They may order, combine, defer, or request preparation of judgments within their
scope, but they cannot grant missing authority or reinterpret Run state. A higher-scope Broker
routes the owner into the Broker, Coordinator, or Review Surface closest to the required judgment;
focused lower-scope conversation returns a bounded Episode rather than its full transcript.

Each named execution profile declares a finite attempt ladder. Failed independent review returns typed findings to the next authorized attempt. The controller pauses affected work and creates one deduplicated attention item when an attempt ladder or review-failure threshold is exhausted, a workspace becomes contaminated or unattributable, an input or approval becomes stale, an execution or external action has unknown outcome, or budget or authority is exhausted. Replanning occurs through a revisioned graph mutation rather than unbounded retry.

The supervision loop is owned by the live controller host and does not require a model session to remain active. Loss of the coordinator session triggers bounded Pi-session replacement or a persisted attention item. Controller-process exit, terminal-induced exit, reboot, and machine loss remain outside the V1 durability scope.

## Stable Workbench Shell

The shell owns:

- Explicit Entry Preset selection and a visible managed-versus-unmanaged execution boundary.
- Portfolio, project, repository, workspace, worktree, and Run navigation.
- User, agent, and model identity.
- Authentication, authorization, and permission controls.
- Start, pause, resume, steer, stop, retry, and handoff controls.
- Pending-attention ordering, notifications, and focus transitions into project, Run, work-item, and artifact scope.
- Preservation of the owner's place, unresolved feedback, and changes since the previous judgment.
- Recovery, reconciliation, and cleanup entry points.
- Hosting and isolation of bounded project surfaces.

## Project Surfaces

A Review Surface is the task-shaped human judgment interface over the current Run. It selects the relevant altitude and medium for the decision—such as a concise evidence summary, diff, rendered behavior, recording, prototype, architecture view, or operational result—and lets feedback attach to the exact outcome, claim, evidence, or behavior revision it addresses.

The [Graphical Attention Contract](../graphical-attention-contract.md) defines how graphical project
surfaces present this state. The first layer leads with the required judgment and available action,
restores the state needed to resume, and keeps passive activity from competing with attention.
Presentation does not weaken evidence, authority, or revision requirements.

Review Surfaces use progressive disclosure. The first layer states the required judgment, why it is
material now, the recommendation, alternatives, consequences, reversibility, deferral behavior,
and expected human action. Deeper layers expose comparison criteria, representative successes and
failures, independent challenge, Primary Evidence, and source Episodes. Superseded evidence remains
traceable but does not compete visually with the current candidate. The surface distinguishes
pending, applied, stale, and resolved feedback and shows which independent work continues while a
judgment is deferred.

Repositories and workflows may provide:

- Declarative dashboards, forms, decision boards, timelines, dependency maps, and review views from a trusted interaction catalog.
- Sandboxed application views for complex experiences such as Atelier.
- Artifact viewers for diffs, tests, screenshots, recordings, reports, and prototypes.
- Structured terminal summaries and commands for every required workflow interaction.
- Agent-generated native skill surfaces using the harness's integrated Surface Builder capability.

Project surfaces cannot alter shell-owned permission, identity, or recovery controls.

## Entry Preset Surface

PI WEB presents Levels 1–4 in a first-class Workbench primary view contributed through generic, stable PI WEB navigation and primary-view interfaces. The view explains each preset's alignment depth, implementation independence, verification depth, Human Attention cadence, model-routing posture, and safety boundary before launch. Selection is explicit; a higher number is not presented as universally better.

Levels 1–3 launch or configure ordinary Pi sessions in the selected workspace. Their UI must say that subagent write partitions, orchestration, evidence, and recovery are advisory and unmanaged. Level 4 enters the typed Run protocol and may display Working Mode, authority, durable attention, and recovery only after the controller accepts the start. A PI WEB session id is never inferred to be a Run id.

The primary view is hosted through constrained contribution locations. PI WEB retains visible authentication, connectivity, settings, recovery, workspace, and navigation controls. Plugins cannot replace arbitrary internals or use Entry Preset selection to grant permissions. The same preset definitions remain usable from the Pi terminal package when PI WEB is unavailable.

## Initial Graphical Attention Surface

The V1 vertical slice includes a minimal graphical client over the Run protocol. It provides:

- A default portfolio attention view across projects and concurrent Runs that separates pending judgment from activity progressing without the owner.
- A project workspace showing active Run outcomes, conflicts, and current checkpoints.
- A Run workspace showing Shared Understanding, Working Mode, semantic work, evidence, and residual uncertainty.
- A revision-aware Review Surface for rendered behavior, screenshots, diffs, comparisons, and target-anchored feedback.
- Scoped conversation attached to the selected project, Run, work item, claim, artifact, or judgment.
- Working Mode and Human-Attention Contract presentation with shell-owned authority controls.

The managed graphical client is entered from Level 4 or directly through an authorized Run start. It externalizes working memory: it separates activity from required action, preserves the
owner’s place across interruptions, and explains what changed since the owner last inspected the
scope. A focused Attention Item states the required judgment, why it is material now, the
recommended response, consequences and reversibility, deferral behavior, affected work, and the
available actions before exposing deeper evidence. It consumes canonical snapshots, records, and artifact
references and does not infer state from chat messages. Generated repository-specific surfaces and
selection of a long-term graphical shell remain outside this vertical slice.

## Initial Terminal Surface

The same V1 protocol is fully operable through six terminal concepts:

```text
pi-workbench run
pi-workbench status
pi-workbench decide <attention-id>
pi-workbench control pause|resume|stop
pi-workbench validate
pi-workbench close
```

- `run` starts or attaches to a run.
- `status` renders the canonical snapshot, execution graph, active owner, progress, evidence references, and pending attention without a model turn.
- `decide` handles approval, rejection, response, acceptance, promotion, discard, and publication authorization according to the referenced attention-item schema.
- `control` changes live execution control without creating a new run.
- `validate` mechanically checks the resolved run contract and environment.
- `close` analyzes the run, gathers learning-candidate dispositions, seals retained evidence, previews cleanup, and performs owner-authorized collection.

The internal commands remain explicit, typed, revision-checked, and idempotent even when several decisions share the `decide` entry point. The terminal also exposes a structured event stream and durable artifacts using the same interface projected by the graphical client.

The terminal is a projection and control surface over the durable Run ledger; it does not own a separate workflow state machine. The graphical and terminal clients exercise the same controller semantics and retain structured fallback equivalence for every required action.

## External Adapters

Adapters read and write collaboration-relevant subsets of external systems. Every write is an explicit workflow action with an idempotency key, source run, actor, target version, and recorded result. External changes are imported as events and reconciled before they influence local execution.
