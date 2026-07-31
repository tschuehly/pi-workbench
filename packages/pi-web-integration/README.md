# Pi Workbench PI WEB integration

This package is the bounded `apiVersion: 1` customization probe from the
[PI WEB customization plan](../../docs/pi-web-customization-plan.md). It is a read-oriented PI WEB
browser plugin, not a Run Controller and not authoritative Run state.

## What the probe contributes

- **Workspace label:** current Run state or pending Human Attention count.
- **Action:** opens the qualified `pi-workbench:run.panel` workspace panel.
- **Workspace panel:** presents Run status, authority, pending Attention Items, activity progressing
  without the owner, and Primary Evidence.

The panel first reads `.pi-workbench/projection.json` through PI WEB's documented workspace-file
helper. When that generated projection is absent, it renders the deterministic
[`recorded-projection.json`](fixtures/recorded-projection.json) fixture and says that it is doing so.
The fixture is presentation evidence only.

The plugin never infers a Run from a PI WEB session, calls a private PI WEB route, polls, injects
CSS, or performs a Workbench mutation. Evidence inspection uses the documented workspace-file
helper. Until the framework-neutral Run client exists, mutations remain in the structured terminal
fallback.

## Develop locally

Link this package into PI WEB's local plugin directory:

```sh
mkdir -p ~/.pi-web/plugins
ln -s /path/to/pi-workbench/packages/pi-web-integration ~/.pi-web/plugins/pi-workbench
```

Reload the PI WEB browser tab and select a workspace. The plugin should appear in
`pi-web-plugins/manifest.json`. Run the deterministic checks with:

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

## Proven v1 behavior and gaps

See [`v1-probe-evidence.md`](v1-probe-evidence.md) for the exercised contribution behavior and the
specific upstream interface gaps. That evidence gates any proposal for stable host observation or
additional contribution locations.
