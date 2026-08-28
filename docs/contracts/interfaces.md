# Attention and Interface Specification

Defines the supported supervision, attention, Workbench client, Review Surface, and external-adapter contracts.

This document is authoritative for attention and interface behavior. [The system overview](../foundation/system-overview.md) remains authoritative for system-wide behavior and boundaries.

## Control, Attention, and Supervision

Exactly one controlling client holds the run's live control lease and may request mutating transitions. Other connected clients remain read-only until an explicit ownership transfer grants them control. The controller remains the sole run-state writer and Pi dispatcher regardless of which client owns the lease.

While any dispatch is in flight, one healthy controller supervision loop owns reconciliation. Its deterministic Watcher consumes structured Pi lifecycle events, execution observations, timers, leases, external adapter results, and authority changes. Routine progress, duplicates, and unchanged observations remain recorded or coalesced without waking a model. The controller creates attention only for an actionable condition such as:

- Missing or exceeded authority.
- A completed result requiring synthesis, review, acceptance, or publication.
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

In managed execution, the supervision loop is owned by the live controller host and does not require a model session to remain active. Loss of the coordinator session triggers bounded Pi-session replacement or a persisted attention item. These managed supervision semantics are outside V1.

## Stable Workbench client

The delivered client owns only the capabilities in its current usable slice. Across slices, the client owns:

- A visible boundary between attended interaction and any future managed execution.
- Navigation introduced by the current usable slice; later Workstream, repository, workspace, portfolio, project, worktree, and Run navigation remains client-owned when delivered.
- User, agent, and model identity.
- Authentication, authorization, and permission controls.
- Start, pause, resume, steer, stop, retry, and handoff controls.
- Pending-attention ordering, notifications, and focus transitions into project, Run, work-item, and artifact scope.
- Preservation of the owner's place, unresolved feedback, and changes since the previous judgment.
- Recovery, reconciliation, and cleanup entry points.
- Hosting and isolation of bounded project surfaces.

## Workstream surfaces

Workstreams are the primary cross-session attention home. Their graphical surface is a later client
slice; until then the terminal skill operates the same typed protocol. When delivered, the
cross-repository view lists current and closed Workstreams, starts an associated session in exactly
one Workstream, and shows each session's latest confirmed checkpoint, unresolved Human Tasks,
linked files and Runs, revision, and closure state. The owner uses this mechanical projection
directly to decide what to resume; V1 does not launch FirstMate or another broker model.

Human tasks remain distinct from any future managed Run Attention Items. An advisory Workstream
task cannot block or authorize a Run transition.

The active Pi session persists a checkpoint automatically at a meaningful attention change. The
owner may correct or replace it afterwards. The interface shows missing, failed, or explicitly stale
checkpoints instead of presenting old context as current. Several sessions and Workstreams may
remain active concurrently.

Session selection and opening fail with typed causes for a missing anchor, unavailable machine,
unavailable project, unavailable workspace, missing session, or transport failure. The missing-anchor
code is `SESSION_ANCHOR_MISSING`; only that anchor-specific failure offers **Repair session location**.
Resolution always targets one explicit
machine and completes its registered-workspace scan before reporting a unique result. The interface
shows a unique catalog match for owner confirmation, requires owner selection among multiple exact
matches, and gives different recovery guidance for a missing result and an unavailable or partial
scan. Trusted PI WEB code rechecks the selected evidence immediately before the append-only repair.
Closed Workstreams and sessions that already have a complete anchor do not offer repair.

The generic PI WEB session host exposes the following discriminated resolver boundary. Every returned
location is complete. Evidence belongs to the exact match, including each ambiguous candidate, so a
caller can recheck the owner-selected identity without broadening the search. `failedScopes` is
structured PI WEB diagnostic data; Workbench treats its entries as opaque except for their count.

```text
resolveSessionLocation({ machineId, sessionId })
  -> { type: "found", location, evidence }
   | { type: "ambiguous", locations: [{ location, evidence }, ...] }
   | { type: "missing" }
   | { type: "unavailable", failedScopes: [...] }

location = { machineId, projectId, workspaceId }
evidence = { machineId, sessionId, location, catalogCwd, evidenceId, matchedCwd, scannedScopeCount, verifiedAt }
```

`evidenceId` is the opaque stable identity of that exact catalog match, while `verifiedAt` records the
current complete scan. A recheck may update its scan time or scope count; changing the match identity
or complete location invalidates the pending confirmation.

`machineId` is mandatory and every `found` or `ambiguous` match must name that same machine. A
`missing` result means the complete registered-workspace scan succeeded with no exact identity match.
An `unavailable` result means one or more scopes could not be checked and therefore cannot be treated
as missing. Workbench ignores unknown additive result fields but rejects malformed discriminants,
incomplete or cross-machine locations, incomplete evidence, and empty unavailable scope lists.

## Project Surfaces

A Review Surface is the task-shaped human judgment interface over the current Run. It selects the relevant altitude and medium for the decision—such as a concise evidence summary, diff, rendered behavior, recording, prototype, architecture view, or operational result—and lets feedback attach to the exact outcome, claim, evidence, or behavior revision it addresses.

The [Graphical Attention Contract](graphical-attention.md) defines how graphical project
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
- Agent-generated native skill surfaces using the harness's integrated Surface Builder capability.

Project surfaces cannot alter shell-owned permission, identity, or recovery controls.

## Working Mode Boundary

Current V1 sessions use the attended human–Pi posture: one interactive lead Pi, continuous Human
Attention during semantic work, optional bounded child Pi work reconciled by the lead, and no
unattended execution beyond the lead session, managed authority, or recovery claim. They do not yet
implement the intended Working Mode control.

The [Working Mode specification](../foundation/working-mode.md) defines the next interface boundary.
Every task must start visibly read-only in Discovering. After enough investigation, Pi must
recommend Alignment and Checking with one short reason; the owner chooses before mutation. The
current values and gate state must remain visible in a fixed session footer and survive session
resume. Mode selection
cannot grant permissions or guarantees, and a PI WEB session identifier is never inferred to be a
Run identifier.

## First graphical slice

The first graphical slice is one Pi Chat per macOS window. A blank window chooses an explicitly
located existing or new session. Its first checkpoint mounts a proper graphical composer with Chat;
its second adds a toggleable right-hand file viewer/editor while Chat remains visible. Each window
keeps transcript, draft, scroll, live events, status, asks, dialogs, selected file, and file edits
scoped to its complete session and workspace identity. A save rejects a stale loaded file version
instead of silently overwriting newer agent or external content. Client replacement does not restart
the PI WEB session daemon.

Workstreams, Git, Terminal, history, and cross-session attention are later slices selected from
observed use. Adding one does not weaken the typed state or complete-identity requirements.

## Workstream control surface

When the Workstream slice is delivered, it provides every supported Workstream action: listing,
creating, inspecting, starting or resuming a session, correcting a checkpoint, adding Human Tasks
and links, and closing.

Every mutation crosses the typed protocol with revision checks and idempotency. Attended-session creation uses the shared Workstream session-coordination module, which records pending before host creation and preserves unknown outcomes for reconciliation. Session-anchor repair additionally crosses the reused PI WEB runtime's typed resolver seam, receives explicit owner confirmation, and appends the bounded catalog-resolution receipt only after an immediate evidence recheck. Mechanical status, checkpoint state, and unresolved Human Tasks remain inspectable without launching another model turn. Managed Run controls belong only to a future approved controller implementation.

## External Adapters

Adapters read and write collaboration-relevant subsets of external systems. Every write is an explicit workflow action with an idempotency key, source run, actor, target version, and recorded result. External changes are imported as events and reconciled before they influence local execution.
