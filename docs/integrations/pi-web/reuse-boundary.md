# What Pi Workbench reuses from PI WEB

**Current boundary:** keep PI WEB's runtime and useful leaf components; replace its application shell
and the Workbench plugin-composed shell.

This lets the first usable client ship without rebuilding session infrastructure or preserving a UI
that failed in daily use.

## First two checkpoints

### 1. Graphical text input

Reuse:

- `SessionController` for transcript and event handling;
- `ChatView`, `FormattedText`, `ToolExecutionView`, `AskUserCard`, and extension dialogs; and
- `PromptEditor` for drafts, attachments, completion, model and thinking controls, steer, and stop.

### 2. Files beside Chat

Adapt `WorkspaceFilesPanel` for a narrow file-only context. Reuse its tree, text and image viewing,
editing, and save behavior. Leave out upload controls and its broad plugin context.

Add one small runtime safeguard to the workspace-file API: save sends the version that was loaded,
and the runtime rejects the write if the file has changed. This prevents the editor from silently
overwriting newer agent or external work.

`TerminalPanel` and `WorkspaceGitPanel` remain unused until later slices justify them.

## Runtime we keep

PI WEB continues to own:

- the server and session daemon;
- session creation, persistence, streaming, cancellation, reconnect, asks, dialogs, notifications,
  and transcript paging;
- projects, workspaces, worktrees, files, Git, terminals, machines, authentication, packaging, and
  lifecycle operations; and
- validated HTTP and WebSocket clients, parsers, shared wire types, the controlled no-model fixture,
  and its isolated acceptance runner.

Pi Workbench continues to own its Workstream Store, typed client validation, host-neutral session
coordination, recorded fixtures, and accurate pure projections.

Reusing a component does not freeze its presentation. Replace it later if real use shows the problem
is inside that component rather than in the surrounding shell.

## UI structure we replace

The new client does not use:

- `PiWebApp` as its root;
- PI WEB project/workspace/session navigation as the product hierarchy;
- shell profiles as the composition mechanism;
- the 3,000-line Workbench browser plugin as an application shell;
- the unified Chats-and-Workstreams navigation model or prototype-fidelity target; or
- adapter-owned responsive geometry, duplicate tool navigation, and reconstructed protected
  controls.

The legacy plugin remains only until the replacement Chat path identifies which service and
projection code still needs extraction. It is fallback and evidence, not the target architecture.

## Safety requirements carried forward

Prior work established requirements worth keeping:

- Select a session by complete machine/project/workspace/session identity.
- Reconnect after a lost response without creating a duplicate session.
- Replace a browser or UI without restarting the session daemon.
- Keep asks, dialogs, drafts, scroll, paging, and live events scoped to the selected Chat.
- Report the cause of failure and available recovery without inventing state.
- Preserve keyboard operation, visible focus, supported narrow layouts, reduced motion, and readable
  text.
- Use deterministic fixtures instead of model calls in ordinary UI tests.
- Read Workstream and Run state only from their typed protocols.

## Fork rules

- Keep the sibling checkout's local `main` as a clean fast-forward mirror of `upstream/main`.
- Use `pi-workbench` as the canonical fork integration branch.
- Workbench-specific composition may live in the fork.
- Contribute generic fixes upstream when useful, but do not make upstream suitability a gate for the
  first client.

## What can wait

Do not create a public frontend package or duplicate PI WEB's wire protocol before the client is
useful. Extract a stable public seam only when a second real client or repeated fork conflicts prove
that it is needed.
