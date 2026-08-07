# Pi Workbench PI WEB integration

This package is the bounded `apiVersion: 1` customization probe from the
[PI WEB customization plan](../../docs/integrations/pi-web/customization-plan.md). It is a PI WEB
browser plugin with a small trusted web-process service, not a Run Controller and not authoritative Run state.

## What the adapter contributes

- **Workstreams navigation entry:** opens a first-class primary view through PI WEB's qualified
  navigation and primary-view interfaces.
- **Workstreams primary view:** presents a portfolio and a dedicated, pane-preserving Workstream
  shell over the typed projection. The shell keeps flat Sessions and Human Tasks panes visible while
  switching among host-owned Chat, Files, and Git surfaces, and opens host-owned Terminal as a
  selected-session checkout drawer. Host actions and shortcuts stay contextual to those surfaces,
  while mobile pane navigation retains access to Sessions, Workspace, and Human Tasks. Checkpoints
  remain contract-compatible per-session checkpoints.
  Git currently shows the selected checkout's observed, unattributed state; historical cross-repository
  commits remain deferred to PI WEB's upstream Git-plugin integration. The view also preserves current
  and closed Workstreams, revision, loading, empty, failure, and reconnect states; creates Workstreams;
  launches, reconciles, and resumes attended sessions; requests and confirms checkpoints; manages
  human tasks and links; closes Workstreams; renders accepted receipts; and reconciles ordered watch
  batches.
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

Session launch uses PI WEB's attended plugin-session helper and `workstream-session-coordinator.js`.
The coordinator records a launch-key pending association before starting PI, confirms the returned
runtime session identity with a complete location, records launch failure, and reconciles
browser-local startup-token associations on reconnect without launching a duplicate session. The
initial prompt carries the Workstream identity and Level 1 boundary into a fresh session.

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

Link this package into PI WEB's local plugin directory:

```sh
mkdir -p ~/.pi-web/plugins
ln -s /path/to/pi-workbench/packages/pi-web-integration ~/.pi-web/plugins/pi-workbench
```

Reload the PI WEB browser tab. The plugin manifest entry should include both `module` and `service`.
Workstreams are portfolio-wide and do not require a selected workspace. Run the deterministic checks with:

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
