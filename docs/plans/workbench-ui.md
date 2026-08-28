# Workbench UI plan

**Current plan:** fix text input first, then add files beside Chat. Use both before choosing another
feature.

This plan replaces the archived PI WEB shell, plugin-customization, unified-navigation, and
prototype-fidelity plans.

## What we are building

One native macOS window represents one Pi Chat.

A new window first asks for a workspace and an existing or new session. After selection, the window
shows the Chat. A toggle opens that workspace's files on the right while Chat stays visible on the
left.

```text
Pi Workbench.app window
  -> Workbench Chat and file client
  -> PI WEB HTTP/WebSocket clients
  -> PI WEB server and session daemon
  -> Pi session
```

## Build order

### Checkpoint 1: fix text input

Mount PI WEB's existing `PromptEditor` with the selected Chat. The owner must be able to use normal
macOS text editing instead of composing in the terminal.

This checkpoint is done when an attended real Chat proves:

- multiline editing, selection, copy and paste, undo and redo, and normal macOS navigation shortcuts;
- durable drafts and attachments;
- send, streaming, steer, stop, and inline question answers;
- model and session status, formatted messages, tool results, live activity, transcript paging, and
  correct scroll behavior; and
- reopening an existing session after the app restarts.

Use this checkpoint for real work before starting the file pane.

### Checkpoint 2: add files beside Chat

Add a toggleable right-hand file pane. Adapt the useful file behavior from PI WEB's
`WorkspaceFilesPanel`, but give it a narrow file-only context. Do not import the old plugin panel,
upload controls, Git, or Terminal.

This checkpoint is done when an attended Chat-and-file session proves:

- opening and closing Files does not disturb Chat;
- the tree shows only the selected workspace;
- text and supported images render correctly;
- text files can be edited, saved, and reloaded;
- save failures remain visible;
- switching files or closing the pane never silently discards unsaved edits; and
- a stale editor cannot overwrite newer work.

For stale-save protection, the editor sends the version it loaded as a PI WEB runtime write
precondition. If Pi or another process changed the file, save must fail without changing the newer
content. The owner can then reload or explicitly choose to overwrite.

## Behavior shared by both checkpoints

- Keep the existing AppKit `WKWebView` wrapper and PI WEB lifecycle management.
- A new Chat is a standalone PI WEB session; it does not create a Workstream.
- Identify every Chat by machine, project, workspace, and session.
- Make the Workbench client the default web root in the PI WEB fork.
- `Command-N` opens another independent Chat window.
- Remove native tabbing: New Tab, `Command-T`, tab navigation, Merge All Windows, and tab creation
  from same-origin links.
- Closing or reloading one window must not restart the session daemon or disturb another Chat.
- Two windows must not share selection, drafts, scroll, files, or live events.

## Not in this release

- Workstreams or cross-Chat attention
- File upload, Git, or Terminal
- Message trees, child-execution inspectors, project-wide search, or editor tabs
- Permanent project or session navigation panes
- Shell profiles, plugin-composed layout, dashboards, or portfolio views
- A native Swift Chat implementation
- Mobile or coarse-pointer clients
- A redesign of PI WEB authentication, persistence, server, or session daemon

## How each checkpoint ships

1. State the user-visible outcome and behavior that must remain unchanged.
2. Implement the smallest complete path through real PI WEB runtime seams.
3. Run the controlled no-model fixture.
4. Pass the attended use described above.
5. Use the result before adding more scope.

Choose later work from friction observed in actual use, not from an archived backlog or prototype
matrix. Historical designs may provide evidence; they do not create scope.

## Automated verification

Adapt `packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs` to launch the replacement
client. Keep its isolated `HOME`, data, session, socket, port, and browser roots. Keep the current
script name until the replacement scenario passes; rename it afterwards.

Run it from the Workbench repository:

```sh
root="/tmp/workbench-chat-acceptance-$$"
test ! -e "$root"
node packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs \
  --pi-web-root ../pi-web \
  --root "$root"
```

Acceptance requires a passing run and removal of the owned runtime root and processes. The final
fixture must also prove:

- a fresh window shows the chooser, not the legacy PI WEB shell;
- new and existing sessions use the correct complete identity;
- two windows remain isolated;
- stale file saves are rejected; and
- closing, reloading, or replacing the client leaves other sessions and the session daemon running.

## Later, only if use demands it

Possible later slices include Terminal, Workstream re-entry, Git, project-wide search, editor tabs,
cross-session attention, Working Mode, history, and child inspection. They are not a committed
sequence.

Keep one window per Chat unless real use proves that model wrong.

## Ownership

- **macOS wrapper:** native windows, application menus, same-origin hosting, lifecycle status, and
  window creation. It does not own session state.
- **Workbench web client in the PI WEB fork:** Chat and file composition, then any later Workbench
  navigation.
- **PI WEB runtime:** projects, workspaces, sessions, transport, reconnect, authentication, files,
  Git, terminals, remote machines, packaging, and lifecycle.
- **Pi Workbench protocols:** authoritative Workstream and future Run state. The client renders typed
  projections and receipts; Chat text and visual state never become authority.

## Supporting evidence

- [PI WEB reuse boundary](../integrations/pi-web/reuse-boundary.md)
- [Owner-observed UI failure and retained lessons](../research/reports/workbench-ui-reset-2026-08-28.md)
- [Archived UI plans and their disposition](../archive/pi-web-ui/README.md)
