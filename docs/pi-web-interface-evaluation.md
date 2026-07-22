# PI WEB as a Pi Workbench Interface

## Summary

PI WEB is the first graphical-shell adapter candidate, but not the Workbench controller itself. It
is evaluated through the same framework-neutral Run client contract used by T3 Code. The supported
integration begins with PI WEB's documented plugin surface and does not require a fork.

## Why It Fits

PI WEB already provides much of the planned **Stable Workbench Shell**:

- Projects, repositories, worktrees, and workspaces.
- Persistent Pi sessions.
- Multiple concurrent sessions.
- Terminals and file browsing.
- Local and remote machines.
- Browser access across desktop and mobile.
- A browser-plugin system with actions, workspace panels, and labels.

Using PI WEB could avoid rebuilding substantial infrastructure unrelated to the Workbench's core value.

Its established code is a material advantage, not merely an existing visual design. PI WEB already
separates its long-lived Pi session owner from the restartable web and browser processes, maintains
session and workspace projections, reconnects browser event streams, supports remote machines, and
ships installation and operational tooling. Reimplementing those capabilities would consume effort
without validating the Workbench's distinct value: controller-owned Runs, durable attention,
evidence, authority, and Review Surfaces.

The reuse boundary is the product and its supported extension points. Workbench should consume PI
WEB upstream and add a separately owned adapter. Copying PI WEB source into this repository is not
reuse; it is an immediate fork with responsibility for future Pi SDK, browser, mobile, machine,
terminal, packaging, and security changes.

## Current Gaps

The planned Workbench requires graphical clients to consume the canonical Run Controller protocol:

```text
start / submit / inspect / watch
```

PI WEB's documented plugin API currently provides:

- Actions.
- Workspace panels.
- Workspace labels.
- Workspace file operations.
- Terminal commands and prompt interaction.

It does not currently provide stable APIs for:

- Server-side plugin services.
- Subscribing to an external structured Run event stream.
- Controlling sessions at the Workbench protocol level.
- Custom authority and control-lease semantics.
- Shell-level identity, permissions, recovery, and attention handling.
- Durable Run event replay and snapshot reconciliation independent of PI WEB session events.

Plugins can access private PI WEB routes, but those routes are explicitly unstable. The Workbench architecture should not depend on them.

PI WEB also assumes trusted users and repositories. It is not itself a sandbox, permission system, or multi-tenant authorization layer. The Workbench controller must enforce the Autonomy Envelope, workspace leases, lifecycle transitions, and authority independently.

## Recommended Approach

The shared candidate-selection rules and acceptance fixture are defined in [Graphical Shell Strategy](graphical-shell-strategy.md).

### 1. Do Not Fork Initially

First implement and validate the terminal-operated controller and Durable Run Ledger. Then build a PI WEB plugin that provides:

- A Run status panel.
- Pending Attention Items.
- Links to Judgment Dossiers and Primary Evidence.
- Buttons invoking terminal fallback actions.
- Workspace and Run labels.
- Eventually, task-shaped Review Surfaces.

For an early prototype, the plugin can read a generated projection file from the workspace or invoke `pi-workbench` commands in a PI WEB terminal. This validates the user experience without coupling authoritative Run state to PI WEB.

The first adapter should reuse PI WEB's navigation, responsive layout, workspace selection,
connection behavior, and panel hosting. It should not reuse PI WEB session identity as Run identity,
translate Pi messages into lifecycle transitions, or route Workbench mutations through terminal
text once typed client operations are available.

### 2. Package the Integration Separately

A Workbench Pi package could contain both:

- Pi extensions and skills for agent execution.
- A PI WEB browser plugin for graphical projection.

The controller and ledger remain independent deep modules. PI WEB is one client of the Run protocol rather than the owner of workflow semantics.

### 3. Identify API Gaps and Contribute Upstream

After the pilot proves the protocol, request or contribute narrowly scoped PI WEB APIs such as:

- Structured plugin HTTP or client helpers.
- Event-stream subscriptions.
- Custom durable workspace tools.
- Controlled actions with typed results.
- Richer Review Surface hosting.

This is preferable to maintaining a fork if upstream accepts the generic extension points.

## When a Fork Would Be Justified

Fork PI WEB only if the Workbench needs to change core shell behavior that plugins cannot safely extend, for example:

- Replacing PI WEB's primary navigation and Session model with Runs.
- Deeply integrating control leases and lifecycle controls.
- Changing authentication or authorization.
- Embedding the Workbench controller into PI WEB's server or session daemon.
- Dynamically composing full-page generated surfaces.
- Enforcing stronger isolation or multi-user security.
- Extensive productization or branding affecting the whole application.

PI WEB is MIT-licensed, so forking is legally straightforward. The main cost would be continuously integrating upstream improvements to sessions, machines, terminals, mobile UI, and Pi SDK compatibility.

## Candidate Position

Evaluate PI WEB as a **Pi-native graphical-shell candidate**:

1. Prove Workbench orchestration through the terminal.
2. Build a separate PI WEB plugin as a read-oriented projection and Review Surface.
3. Add typed control actions only through the Workbench protocol.
4. Propose generic missing APIs upstream.
5. Fork only if those APIs cannot support the required Stable Workbench Shell.

Evaluate PI WEB first. Continue to T3 Code when PI WEB cannot satisfy the shared fixture without
private APIs or when its Session-centered information architecture prevents an attention-first Run
experience. This ordering captures the value of established Pi-native code without treating sunk
implementation effort as evidence that PI WEB is the correct long-term shell.

Prefer PI WEB when its Pi-native sessions, packages, remote-machine support, mobile browser access, and smaller semantic gap allow a thin adapter. Do not select it solely because it already runs Pi; it must still prove typed Run controls, ordered observation, durable attention, reconnect behavior, and review interactions against the same fixture as T3 Code.

This preserves a key Pi Workbench principle: **the GUI adds interaction bandwidth without owning workflow semantics.**
