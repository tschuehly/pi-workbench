# PI WEB as a Pi Workbench Interface

## Summary

PI WEB is a strong candidate for the eventual graphical shell, but not for the Workbench controller itself. An initial integration does not require a fork.

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

Plugins can access private PI WEB routes, but those routes are explicitly unstable. The Workbench architecture should not depend on them.

PI WEB also assumes trusted users and repositories. It is not itself a sandbox, permission system, or multi-tenant authorization layer. The Workbench controller must enforce the Autonomy Envelope, workspace leases, lifecycle transitions, and authority independently.

## Recommended Approach

### 1. Do Not Fork Initially

First implement and validate the terminal-operated controller and Durable Run Ledger. Then build a PI WEB plugin that provides:

- A Run status panel.
- Pending Attention Items.
- Links to Judgment Dossiers and Primary Evidence.
- Buttons invoking terminal fallback actions.
- Workspace and Run labels.
- Eventually, task-shaped Review Surfaces.

For an early prototype, the plugin can read a generated projection file from the workspace or invoke `pi-workbench` commands in a PI WEB terminal. This validates the user experience without coupling authoritative Run state to PI WEB.

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

## Recommendation

Use PI WEB as a **contribution-first graphical shell candidate**:

1. Prove Workbench orchestration through the terminal.
2. Build a separate PI WEB plugin as a read-oriented projection and Review Surface.
3. Add typed control actions only through the Workbench protocol.
4. Propose generic missing APIs upstream.
5. Fork only if those APIs cannot support the required Stable Workbench Shell.

This preserves a key Pi Workbench principle: **the GUI adds interaction bandwidth without owning workflow semantics.**
