# Workbench UI plan

Status: current iterative plan. It supersedes the archived PI WEB shell, plugin-customization, unified-navigation, and prototype-fidelity plans.

## Direction

Build a useful graphical coding client one observable slice at a time. The client uses PI WEB's runtime and selected leaf UI modules, but its navigation and composition belong to Pi Workbench.

The first product is a macOS Chat window with a graphical composer and an embedded file pane, not a portfolio shell:

```text
Pi Workbench.app window
  -> Workbench Chat client
  -> PI WEB HTTP/WebSocket clients
  -> PI WEB server and session daemon
  -> Pi session
```

One window owns one selected Chat and its workspace files. A blank window offers only the choices needed to open or create that Chat.

## Delivery rule

Each slice must be usable for real work before the next slice is chosen. Choose it from observed friction in actual work—not from the archived backlog or a prototype conformance matrix—and validate the need again in the running client.

For each slice:

1. State the user-visible outcome and the behavior kept fixed.
2. Implement the smallest end-to-end path against real PI WEB runtime seams.
3. Verify it with the existing controlled fixture and one attended real-use pass.
4. Use it before selecting the next missing capability.

A historical design may supply a requirement or tested mechanism. It does not make that feature current scope.

## Slice 1 — graphical input, then embedded files

### Outcome

The owner can launch Pi Workbench, open an existing Pi session or start one in an explicitly selected workspace, conduct the full attended conversation with a proper graphical text editor, and view or edit that workspace's files without leaving the Chat window.

### Delivery checkpoints

1. **Graphical input first.** Mount the existing PI WEB `PromptEditor` with the selected Chat. Prove ordinary macOS text editing, drafts, send, steer, stop, attachments, and inline answers in attended use before adding another surface.
2. **Files second.** Add a toggleable right-hand pane by adapting the file tree/viewer/editor behavior in PI WEB's `WorkspaceFilesPanel`. Keep Chat visible on the left; support the workspace tree, text and image viewing, text editing, save, and safe handling of unsaved or externally changed files. Narrow the component's context to file concerns and omit its upload controls rather than importing the plugin panel context, Git, or Terminal.

These are ordered checkpoints in one slice. The file pane does not delay dogfooding the graphical composer.

### Included

- Keep the existing AppKit `WKWebView` wrapper and PI WEB lifecycle management.
- A small blank-window chooser for workspace and existing/new Chat.
- A new Chat is a standalone PI WEB-runtime session and does not create a Workstream implicitly.
- One selected Chat per window, identified by machine, project, workspace, and session.
- Existing PI WEB Chat rendering, formatted messages, tool results, live activity, paging, and scroll behavior where they fit.
- Existing Prompt Editor behavior for drafts, send, steer, stop, attachments, model/status display, and inline asks or extension dialogs.
- A toggleable right-hand file pane scoped to the selected Chat's workspace, reusing `WorkspaceFilesPanel` behavior for tree navigation, text and image viewing, text editing, and save.
- Save submits the loaded file version as a PI WEB runtime precondition. A changed version rejects the write instead of overwriting agent or external edits; reload or explicit overwrite remains a human choice.
- The Workbench Chat client becomes the fork's default web root loaded by the existing macOS wrapper.
- `Command-N` opens another independent Chat window.
- Native tabbing is disabled: remove New Tab, `Command-T`, tab navigation/merge menu items, and tab creation from same-origin links.
- Closing or reloading one window does not restart the session daemon or disturb another Chat.
- Existing sessions can be reopened after application restart.

### Excluded

- Workstreams and cross-Chat attention.
- File upload, Git, Terminal, message trees, editor tabs, project-wide search, and child-execution inspectors.
- Projects or sessions as permanent navigation panes.
- Shell profiles, plugin-composed layout, dashboards, and portfolio views.
- Redesigning PI WEB server, session-daemon, authentication, or persistence.
- A native Swift implementation of Chat.
- Mobile and coarse-pointer clients.

### Acceptance

1. A fresh window shows the chooser and no legacy PI WEB shell.
2. Selecting an existing session opens the correct transcript and receives live updates.
3. Starting a session records an explicit workspace and reaches an operable Chat.
4. The graphical composer supports multiline editing, selection, copy/paste, undo/redo, ordinary macOS navigation shortcuts, draft retention, attachments, send, stream, steer, stop, and inline question answering. This checkpoint passes an attended real Chat before file work begins.
5. The Files pane opens and closes without disturbing Chat, shows only the selected workspace, views text and supported images, edits and saves text, reports save failures, and does not silently discard unsaved changes.
6. If Pi or another process changes an open file after it loads, save rejects the stale edit and offers reload or explicit overwrite; ordinary save never silently clobbers the newer content.
7. Two windows can operate two different sessions without selection, draft, scroll, file, or live-event crossover; one window never contains multiple Chats.
8. Closing, reloading, or replacing the web UI leaves other sessions and the session daemon running.
9. The controlled no-model fixture and an attended real Chat-and-file pass both succeed.

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
- Add Git when switching to an external Git client becomes the next repeated friction.
- Add project-wide search or editor tabs only if the single-file pane proves insufficient.
- Add cross-session attention, Working Mode, history, or child inspection only after the simpler client is in daily use and the missing information is concrete.

Each addition must preserve the one-window/one-Chat model unless real use shows that model is wrong.

## Ownership

### Pi Workbench macOS wrapper

Owns native windows, application menus, same-origin hosting, lifecycle status, and window creation. It does not own Pi session state.

### Workbench web client in the PI WEB fork

Owns the input-first Chat and file composition and later Workbench navigation. It may reuse PI WEB client modules directly while the product seam is being proven; no public frontend framework is required first.

### PI WEB runtime

Owns projects, workspaces, sessions, HTTP/WebSocket transport, reconnect, authentication, terminals, files, Git, remote machines, packaging, and operational lifecycle. Only capabilities used by a delivered slice appear in the Workbench client.

### Pi Workbench protocols

The Workstream Store and future Run Controller remain authoritative for their own state. A client renders typed projections and receipts; Chat text and visual state never become Workstream or Run authority.

## Preserved evidence

The extracted reuse boundary is in [`../integrations/pi-web/reuse-boundary.md`](../integrations/pi-web/reuse-boundary.md). Owner-observed problems and repository evidence are in [`../research/reports/workbench-ui-reset-2026-08-28.md`](../research/reports/workbench-ui-reset-2026-08-28.md). Superseded plans and their disposition are indexed in [`../archive/pi-web-ui/README.md`](../archive/pi-web-ui/README.md).
