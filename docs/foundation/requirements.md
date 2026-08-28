# Pi Workbench V1 requirements and validation

This document preserves product outcomes and system-level validation for the attended workflow. The
[system overview](system-overview.md) defines the architecture, the [Workstream contract](../contracts/workstreams.md)
defines continuity, and the [Workbench UI plan](../plans/workbench-ui.md) sequences the graphical client.

## User outcomes

### Graphical client

1. As a developer, I want one native macOS window to contain one complete Pi Chat, so I can work graphically without navigating a portfolio shell.
2. As a developer opening a window, I want to choose an explicitly located existing or new session, so hidden shell state cannot select the wrong workspace.
3. As a developer using several Chats, I want each window's transcript, draft, scroll, status, live events, and controls isolated from every other window.
4. As a developer, I want a proper graphical composer with ordinary macOS multiline editing, selection, clipboard, undo, navigation, drafts, send, steer, stop, attachments, model/status display, transcript paging, live questions, and extension dialogs available in Chat.
5. As an interruptible developer, I want closing, reloading, or replacing a client window to leave Pi sessions and the session daemon running.
6. As a developer, I want a toggleable file pane beside Chat for viewing and safely editing the selected workspace without silently overwriting newer agent or external changes, while upload, Terminal, Workstreams, Git, and other surfaces wait for observed need.

### Workstreams

7. As an interruptible developer, I want Workstreams to preserve session associations, checkpoints, Human Tasks, links, and closure across client and web-process restarts.
8. As a developer, I want session launch to be idempotent and reconnect-safe, so uncertain responses cannot create duplicate sessions or homes.
9. As a developer, I want each session checkpointed automatically at meaningful attention changes and correctable afterwards, so continuity does not depend on repeated confirmation prompts.
10. As a developer, I want failed writes and explicit checkpoint staleness to preserve the prior confirmed continuation rather than manufacturing current state.
11. As a developer with several topics, I want the canonical Workstream projection to show enough mechanical state to choose what to resume without a broker model turn.
12. As a repository owner, I want Workstream persistence to exclude raw transcripts, routine activity, and linked file contents.
13. As a developer closing a Workstream, I want unresolved items preserved and file cleanup kept explicit.

### Attended execution

14. As a developer, I want to pair with one lead Pi and optionally delegate bounded, visible child work while I remain attended.
15. As an owner, I want graphical presentation and Working Mode to configure interaction without claiming managed authority, workspace isolation, publication rights, or recovery that no code enforces.

## Validation matrix

### First graphical slice

- Launch a blank macOS window; assert it shows only an explicit workspace/session chooser rather than the legacy PI WEB shell.
- Open an existing session; assert transcript paging, live updates, status, pending asks, dialogs, and draft restoration belong to that complete session identity.
- Start a session in an explicitly selected workspace; assert the returned machine/project/workspace/session identity is complete.
- Exercise multiline input, selection, clipboard, undo/redo, macOS navigation shortcuts, draft restoration, send, steer, stop, attachments, inline answers, model/status display, reconnect, and error recovery; accept this checkpoint in attended use before adding Files.
- Toggle the right-hand file pane; assert the tree is scoped to the selected workspace, text and supported images render, text edits survive save and reload, failures remain visible, and unsaved work is not silently discarded.
- Change an open file outside the editor before save; assert the stale save is rejected and the newer content survives until the owner explicitly chooses reload or overwrite.
- Operate two windows on different sessions; assert no selection, draft, scroll, status, transcript, file, or event crossover.
- Close and reload one window; assert another window and the session daemon continue without interruption.
- Run the controlled no-model fixture, an attended composer pass before file work, and an attended Chat-and-file pass before accepting the slice.
- Verify keyboard operation, visible focus, readable text, reduced motion, and supported narrow window sizes.

### Workstream modules

- Exercise `create`, `append`, `inspect`, `list`, `watch`, and `close` through the typed client; assert Store semantics independently from presentation.
- Rebuild current state from the ledger; assert sessions, checkpoints, Human Tasks, links, revision, and closure without a persisted combined narrative.
- Replay exact mutations and reject changed input under a reused idempotency key.
- Submit stale revisions, invalid records, oversized mutations, and illegal transitions; assert deterministic rejection.
- Reconnect after retained and expired sequences; assert ordered replay or canonical snapshot replacement without duplicate state.
- Interrupt session launch before and after the host returns an identity; assert pending reconciliation and no duplicate launch.
- Let an active Pi session write a checkpoint automatically, then correct it; assert the correction supersedes the prior checkpoint.
- Fail a checkpoint write and explicitly mark a checkpoint stale; assert the prior checkpoint remains and no Chat activity is interpreted as canonical staleness.
- Restart the browser client and PI WEB web process; assert Workstream state survives without restarting the session daemon.
- Close a Workstream with unresolved tasks and links; assert preserved state and no file deletion.

### Attended boundary

- Delegate one bounded child task; assert assignment, progress, cancellation, and result remain subordinate to the lead session and create no managed authority.
- Verify V1 launches no background checkpoint model, portfolio broker, managed Run, or unattended semantic work.
