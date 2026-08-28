# Workbench UI plan

Status: current iterative plan. It supersedes the archived PI WEB shell, plugin-customization, unified-navigation, and prototype-fidelity plans.

## Direction

Build a useful graphical coding client one observable slice at a time. The client uses PI WEB's runtime and selected leaf UI modules, but its navigation and composition belong to Pi Workbench.

The first product is a macOS Chat window, not a portfolio shell:

```text
Pi Workbench.app window
  -> Workbench Chat client
  -> PI WEB HTTP/WebSocket clients
  -> PI WEB server and session daemon
  -> Pi session
```

One window owns one selected Chat. A blank window offers only the choices needed to open or create that Chat.

## Delivery rule

Each slice must be usable for real work before the next slice is chosen. Start the next slice from observed friction in the running client, not from the archived backlog or prototype conformance matrix.

For each slice:

1. State the user-visible outcome and the behavior kept fixed.
2. Implement the smallest end-to-end path against real PI WEB runtime seams.
3. Verify it with the existing controlled fixture and one attended real-use pass.
4. Use it before selecting the next missing capability.

A historical design may supply a requirement or tested mechanism. It does not make that feature current scope.

## Slice 1 — one Chat per macOS window

### Outcome

The owner can launch Pi Workbench, open an existing Pi session or start one in an explicitly selected workspace, and conduct the full attended conversation in a dedicated native window.

### Included

- Keep the existing AppKit `WKWebView` wrapper and PI WEB lifecycle management.
- A small blank-window chooser for workspace and existing/new Chat.
- A new Chat is a standalone PI WEB-runtime session and does not create a Workstream implicitly.
- One selected Chat per window, identified by machine, project, workspace, and session.
- Existing PI WEB Chat rendering, formatted messages, tool results, live activity, paging, and scroll behavior where they fit.
- Existing Prompt Editor behavior for drafts, send, steer, stop, attachments, model/status display, and inline asks or extension dialogs.
- The Workbench Chat client becomes the fork's default web root loaded by the existing macOS wrapper.
- `Command-N` opens another independent Chat window.
- Native tabbing is disabled: remove New Tab, `Command-T`, tab navigation/merge menu items, and tab creation from same-origin links.
- Closing or reloading one window does not restart the session daemon or disturb another Chat.
- Existing sessions can be reopened after application restart.

### Excluded

- Workstreams and cross-Chat attention.
- Files, Git, Terminal, message trees, and child-execution inspectors.
- Projects or sessions as permanent navigation panes.
- Shell profiles, plugin-composed layout, dashboards, and portfolio views.
- Redesigning PI WEB server, session-daemon, authentication, or persistence.
- A native Swift implementation of Chat.
- Mobile and coarse-pointer clients.

### Acceptance

1. A fresh window shows the chooser and no legacy PI WEB shell.
2. Selecting an existing session opens the correct transcript and receives live updates.
3. Starting a session records an explicit workspace and reaches an operable Chat.
4. Send, stream, steer, stop, inline question answering, draft retention, and transcript paging work.
5. Two windows can operate two different sessions without selection, draft, scroll, or live-event crossover; one window never contains multiple Chats.
6. Closing, reloading, or replacing the web UI leaves other sessions and the session daemon running.
7. The controlled no-model fixture and an attended real Chat pass both succeed.

### Verification entry point

Adapt `packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs` to start the replacement
client and assert the Slice 1 behavior while preserving its isolated `HOME`, data, session, socket,
port, and browser roots. Keep the existing script until the replacement scenario is green; rename it
only afterwards.

Run the adapted fixture from the Workbench repository:

```sh
root="/tmp/workbench-chat-acceptance-$$"
test ! -e "$root"
node packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs \
  --pi-web-root ../pi-web \
  --root "$root"
```

Completion requires a passing result and removal of the owned runtime root and processes.

## Later slices

Later slices are candidates, not a committed sequence:

- Add Terminal when leaving Chat for terminal work becomes the next repeated friction.
- Add Workstream re-entry when choosing among Chats becomes the next repeated friction.
- Add Files and Git when switching to external tools becomes the next repeated friction.
- Add cross-session attention, Working Mode, history, or child inspection only after the simpler client is in daily use and the missing information is concrete.

Each addition must preserve the one-window/one-Chat model unless real use shows that model is wrong.

## Ownership

### Pi Workbench macOS wrapper

Owns native windows, application menus, same-origin hosting, lifecycle status, and window creation. It does not own Pi session state.

### Workbench web client in the PI WEB fork

Owns the minimal Chat composition and later Workbench navigation. It may reuse PI WEB client modules directly while the product seam is being proven; no public frontend framework is required first.

### PI WEB runtime

Owns projects, workspaces, sessions, HTTP/WebSocket transport, reconnect, authentication, terminals, files, Git, remote machines, packaging, and operational lifecycle. Only capabilities used by a delivered slice appear in the Workbench client.

### Pi Workbench protocols

The Workstream Store and future Run Controller remain authoritative for their own state. A client renders typed projections and receipts; Chat text and visual state never become Workstream or Run authority.

## Preserved evidence

The extracted reuse boundary is in [`../integrations/pi-web/reuse-boundary.md`](../integrations/pi-web/reuse-boundary.md). Owner-observed problems and repository evidence are in [`../research/reports/workbench-ui-reset-2026-08-28.md`](../research/reports/workbench-ui-reset-2026-08-28.md). Superseded plans and their disposition are indexed in [`../archive/pi-web-ui/README.md`](../archive/pi-web-ui/README.md).
