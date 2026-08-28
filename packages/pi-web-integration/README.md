# Legacy Pi Workbench PI WEB integration

**Status:** implemented legacy UI plus reusable service and fixture code. This package is fallback and historical evidence while the replacement Chat client proves which coordination, fixture, projection, and service modules should survive.

Follow the [current Workbench UI plan](../../docs/plans/workbench-ui.md). The [PI WEB UI archive](../../docs/archive/pi-web-ui/) indexes the former customization and unified-shell plans.

This package contains the former `apiVersion: 1` browser plugin and a small trusted web-process service. It is not a Run Controller and does not own authoritative Run or Workstream state.

## What is here

### Legacy navigation and primary view

The plugin contributes a **Workstreams** navigation entry through PI WEB's qualified navigation and primary-view interfaces. Its unified **Chats + Workstreams** view joins two sources:

- PI WEB's optional public `context.sessionNavigation` inventory; and
- complete canonical Workstream snapshots.

Chats are scoped to the selected PI WEB machine. The plugin classifies them only after both inventories reconcile. A Workstream row opens its brief. A session row waits for its complete host location before opening the host-owned Chat surface. A typed selection failure leaves the previous destination visible.

The view preserves current and closed Workstreams, revision, loading, empty, failure, and reconnect states. It can:

- create and close Workstreams;
- launch, reconcile, and resume attended sessions;
- repair session anchors;
- request and confirm checkpoints;
- show and copy each checkpoint's distinct next-session prompt;
- answer and separately resolve typed Human Tasks;
- append reference links;
- render accepted receipts; and
- reconcile ordered watch batches.

Human Task creation is intentionally unavailable in this adapter. Supported mutations are Workstream creation and closure, attended session start and resume, anchor repair, checkpoint request and confirmation, typed Human Task answer and separate resolution, and reference-link append.

Opening a Workstream shows the Phase 4 full brief: identity and health, truthful resumability, unresolved Human Tasks, retained per-session confirmed-checkpoint fields, a session index, and links. Checkpoints remain contract-compatible per-session checkpoints. Workstream sessions also expose the canonical selected-session **Context** surface. Existing typed Workstream actions and host-owned Chat, Files, and Git surfaces remain available.

Git shows the selected checkout's observed, unattributed state. Historical cross-repository commits remain deferred to PI WEB's upstream Git-plugin integration.

### Responsive and accessible shell behavior

On wide layouts, the hierarchy is either an expanded, bounded, resizable pane or its horizontal collapsed strip—never both. On narrow layouts, the destination stays full width and Workstream navigation becomes a focused overlay that Escape dismisses.

Phase 6 behavior includes:

- one 760-pixel transition for the narrow overlay, including 390- and 320-pixel layouts;
- an inert destination while the overlay owns focus;
- bounded long and crowded navigation;
- no adapter animation when reduced motion is preferred;
- the configured control-size token on every coarse-pointer target;
- reserved coarse separator hit columns instead of overlays on adjacent panes; and
- Chat and Workstream desktop panes clamped between 761 and 980 pixels.

A lifecycle-owned media-query listener immediately reconciles the overlay, one-pane state, scrim, and background accessibility state across zoom, resize, disconnect, and reconnect. It does not leak listeners.

Older hosts without the public session-navigation host get an explicit **Update PI WEB** Workstreams-only fallback. This is distinct from transient inventory unavailability, and the plugin never falls back to private APIs.

Selectable surfaces and collapsed sessions remain navigation landmarks. They use ordinary buttons, `aria-current`, and `aria-expanded` where applicable rather than claiming an incomplete tab pattern. Fixed polite-status and assertive-alert regions announce explicitly classified changes without nested alerts or rebuilds during unchanged watch polls.

Browser-local mode and width values use PI WEB's namespaced preferences host.

### Chat status and Terminal dock

Phase 5 keeps core Chat composition—including inline live asks—mounted intact and requests public hosted-status placement beside the Prompt Editor controls.

Native Chats and Workstream sessions both have a collapsed Terminal bottom dock labelled with the complete anchor. PI WEB continues to own terminal processes and terminal selection. Dock open state and bounded height are browser-local preferences keyed by the complete machine, project, workspace, and session identity; one session cannot inherit another session's dock state.

The dock separator supports pointer and keyboard vertical resizing. Requested height remains bounded independently from rendered height, which adapts to a 60% viewport cap. The view recomputes that bound when it renders. A browser-only resize can leave the previous pixel height in place until the next render because the public adapter lifecycle currently exposes no resize subscription.

### Workspace label, action, and panel

The package also contributes:

- a workspace label showing current Run state or pending Human Attention count;
- an action that opens the qualified `pi-workbench:run.panel` workspace panel; and
- a panel showing Run status, authority, pending Attention Items, activity progressing without the owner, and Primary Evidence.

The panel first reads `.pi-workbench/projection.json` through PI WEB's documented workspace-file helper. If that generated projection is absent, the panel renders [`recorded-projection.json`](fixtures/recorded-projection.json) and explicitly identifies it as a deterministic fixture. The fixture is presentation evidence only.

## Workstream service and fixtures

The Workstreams view calls PI WEB's plugin-scoped JSON service helper through `workstream-client.js`. `workstream-service.js` owns no semantics: it delegates six typed operations to `@pi-workbench/workstream-store`. The Store persists user-local ledgers under `~/.pi-workbench/workstreams`.

Set `PI_WORKBENCH_WORKSTREAM_DIR` only for isolated tests or an intentional alternate user-local location.

`fake-workstream-client.js` and [`recorded-workstreams.json`](fixtures/recorded-workstreams.json) provide deterministic PI WEB test data. Because the projection format omits cancelled associations, a fake rebuilt from projection alone cannot recover their occupied operation tokens. Durable tombstone conformance belongs to the Store tests.

## Pure state and projection seams

The unified-navigation state and Phase 4 projection/view-model modules are deliberately pure and UI-independent.

### `unified-navigation-state.js`

This module:

- joins only complete native and canonical inventories;
- excludes every positive canonical association—including an anchorless legacy association—from Chats;
- owns destination, selection-race, session-scoped surface and Terminal state, and per-Workstream session memory; and
- safely falls back when browser-local surface and Terminal preferences are unavailable.

Preferences use complete, stable machine/session/project/workspace identity. A new session therefore cannot inherit another session's selected surface, dock visibility, or dock height.

Neither an incomplete nor malformed inventory may classify a Chat. During reconnect, retained snapshots remain visible but are labelled non-ready. Restoration and selection are validated only after complete reconciliation.

### `workstream-brief-projection.js`

This module mechanically projects the Phase 4 full brief and selected-session Context from sourced checkpoint, launch, link, and Human Task fields. Continuation is resumable only for an active session with complete checkout anchors. Pending, failed, missing-anchor, and missing states remain explicit.

### `unified-navigation-view-model.js`

This module normalizes only the public immutable native-session snapshot, computes mechanical navigator labels, and shares bounded pointer and keyboard resize behavior.

### `fixtures/unified-navigation.json`

This fixture combines canonically valid current and closed Workstreams with native sessions and separate attention state. It covers:

- archived and unmatched Chats;
- anchor repair;
- pending and failed associations;
- answered and resolved tasks;
- retained checkpoint failure and reconnect snapshots;
- complete empty and unavailable hosts; and
- duplicate-home failure.

### Render stability

Canonical brief and Context Document Object Model (DOM) remains mounted across unchanged watch polls. A canonical revision change rebuilds it under a deterministic render key while preserving scroll position and any focused keyed action.

Root and subregion render keys use bounded-output, cycle-safe stable digests over all input. Cyclic or unexpectedly large host Attention data therefore cannot abort rendering or collapse ordinary large inventories into one key.

## Session coordination protocol

Session launch uses PI WEB's attended plugin-session helper through `workstream-session-coordinator.js`, which adapts the host to `packages/workstream-session-coordination/`.

The shared module follows this sequence:

1. Record a host-namespaced pending association before starting Pi.
2. Start Pi.
3. Confirm the returned runtime identity with a complete location.
4. Reconcile owned startup-token associations without launching a duplicate session.

A checked pre-creation rejection records failure. Transport loss or another unproven outcome remains pending.

The initial prompt carries the Workstream identity, Level 1 boundary, and complete five-field attended-checkpoint guidance into a fresh session. New checkpoints require a separate, non-empty `nextSessionPrompt` no longer than 2,000 characters. Checkpoints created before that field existed show it as unavailable instead of reconstructing it from `next`.

The coordinator exposes guarded checkpoint inspection and launch methods for a future host contribution. This package does not claim a server journal, explicit target-location start, or **Continue in new session** UI.

### Anchor repair

After a typed `SESSION_ANCHOR_MISSING` selection or resume failure, the Workstreams view can call PI WEB's explicit-machine `resolveSessionLocation({ machineId, sessionId })` host boundary.

- A unique match requires confirmation.
- Ambiguous matches require an explicit choice.
- Missing and unavailable scans remain distinct.

Confirmation reruns the resolver, verifies the selected evidence identity, and only then appends `session.anchor.repaired` with bounded complete-scan evidence. Repair is unavailable for closed Workstreams, complete anchors, and unrelated session failures.

### Ownership and watch behavior

The plugin never:

- infers a Run from a PI WEB session;
- calls a private PI WEB route;
- transports a mutation through workspace files or terminal text; or
- injects global CSS.

It polls only the typed `watch` operation and carries the last accepted sequence. Reconnect therefore applies either ordered replay or canonical snapshot reconciliation. Pi Workbench retains ownership of Workstream revisions, validation, idempotency, receipts, and persistence.

## Develop locally

Link the Workbench `packages/` directory into PI WEB's local plugin directory:

```sh
mkdir -p ~/.pi-web/plugins
ln -s /path/to/pi-workbench/packages ~/.pi-web/plugins/pi-workbench
```

`packages/` is the declared plugin root. This lets browser modules in `pi-web-integration/` import the sibling shared coordination package while keeping repository metadata, skills, prompts, and machine-local files outside PI WEB's static asset root.

Reload the PI WEB browser tab. `packages/package.json` should declare both `module` and `service`. PI WEB can serve any asset beneath the linked root, so never put credentials, generated user data, or local `node_modules/` trees under `packages/`.

Workstreams are portfolio-wide and do not require a selected workspace.

Run deterministic checks with:

```sh
cd packages/pi-web-integration
npm run check
```

Do not commit `.pi-workbench/projection.json`; generated Run data is machine-local. A controller or terminal projection command may create the file during an interactive probe.

## Projection version 1

The temporary probe projection contains:

- `run`: stable ID, outcome, status, revision, and read-only authority summary;
- `attention`: action-first judgment, materiality, recommendation, deferral behavior, and revision;
- `activity`: work progressing without owner attention; and
- `evidence`: workspace-relative Primary Evidence paths.

This JSON is not the final Run protocol. The archived campaign proposed replacing it with a framework-neutral Run client, but no current slice depends on that replacement.

## Proven behavior and known gaps

- [`level-1-acceptance-evidence.md`](level-1-acceptance-evidence.md) records the live create, launch, checkpoint, browser-restart, resume, task-preservation, and closure workflow.
- [`v1-probe-evidence.md`](v1-probe-evidence.md) retains earlier contribution-probe evidence and upstream interface gaps.
- [`unified-ui-acceptance-evidence.md`](unified-ui-acceptance-evidence.md) records unified-navigation release gates, the deterministic seed command, screenshots, and remaining browser blockers.
