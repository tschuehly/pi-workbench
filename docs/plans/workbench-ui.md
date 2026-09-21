# Workbench UI plan

**Current plan:** Checkpoint 1 (text input) shipped 2026-08-31. Thomas accepted on 2026-09-20 that
the next slices are Workstream re-entry and direct Working Mode controls, built and reviewed through
Workbench Chat, with the files pane after them. Evidence: the
[session-interaction analysis](../research/reports/session-interactions-2026-09-20.md).

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

Use `packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs` for the replacement
client. Keep its isolated `HOME`, data, session, socket, port, and browser roots. The runner was
renamed after the replacement scenario passed.

Run it from the Workbench repository:

```sh
root="/tmp/workbench-chat-acceptance-$$"
test ! -e "$root"
node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs \
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

## Accepted slices after Checkpoint 1

Each slice is about 300 lines, ships alone, and is accepted by Thomas using it in Workbench Chat.

| Slice | Outcome for Thomas | Status |
| --- | --- | --- |
| 2a | The chooser lists open Workstreams; each shows a re-entry card (stored goal, one next action with its actor, conflict and open-question warnings, folded Now / So far / About / Continue); **Open session** opens the session that wrote the newest checkpoint | shipped in the PI WEB fork (`7e783b1a`); store `overview.replaced` and `GET /sessions/locate/:sessionId` support it |
| 2b | Answer open Human Tasks from the card; the answer is recorded in the store, not only in chat | shipped in the PI WEB fork (`2dff591a`); routed Chat reload recovery shipped in `76d859d3` |
| 1a | `/mode alignment align` works in Chat and never voids an open `ask_user` question | implemented in Workbench (`b20a205`, `0ab9eab`) and PI WEB (`89c31764`); attended check pending |
| 1b | Extensions publish a disposable per-session state snapshot that the client can read | implemented for Working Mode and child activity (`0ab9eab`, `f1f040c`, `89c31764`); attended check pending |
| 1c | Segmented Alignment and Checking buttons in the Chat window | implemented in PI WEB (`89c31764`); attended check pending |
| 3 | Running and uncollected child agents visible in the window | implemented in Workbench and PI WEB (`f1f040c`, `89c31764`); attended check pending |
| 4 | Mode content that measurably changes behavior | after evidence from the weekly analysis names one change |

Additional owner-requested interaction fixes shipped in the PI WEB fork: Workstream starts now record
pending/confirmed association and preload the continuation draft; Enter steers while the secondary
action queues; Stop restores queued text; queue rows can promote one or all messages (`32ed0ad4`).
The transcript is flat and neutral, keeps thinking visible, and collapses only tool usage (`fe7fbbea`).
Selected Chats can request desktop notifications for completion, questions, dialogs, and errors
while the window is unfocused (`a27df255`). These runtime-backed changes need one session-daemon
restart before attended verification.

## Chat stories from attended use

One row per story in [requirements](../foundation/requirements.md) "Chat presentation and control".
When Thomas changes a story, rewrite the requirement in place and update this row; do not append a
second entry for the same want.

| Story | Status |
| --- | --- |
| 16 Conversation-shaped transcript | bubbles and secondary thinking shipped in the PI WEB fork (`2e372184`); flat transcript with tool-only folding shipped earlier (`fe7fbbea`); attended check pending |
| 17 No hidden history | earlier conversation stays expanded (`e70d71a8`); scroll-to-newest control not built |
| 18 Working Mode in reach | shipped in the PI WEB fork (`b1cc738b`), replacing the separate bar from `89c31764` |
| 19 Interface scale | in progress; Cmd +, Cmd -, and Cmd 0 bindings not built |
| 20 Return to an earlier message | session entry ids now reach the client (`10f83ae0`); per-message revert and edit actions and a visible entry point to the session-tree navigator not built |
| 21 Truthful queue and steering | Enter-steers, Stop-restores, promote one or all shipped (`32ed0ad4`, `208de9f4`); queue order needs one session-daemon restart before attended verification |
| 22 Human sessions first | shipped in the PI WEB fork (`d09da87f`) |
| 23 Legible delegated work | child rows named from the task (`f6bc36a`, takes effect for children launched after a lead restart); child-reported one-line status not built |
| 24 Fast, durable session entry | routed reload recovery shipped (`76d859d3`); session-open latency not addressed |
| 25 Readable on every surface | not addressed since the shell replacement; mobile layout last reported broken on 2026-08-27 |

Decisions already taken: Resume opens the existing session; modes stay guidance only; the
Workstream-level overview replaces the earlier `goal.set` idea; the ten-variant launcher prototype
and the context-view prototypes are superseded by the shipped card and the `agent-audit` explorer.

## Later, only if use demands it

Files beside Chat (Checkpoint 2 above), Terminal, Git, project-wide search, editor tabs, and history
remain uncommitted until real use asks for them.

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
