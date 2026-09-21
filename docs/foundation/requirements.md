# Pi Workbench V1 requirements and validation

> **V1 is an attended human–Pi workflow.** It must preserve Pi sessions and Workstream continuity
> while the graphical client remains a non-authoritative protocol client. Managed Runs, unattended
> semantic work, and unimplemented Working Mode controls are not V1 capabilities.

This document defines product outcomes and system-level validation. The
[system overview](system-overview.md) defines the architecture, the
[Workstream contract](../contracts/workstreams.md) defines continuity, and the
[Workbench UI plan](../plans/workbench-ui.md) sequences the graphical client.

## Required user outcomes

### Graphical client

1. **One Chat per window.** As a developer, I want one native macOS window to contain one complete
   Pi Chat, so I can work graphically without navigating a portfolio shell.
2. **Explicit location.** As a developer opening a window, I want to choose an explicitly located
   existing or new session, so hidden shell state cannot select the wrong workspace.
3. **Window isolation.** As a developer using several Chats, I want each window's transcript,
   draft, scroll, status, live events, and controls isolated from every other window.
4. **Complete graphical composer.** As a developer, I want ordinary macOS multiline editing,
   selection, clipboard, undo, navigation, drafts, send, steer, stop, attachments, model/status
   display, transcript paging, live questions, and extension dialogs available in Chat.
5. **Client replacement without session loss.** As an interruptible developer, I want closing,
   reloading, or replacing a client window to leave Pi sessions and the session daemon running.
6. **Safe, bounded file editing.** As a developer, I want a toggleable file pane beside Chat for
   viewing and safely editing the selected workspace without silently overwriting newer agent or
   external changes. Upload, Terminal, Workstreams, Git, and other surfaces wait for observed need.

### Workstreams

7. **Durable continuity.** As an interruptible developer, I want Workstreams to preserve session
   associations, checkpoints, Human Tasks, links, and closure across client and web-process
   restarts.
8. **Safe session launch.** As a developer, I want session launch to be idempotent and
   reconnect-safe, so uncertain responses cannot create duplicate sessions or homes.
9. **Automatic, correctable checkpoints.** As a developer, I want each session checkpointed
   automatically at meaningful attention changes and correctable afterwards, so continuity does
   not depend on repeated confirmation prompts.
10. **Failure without invented state.** As a developer, I want failed writes and explicit
    checkpoint staleness to preserve the prior confirmed continuation rather than manufacturing
    current state.
11. **Mechanical re-entry state.** As a developer with several topics, I want the canonical
    Workstream projection to show enough mechanical state to choose what to resume without a
    broker model turn.
12. **Sparse persistence.** As a repository owner, I want Workstream persistence to exclude raw
    transcripts, routine activity, and linked file contents.
13. **Explicit cleanup.** As a developer closing a Workstream, I want unresolved items preserved
    and file cleanup kept explicit.

### Attended execution

14. **Bounded delegation.** As a developer, I want to pair with one lead Pi and optionally delegate
    bounded, visible child work while I remain attended.
15. **Truthful controls.** As an owner, I want graphical presentation and Working Mode to configure
    interaction without claiming managed authority, workspace isolation, publication rights, or
    recovery that no code enforces.

### Chat presentation and control

These outcomes come from attended use of Workbench Chat. When the owner changes what he wants,
rewrite the story in place rather than appending a new one. What shipped, and in which commit, is
recorded in the [Workbench UI plan](../plans/workbench-ui.md).

16. **Conversation-shaped transcript.** As a developer reading Chat, I want user and assistant turns
    to read as distinct chat bubbles, thinking to read as clearly secondary to speech, and only tool
    usage to fold.
17. **No hidden history.** As a developer scrolling Chat, I want earlier messages to stay expanded as
    the conversation advances, and a control that returns me to the newest message.
18. **Working Mode in reach.** As a developer changing Alignment or Checking, I want segmented
    controls in the composer action row between Send and the model selector, not a separate bar and
    not a typed command.
19. **Interface scale.** As a developer, I want to enlarge or reduce the whole interface with
    Cmd +, Cmd -, and Cmd 0, persisted across reloads.
20. **Return to an earlier message.** As a developer, I want to send the session back to any earlier
    message from the transcript itself, and to edit a message I sent by mistake and continue from
    there.
21. **Truthful queue and steering.** As a developer with work in flight, I want Enter to steer, Stop
    to return queued text to the composer, queued messages to keep the order I wrote them in, and a
    way to send one or all of them now.
22. **Human sessions first.** As a developer opening All sessions, I want delegated child sessions
    hidden by default and revealable by one toggle.
23. **Legible delegated work.** As a developer watching delegated work, I want each child row to name
    the child by its task, state the goal it was given, and show what it is doing now — reported by
    the child in one line, not inferred from its opening prompt.
24. **Fast, durable session entry.** As a developer, I want opening a session to feel immediate, and
    a client reload or development-server restart to leave me in the same session.
25. **Readable on every surface.** As a developer, I want Chat to stay usable at narrow widths and on
    a phone, in a light or dark theme I choose.
26. **Live work visible from the overview.** As a developer choosing where to go, I want the project
    and Workstream overview to show which sessions are active right now and what they are working
    on, so I can re-enter the work that is moving.

## Validation conditions

### First graphical slice

- Launch a blank macOS window. It must show only an explicit workspace/session chooser, not the
  legacy PI WEB shell.
- Open an existing session. Transcript paging, live updates, status, pending asks, dialogs, and
  draft restoration must belong to that complete session identity.
- Start a session in an explicitly selected workspace. The returned
  machine/project/workspace/session identity must be complete.
- Exercise multiline input, selection, clipboard, undo/redo, macOS navigation shortcuts, draft
  restoration, send, steer, stop, attachments, inline answers, model/status display, reconnect,
  and error recovery. Accept this checkpoint in attended use before adding Files.
- Toggle the right-hand file pane. The tree must be scoped to the selected workspace; text and
  supported images must render; text edits must survive save and reload; failures must remain
  visible; and unsaved work must not be silently discarded.
- Change an open file outside the editor before save. The stale save must be rejected, and the
  newer content must survive until the owner explicitly chooses reload or overwrite.
- Operate two windows on different sessions. No selection, draft, scroll, status, transcript,
  file, or event may cross between them.
- Close and reload one window. Another window and the session daemon must continue without
  interruption.
- Run the controlled no-model fixture, an attended composer pass before file work, and an attended
  Chat-and-file pass before accepting the slice.
- Verify keyboard operation, visible focus, readable text, reduced motion, and supported narrow
  window sizes.

### Workstream modules

- Exercise `create`, `append`, `inspect`, `list`, `watch`, and `close` through the typed client.
  Validate Store semantics independently from presentation.
- Rebuild current state from the ledger. It must contain sessions, checkpoints, Human Tasks,
  links, revision, and closure without a persisted combined narrative.
- Replay exact mutations, and reject changed input under a reused idempotency key.
- Submit stale revisions, invalid records, oversized mutations, and illegal transitions. Each must
  be rejected deterministically.
- Reconnect after retained and expired sequences. The result must be ordered replay or canonical
  snapshot replacement without duplicate state.
- Interrupt session launch before and after the host returns an identity. Pending reconciliation
  must prevent a duplicate launch.
- Let an active Pi session write a checkpoint automatically, then correct it. The correction must
  supersede the prior checkpoint.
- Fail a checkpoint write and explicitly mark a checkpoint stale. The prior checkpoint must remain,
  and no Chat activity may be interpreted as canonical staleness.
- Restart the browser client and PI WEB web process. Workstream state must survive without
  restarting the session daemon.
- Close a Workstream with unresolved tasks and links. State must be preserved, and no file may be
  deleted.

### Attended boundary

- Delegate one bounded child task. Its assignment, progress, cancellation, and result must remain
  subordinate to the lead session and create no managed authority.
- Verify that V1 launches no background checkpoint model, portfolio broker, managed Run, or
  unattended semantic work.
