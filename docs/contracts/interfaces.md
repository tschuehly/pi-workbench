# Attention and Interface Specification

The Workbench client presents attended interaction and durable attention without becoming authoritative Run or Workstream state. This contract defines supervision, attention, client ownership, Workstream and Review Surfaces, Working Mode boundaries, and external adapters.

This document is authoritative for attention and interface behavior. [The system overview](../foundation/system-overview.md) remains authoritative for system-wide behavior and boundaries.

## V1 Boundary

Current V1 sessions use the attended human–Pi posture:

- one interactive lead Pi;
- continuous Human Attention during semantic work;
- optional bounded child Pi work reconciled by the lead; and
- no unattended execution beyond the lead session, managed authority, or recovery claim.

V1 provides a terminal-only Working Mode control; graphical selection remains deferred. A PI WEB session identifier is never inferred to be a Run identifier.

Managed supervision, future managed Run controls, and broker-driven prioritization remain outside V1.

## Control and Supervision

Exactly one controlling client holds the Run's live control lease and may request mutating transitions. Other connected clients remain read-only until an explicit ownership transfer grants them control. The controller remains the sole Run-state writer and Pi dispatcher, regardless of which client owns the lease.

While any Dispatch is in flight, one healthy controller supervision loop owns reconciliation. Its deterministic Watcher consumes:

- structured Pi lifecycle events;
- execution observations;
- timers and leases;
- external-adapter results; and
- authority changes.

Routine progress, duplicates, and unchanged observations remain recorded or coalesced without waking a model. The controller creates attention only for an actionable condition:

- Missing or exceeded authority.
- A completed result that requires synthesis, review, Acceptance, or Publication.
- Failure, cancellation, staleness, conflicting evidence, or unknown execution state.
- A material graph, quality, budget, workspace, or external-system conflict.
- A bounded external wait whose recheck condition has matured.

An `AttentionItem` identifies its Run and graph revision, source event, category, urgency, affected work, reconciled current state, required action, evidence references, and deduplication key. The item is persisted before the controller acknowledges the source event. Coordinator-session replacement therefore cannot silently lose actionable work. Coordinator and owner notifications are projections of pending attention, not raw runtime signals.

Portfolio and Project Brokers consume canonical projections and pending Attention Items instead of watching raw logs. Within their scope, they may order, combine, defer, or request preparation of judgments. They cannot grant missing authority or reinterpret Run state.

A higher-scope Broker routes the owner to the Broker, Coordinator, or Review Surface closest to the required judgment. Focused lower-scope conversation returns a bounded Episode rather than its full transcript.

Each named Execution Profile declares a finite attempt ladder. Failed independent review returns typed findings to the next authorized attempt. The controller pauses affected work and creates one deduplicated Attention Item when:

- an attempt ladder or review-failure threshold is exhausted;
- a workspace becomes contaminated or unattributable;
- an input or approval becomes stale;
- an execution or external action has an unknown outcome; or
- budget or authority is exhausted.

Replanning uses a revisioned graph mutation, not unbounded retry.

In managed execution, the live controller host owns the supervision loop; no model session must remain active. Loss of the Coordinator session triggers bounded Pi-session replacement or a persisted `AttentionItem`. These managed supervision semantics are outside V1.

## Stable Workbench Client

The delivered client owns only the capabilities in its current usable slice. Across slices, the client owns:

- A visible boundary between attended interaction and future managed execution.
- Navigation introduced by the current usable slice. Later Workstream, repository, workspace, portfolio, project, worktree, and Run navigation remains client-owned when delivered.
- User, agent, and model identity.
- Authentication, authorization, and permission controls.
- Start, pause, resume, steer, stop, retry, and handoff controls.
- Pending-attention ordering, notifications, and focus transitions into project, Run, work-item, and artifact scope.
- Preservation of the owner's place, unresolved feedback, and changes since the previous judgment.
- Recovery, reconciliation, and cleanup entry points.
- Hosting and isolation of bounded project surfaces.

## First Graphical Slice

The first graphical slice provides one Pi Chat per macOS window. A blank window selects an explicitly located existing or new session.

The first checkpoint mounts a proper graphical composer with Chat. The second adds a toggleable right-hand file viewer and editor while Chat remains visible.

Each window scopes the following state to its complete session and workspace identity:

- transcript, draft, and scroll position;
- live events, status, asks, and dialogs; and
- selected file and file edits.

A save rejects a stale loaded file version rather than silently overwriting newer agent or external content. Replacing the client does not restart the PI WEB session daemon.

Workstreams, Git, Terminal, history, and cross-session attention are later slices selected from observed use. Adding a slice does not weaken typed-state or complete-identity requirements.

## Workstream Surfaces

Workstreams are the primary cross-session attention home. Their graphical surface is a later client slice. Until then, the terminal skill operates the same typed protocol.

When delivered, the cross-repository view:

- lists current and closed Workstreams;
- starts an associated session in exactly one Workstream; and
- shows each session's latest confirmed checkpoint, unresolved Human Tasks, linked files and Runs, revision, and closure state.

The owner uses this mechanical projection directly to decide what to resume. V1 does not launch FirstMate or another broker model.

Human Tasks remain distinct from future managed Run `AttentionItem`s. An advisory Workstream task cannot block or authorize a Run transition.

The active Pi session automatically persists a checkpoint at a meaningful attention change. The owner may correct or replace it later. The interface shows missing, failed, or explicitly stale checkpoints instead of presenting old context as current. Several sessions and Workstreams may remain active concurrently.

### Session location failures and repair

Selecting or opening a session fails with a typed cause:

- missing anchor;
- unavailable machine;
- unavailable project;
- unavailable workspace;
- missing session; or
- transport failure.

The missing-anchor code is `SESSION_ANCHOR_MISSING`. Only that anchor-specific failure offers **Repair session location**. Closed Workstreams and sessions that already have a complete anchor do not offer repair.

Resolution always targets one explicit machine and completes its registered-workspace scan before reporting a unique result. The interface:

- shows a unique catalog match for owner confirmation;
- requires owner selection among multiple exact matches;
- gives different recovery guidance for a missing result and an unavailable or partial scan; and
- has trusted PI WEB code recheck the selected evidence immediately before the append-only repair.

The generic PI WEB session host exposes this discriminated resolver boundary:

```text
resolveSessionLocation({ machineId, sessionId })
  -> { type: "found", location, evidence }
   | { type: "ambiguous", locations: [{ location, evidence }, ...] }
   | { type: "missing" }
   | { type: "unavailable", failedScopes: [...] }

location = { machineId, projectId, workspaceId }
evidence = { machineId, sessionId, location, catalogCwd, evidenceId, matchedCwd, scannedScopeCount, verifiedAt }
```

Every returned `location` is complete. Evidence belongs to the exact match, including each ambiguous candidate, so the caller can recheck the owner-selected identity without broadening the search. `failedScopes` is structured PI WEB diagnostic data; Workbench treats its entries as opaque except for their count.

`evidenceId` is the opaque, stable identity of that exact catalog match. `verifiedAt` records the current complete scan. A recheck may update the scan time or scope count. A change to the match identity or complete location invalidates the pending confirmation.

`machineId` is mandatory. Every `found` or `ambiguous` match must name the requested machine.

A `missing` result means the complete registered-workspace scan succeeded with no exact identity match. An `unavailable` result means one or more scopes could not be checked and therefore cannot be treated as missing.

Workbench ignores unknown additive result fields. It rejects malformed discriminants, incomplete or cross-machine locations, incomplete evidence, and empty unavailable scope lists.

### Workstream control surface

When delivered, the Workstream slice provides every supported action:

- list, create, and inspect Workstreams;
- start or resume a session;
- correct a checkpoint;
- add Human Tasks and links; and
- close a Workstream.

Every mutation crosses the typed protocol with revision checks and idempotency. Attended-session creation uses the shared Workstream session-coordination module. The module records pending state before host creation and preserves unknown outcomes for reconciliation.

Session-anchor repair also crosses the reused PI WEB runtime's typed resolver seam. It requires explicit owner confirmation and appends the bounded catalog-resolution receipt only after an immediate evidence recheck.

Mechanical status, checkpoint state, and unresolved Human Tasks remain inspectable without launching another model turn. Managed Run controls belong only to a future approved controller implementation.

## Review and Project Surfaces

A Review Surface is a task-shaped human judgment interface over the current Run. It selects the altitude and medium appropriate to the decision, such as a concise evidence summary, diff, rendered behavior, recording, prototype, architecture view, or operational result. Feedback attaches to the exact outcome, claim, evidence, or behavior revision it addresses.

The [Graphical Attention Contract](graphical-attention.md) defines how graphical project surfaces present this state. The first layer leads with the required judgment and available action, restores the state needed to resume, and prevents passive activity from competing with attention. Presentation does not weaken evidence, authority, or revision requirements.

Review Surfaces use progressive disclosure. The first layer states:

- the required judgment and why it is material now;
- the recommendation and alternatives;
- consequences and reversibility;
- deferral behavior; and
- the expected human action.

Deeper layers expose comparison criteria, representative successes and failures, independent challenge, Primary Evidence, and source Episodes. Superseded evidence remains traceable but does not compete visually with the current candidate. The surface distinguishes pending, applied, stale, and resolved feedback. It also shows which independent work continues while a judgment is deferred.

Repositories and workflows may provide:

- Declarative dashboards, forms, decision boards, timelines, dependency maps, and review views from a trusted interaction catalog.
- Sandboxed application views for complex experiences such as Atelier.
- Artifact viewers for diffs, tests, screenshots, recordings, reports, and prototypes.
- Agent-generated native skill surfaces using the harness's integrated Surface Builder capability.

Project surfaces cannot alter shell-owned permission, identity, or recovery controls.

## Working Mode Boundary

The [Working Mode specification](../foundation/working-mode.md) defines intended prompt-guided behavior. A new context starts in Vibe; the owner may state Align, Plan, Spec, or a Checking value when useful. Align returns for owner judgment at a semantic commitment boundary rather than mechanically blocking project mutation.

The Pi terminal provides `/mode` with independent pickers and a footer labelled as guidance. It starts at Vibe / unset, applies choices to the next prompt, and resets on reload or session replacement without saving selections. No graphical selector, prior-choice restoration, or mutation gate is implemented. Mode selection can never grant permissions or guarantees.

## External Adapters

Adapters read and write collaboration-relevant subsets of external systems. Every write is an explicit workflow action with an idempotency key, source Run, actor, target version, and recorded result. External changes are imported as events and reconciled before they influence local execution.
