# PI WEB Level Adoption Plan

Status: approved implementation plan.

## Outcome

Use Pi as the model runtime inside PI WEB and progressively add cross-session continuity,
multi-model delegation, deeper alignment, stronger review, and finally controller-managed
unattended execution. PI WEB presents four explicit numbered Entry Presets. The presets are
adjustable starting points, not quality rankings.

Levels 1–3 are unmanaged Pi workflows: they improve interaction and orchestration but do not claim
Run authority, enforced workspace boundaries, or controller-mediated safety. Level 4 is a managed
Workbench Run.

## Implementation sequence

Each step must end in a working vertical slice before the next begins.

### 1. Reconcile Pi and PI WEB

- Upgrade PI WEB's Pi dependencies and peer range to the installed Pi `0.83.0` line rather than
  downgrading the Workbench runtime.
- Verify provider authentication, model availability, fresh quota reporting, session start,
  cancellation, reconnect, and Pi package loading through PI WEB.
- Keep credentials, subscription state, active sessions, and machine-specific configuration local.

**Exit:** PI WEB reliably hosts Pi `0.83.0` sessions and passes its focused runtime checks.

### 2. Implement the Workstream Store

- Create `packages/workstream-store/` behind the interface in
  [`../contracts/workstreams.md`](../contracts/workstreams.md).
- Implement `create`, `append`, `inspect`, `list`, `watch`, and `close` with typed requests and
  receipts, revision checks, idempotency, ordered observation, and deterministic projection
  rebuilding.
- Provide an in-memory adapter for contract tests and a user-local file adapter for real use.
- Persist only concise semantic records. Keep raw transcripts, routine activity, and linked file
  contents outside the ledger.

**Exit:** tests rebuild identical Workstream snapshots from ledger records, replay observation from
a sequence or reconcile from a snapshot, return the original receipt for exact retries, and reject stale revisions, conflicting idempotency-key
reuse, invalid records, and oversized mutations.

### 3. Add navigation and primary views to PI WEB

- Contribute generic navigation-entry and primary-view interfaces upstream.
- Preserve selected view, focus, loading, empty, failure, reconnect, narrow, and mobile behavior.
- Keep authentication, connectivity, settings, recovery, workspace selection, and conversation
  access visible and PI WEB-owned.
- Prove the interfaces with a Workstreams navigation entry, primary view, and deterministic fake
  Workstream client before exposing mutations.

**Exit:** Workstreams are a first-class PI WEB destination over a recorded projection without
private APIs or arbitrary shell replacement.

### 4. Connect the Workstream Store to PI WEB

- Add the smallest stable PI WEB host seam needed to call the Workstream interface from the browser.
- Keep persistence and Workstream semantics in Pi Workbench; PI WEB transports typed requests and
  renders receipts without owning state.
- Do not use workspace files, terminal commands, terminal text, or private browser routes as the
  Workstream mutation transport.
- Retain the deterministic fake Workstream client for PI WEB tests.

**Exit:** PI WEB can create, append to, list, inspect, watch, and close a Workstream across browser
and web-process restarts through the typed interface. Reconnect proves ordered replay or snapshot
reconciliation.

### 5. Deliver the first Workstream workflow

Implement one end-to-end path:

`create Workstream → open Workstream → start Pi session → checkpoint → restart PI WEB → resume → close`

- Require the user to select a Workstream before starting an interactive session.
- Make session launch one idempotent orchestration: record a pending association, start the PI WEB
  session with the Workstream identity, then confirm or fail the association.
- Reconcile pending associations after reconnect, reject a session already assigned elsewhere, and
  avoid orphaned or duplicate session launches.
- Allow several concurrent sessions and Workstreams.
- Show active sessions, each session's latest checkpoint, links, revision, and closure state.
- Begin with an explicit **Checkpoint now** action that launches a fresh, focused Pi context to
  prepare the checkpoint.
- Show checkpoint failure and retain the previous checkpoint as stale rather than current.

**Exit:** a user can leave and resume real work from PI WEB without reconstructing the current plan
from session history or scratch directories. Launch failure and reconnect fixtures produce no
orphaned or multiply-associated sessions.

### 6. Automate checkpointing

- Observe structured PI WEB and Pi session lifecycle events with a deterministic watcher.
- Trial checkpoint triggers for archive, idle, context rotation, and explicit owner action; do not
  settle timing before real concurrent use provides evidence.
- Reuse the manual checkpoint path from Step 5; automation changes only when it is triggered.

**Exit:** several concurrent sessions retain independent, bounded checkpoints without depending on
the working session to remember persistence.

### 7. Add human tasks and FirstMate

- Add human-task changes to the sparse Workstream ledger and derive one cross-Workstream task view.
- Add one FirstMate across all Workstreams. Integrate managed Run attention when Level 4 exists.
- Generate “what should I resume?” on demand from current projections; do not persist a combined
  narrative.
- Let FirstMate recommend closure and cleanup. Never delete linked files without human confirmation.

**Exit:** after time away, the user can see what changed, what needs human action, and which session
or Workstream to resume.

### 8. Add the Entry Preset foundation

- Create the versioned Workbench Pi package for presets, prompts, roles, and extensions.
- Reuse the existing Cognitive Role model router and expose unavailable bindings visibly.
- Add the Level 1–4 selector to the proven PI WEB primary-view interface.
- Keep Levels 1–3 visibly unmanaged and Level 4 controller-managed.
- Pin and source-review `pi-subagents` `0.38.0` as the initial child-Pi mechanism for Levels 1–3.
  Wrap it in a Workbench delegation adapter with bounded concurrency, cancellation, capabilities,
  context, and output.
- Disable package-owned workflows, worktrees, watchdog authority, nested delegation, and open-ended
  review loops.

**Exit:** selecting a Level records the explicit posture and launches only supported model and
capability bindings from the selected Workstream.

### 9. Deliver Level 1

- Use one editing lead with fresh read-only advisory subagents.
- Keep alignment conversational, Human Attention continuous, and verification lightweight.
- Project bounded child status and results through PI WEB; PI WEB does not call `pi-subagents`
  directly or treat child or session state as Workstream or Run state.

**Exit:** one real task completes through Level 1 with recorded routing, child usage, verification,
human corrections, and failure evidence.

### 10. Add Level 2

- Permit lead-directed parallel read and write subagents.
- Use advisory, non-overlapping directory partitions in the shared workspace.
- Do not use package-owned worktrees, auto-commit, or landing behavior.
- Make the lead responsible for reconciliation and whole-workspace verification.

**Exit:** one real parallel task demonstrates useful delegation and makes the unmanaged safety
boundary clear in PI WEB.

### 11. Add Level 3

- Require Grill with Docs and explicit approval of a concise implementation and acceptance contract.
- Send each semantic slice to a fresh context through the same delegation adapter.
- Review with one contract-focused reviewer and one independent cross-model-family reviewer.
- Allow at most two correction cycles before unresolved Material Questions or findings return to the
  human.
- Present the contract, realized changes, evidence, deviations, and residual risks in PI WEB.

**Exit:** one real task completes the full Level 3 contract and bounded review path.

### 12. Add Level 4

- Implement the Run Controller, Pi Execution, Repository Workspace, and Artifact Store interfaces.
- Link each managed Run to its originating Workstream without sharing ledger ownership or authority.
- Replace adapter-owned child launches with controller-validated Dispatches. If `pi-subagents`
  remains, treat it only as private execution plumbing.
- Enforce authority, workspace isolation, attempt bounds, evidence, recovery, Acceptance,
  Publication, analysis, promotion review, and cleanup.
- Support unattended execution without treating prompts or PI WEB sessions as authority.

**Exit:** one real managed Run completes through PI WEB from intake to closure, including a
controlled session-replacement drill and explicit publication decision.

## PI WEB composition boundary

PI WEB becomes extensively but constrainedly composable through typed contribution locations,
semantic presentation tokens, and user-selected shell profiles. Plugins may contribute navigation,
primary views, workspace panels, context and status items, settings, and actions. They cannot inject
arbitrary global CSS, replace undocumented internals, hide protected controls, or own Workbench
state.

## Completion evidence

For each vertical slice, record:

- the exact versions and model bindings used;
- elapsed interaction and model work;
- verification results and human corrections;
- reconnect, focus-restoration, and recovery behavior;
- failures, retries, and unresolved limitations;
- whether the slice reduced the work needed for the next slice.

Do not begin the next step until the current exit condition works end to end in PI WEB. Use the
evidence to adjust later steps without silently changing their authority.
