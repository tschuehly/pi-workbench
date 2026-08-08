# Pi Workbench PI WEB integration

This package is the bounded `apiVersion: 1` customization probe from the
[PI WEB customization plan](../../docs/integrations/pi-web/customization-plan.md). It is a PI WEB
browser plugin with a small trusted web-process service, not a Run Controller and not authoritative Run state.

## What the adapter contributes

- **Workstreams navigation entry:** opens a first-class primary view through PI WEB's qualified
  navigation and primary-view interfaces.
- **Unified Chats + Workstreams primary view:** joins PI WEB's optional public
  `context.sessionNavigation` inventory to complete canonical Workstream snapshots. Chats are scoped
  to the selected PI WEB machine and are classified only after both inventories reconcile. A
  Workstream row opens its brief; a session row awaits selection of its complete host location before
  opening the host-owned Chat surface. Typed selection failure leaves the prior destination visible.
  Wide layouts render either an expanded, bounded and resizable hierarchy or its horizontal collapsed
  strip—never both. Narrow layouts keep the destination full width and expose Workstream navigation as
  an Escape-dismissable focused overlay. Browser-local mode and width values use PI WEB's namespaced
  preferences host. Phase 6 uses one 760-pixel transition for the narrow overlay (including 390- and
  320-pixel layouts), keeps the destination inert while that overlay owns focus, bounds long and
  crowded navigation and disables adapter animation under reduced-motion preferences. It applies the
  configured control-size token to every coarse-pointer target, reserves coarse separator hit
  columns instead of overlaying adjacent panes, and clamps both Chat and Workstream desktop panes
  between 761 and 980 pixels. A lifecycle-owned media-query listener immediately reconciles the
  overlay, one-pane state, scrim, and background accessibility state across zoom, resize, disconnect,
  and reconnect without leaking listeners. Older hosts without the public
  session-navigation host show an explicit **Update PI WEB** Workstreams-only fallback, distinct from
  transient inventory unavailability, and never use private APIs. Selectable surfaces and collapsed
  sessions remain navigation landmarks with ordinary buttons, `aria-current`, and `aria-expanded`
  where applicable rather than claiming an incomplete tab pattern. Fixed polite-status and assertive-
  alert regions announce explicitly classified changes without nested alerts or rebuilds during
  unchanged watch polls.
  Existing typed Workstream actions and the host-owned Chat/Files/Git surfaces remain available;
  Workstream sessions additionally expose the canonical selected-session **Context** surface. Phase 5
  keeps the core Chat composition (including inline live asks) mounted intact and requests the public
  hosted status placement beside Prompt Editor controls. Both native Chats and Workstream sessions
  have a collapsed, complete-anchor-labelled Terminal bottom dock. Dock open state and bounded height
  are browser-local preferences keyed by complete machine/project/workspace/session identity, while
  PI WEB continues to own terminal processes and terminal selection. Requested heights remain bounded
  independently of the rendered height, which adapts to a 60% viewport cap. The dock separator supports
  pointer and keyboard vertical resizing. The viewport bound is recomputed when the Workbench view
  renders; a browser-only resize can leave the prior pixel height in place until the next render because
  the public adapter lifecycle does not currently expose a resize subscription. Opening a Workstream
  itself shows the Phase 4 full brief: identity and health, truthful resumability,
  unresolved Human Tasks, retained per-session confirmed checkpoint fields, session index, and links.
  Checkpoints remain contract-compatible per-session checkpoints.
  Git currently shows the selected checkout's observed, unattributed state; historical cross-repository
  commits remain deferred to PI WEB's upstream Git-plugin integration. The view also preserves current
  and closed Workstreams, revision, loading, empty, failure, and reconnect states; creates Workstreams;
  launches, reconciles, and resumes attended sessions; requests and confirms checkpoints; presents
  and copies their distinct next-session prompts; manages human tasks and links; closes Workstreams;
  renders accepted receipts; and reconciles ordered watch
  batches. Supported mutations are Workstream creation and closure, attended session start/resume,
  anchor repair, checkpoint request/confirmation, typed Human Task answer and separate resolution,
  and reference-link append. Human Task creation is intentionally not exposed by this adapter.
- **Workspace label:** current Run state or pending Human Attention count.
- **Action:** opens the qualified `pi-workbench:run.panel` workspace panel.
- **Workspace panel:** presents Run status, authority, pending Attention Items, activity progressing
  without the owner, and Primary Evidence.

The panel first reads `.pi-workbench/projection.json` through PI WEB's documented workspace-file
helper. When that generated projection is absent, it renders the deterministic
[`recorded-projection.json`](fixtures/recorded-projection.json) fixture and says that it is doing so.
The fixture is presentation evidence only.

The Workstreams view calls PI WEB's plugin-scoped JSON service helper through
`workstream-client.js`. `workstream-service.js` owns no semantics: it delegates the six typed
operations to `@pi-workbench/workstream-store`, which persists user-local ledgers under
`~/.pi-workbench/workstreams`. Set `PI_WORKBENCH_WORKSTREAM_DIR` only for isolated tests or an
intentional alternate user-local location. The deterministic `fake-workstream-client.js` and
[`recorded-workstreams.json`](fixtures/recorded-workstreams.json) remain available for PI WEB tests.
Because the projection format omits cancelled associations, a fake reconstructed from projection
alone cannot recover their occupied operation tokens; durable tombstone conformance belongs to the Store tests.

The unified-navigation state and Phase 4 projection/view-model seams are intentionally pure and UI-independent:

- `unified-navigation-state.js` joins only complete native and canonical inventories, keeps every
  positive canonical association (including an anchorless legacy association) out of Chats, and
  owns destination, selection-race, session-scoped surface/Terminal, and per-Workstream session
  memory. Browser-local surface and Terminal preferences fall back safely and are keyed by the
  complete stable machine/session/project/workspace identity, so a new session cannot inherit
  another session's selected surface, dock visibility, or dock height.
- `workstream-brief-projection.js` mechanically projects the Phase 4 full brief and selected-session
  Context from sourced checkpoint, launch, link, and Human Task fields. Its continuation projection
  claims resumability only for active sessions with complete checkout anchors and otherwise reports
  pending, failed, missing-anchor, or missing state explicitly.
- `unified-navigation-view-model.js` normalizes only the public immutable native-session snapshot,
  computes mechanical navigator labels, and shares bounded pointer/keyboard resize behavior.
- `fixtures/unified-navigation.json` pairs canonically valid current and closed Workstreams with
  native sessions and separate attention state. It covers archived and unmatched Chats, anchor
  repair, pending/failed associations, answered/resolved tasks, retained checkpoint failure and
  reconnect snapshots, complete empty and unavailable hosts, and duplicate-home failure.

Neither an incomplete nor malformed inventory may classify a Chat. Reconnect keeps retained
snapshots available but labels them non-ready; restoration and selection are validated only after a
complete reconciliation. Canonical brief and Context DOM is retained across unchanged watch polls.
A canonical revision change rebuilds it under a deterministic render key while preserving its scroll
position and any focused keyed action. Root and subregion render keys use bounded-output, cycle-safe
stable digests over all input so cyclic or unexpectedly large host Attention data cannot abort
rendering or collapse ordinary large inventories into one key.

Session launch uses PI WEB's attended plugin-session helper through `workstream-session-coordinator.js`, which adapts the host to `packages/workstream-session-coordination/`. The shared module records a host-namespaced pending association before starting Pi, confirms the returned runtime identity with a complete location, and reconciles owned startup-token associations without launching a duplicate session. Checked pre-creation rejection records failure; transport loss or another unproven outcome remains pending. The initial prompt carries the Workstream identity, Level 1 boundary, and complete five-field attended checkpoint guidance into a fresh session. New checkpoints require a separate non-empty
`nextSessionPrompt` of at most 2,000 characters; checkpoints created before that field existed
present it as unavailable rather than constructing it from `next`. The coordinator exposes guarded
checkpoint inspection and launch methods for the future host contribution, but this package does not
yet claim the server journal, explicit target-location start, or **Continue in new session** UI.

After a typed `SESSION_ANCHOR_MISSING` selection or resume failure, the Workstreams view can call PI
WEB's explicit-machine `resolveSessionLocation({ machineId, sessionId })` host boundary. A unique
match requires confirmation; ambiguous matches require an explicit choice; missing and unavailable
scans remain distinct. Confirmation re-runs the resolver, checks the selected evidence identity, and
only then appends `session.anchor.repaired` with bounded complete-scan evidence. No repair is offered
for closed Workstreams, complete anchors, or unrelated session failures.

The plugin never infers a Run from a PI WEB session, calls a private PI WEB route, transports a
mutation through workspace files or terminal text, or injects global CSS. It polls only the typed
`watch` operation, carrying the last accepted sequence so reconnect applies ordered replay or a
canonical snapshot reconciliation. Workstream revisions, validation, idempotency, receipts, and
persistence remain in Pi Workbench.

## Develop locally

Link the Workbench `packages/` directory into PI WEB's local plugin directory. `packages/` is the
declared plugin root so browser modules in `pi-web-integration/` can import the sibling shared
coordination package while repository metadata, skills, prompts, and machine-local files remain
outside PI WEB's static asset root.

```sh
mkdir -p ~/.pi-web/plugins
ln -s /path/to/pi-workbench/packages ~/.pi-web/plugins/pi-workbench
```

Reload the PI WEB browser tab. `packages/package.json` should declare both `module` and `service`.
PI WEB can asset-serve files beneath this linked root, so never place credentials, generated user data,
or local `node_modules/` trees under `packages/`. Workstreams are portfolio-wide and do not require a selected workspace. Run the deterministic checks with:

```sh
cd packages/pi-web-integration
npm run check
```

Do not commit `.pi-workbench/projection.json`; generated Run data is machine-local. A controller or
terminal projection command may create it during an interactive probe.

## Projection version 1

The temporary probe projection contains:

- `run`: stable id, outcome, status, revision, and read-only authority summary.
- `attention`: action-first judgment, materiality, recommendation, deferral behavior, and revision.
- `activity`: work progressing without owner attention.
- `evidence`: workspace-relative Primary Evidence paths.

This JSON is not the final Run protocol. Phase 7 replaces the projection source with the
framework-neutral Run client while retaining this deterministic fixture.

## Proven behavior and gaps

See [`level-1-acceptance-evidence.md`](level-1-acceptance-evidence.md) for the live create, launch,
checkpoint, browser-restart, resume, task-preservation, and closure workflow. Earlier contribution
probe evidence and upstream interface gaps remain in [`v1-probe-evidence.md`](v1-probe-evidence.md).
The unified navigation release gates, deterministic seed command, screenshots, and remaining browser
blockers are recorded in [`unified-ui-acceptance-evidence.md`](unified-ui-acceptance-evidence.md).
