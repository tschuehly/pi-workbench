# PI WEB reuse boundary

Status: current implementation boundary for the iterative Workbench client.

## Decision

Pi Workbench reuses PI WEB as its runtime and source of selected client modules. It does not use the existing PI WEB application shell or the Workbench shell-profile/plugin composition as its product structure.

This is an intentional fork boundary:

- The sibling checkout's local `main` remains a clean fast-forward mirror of `upstream/main`.
- `pi-workbench` remains the canonical fork integration branch.
- Workbench-specific client composition may live in the fork.
- Generic fixes can still be contributed upstream, but upstream suitability does not shape the first usable client.

## Keep

### Runtime and transport

- PI WEB server and session daemon.
- Session creation, persistence, streaming, cancellation, reconnect, asks, dialogs, notifications, and message paging.
- Project, workspace, worktree, file, Git, Terminal, machine, authentication, package, and lifecycle operations.
- Runtime-validated HTTP and WebSocket clients, parsers, and shared wire types.

### Client modules worth reusing

Reuse these as implementation when they satisfy the current slice:

- `SessionController` and its transcript/event handling.
- `ChatView`, `FormattedText`, `ToolExecutionView`, `AskUserCard`, and extension-dialog rendering.
- `PromptEditor` and its draft, attachment, completion, model, thinking, steer, and stop behavior.
- `TerminalPanel`, `WorkspaceFilesPanel`, and `WorkspaceGitPanel` only when their slices begin.
- The controlled no-model session fixture and isolated acceptance runner.

Reuse does not freeze presentation. A reused module can later be replaced when observed friction is inside that module rather than in the surrounding shell.

### Workbench modules

- Workstream Store and typed client validation.
- Host-neutral Workstream session coordination.
- Recorded Workstream fixtures and pure projections that remain accurate.

## Leave behind

- `PiWebApp` as the Workbench root composition.
- PI WEB's project/workspace/session navigation as the product hierarchy.
- Shell profiles as the Workbench composition mechanism.
- The 3,000-line Workbench browser plugin as a shell implementation.
- Unified Chats + Workstreams navigation state and prototype-fidelity obligations.
- Adapter-owned responsive shell geometry, duplicate tool navigation, and protected-control reconstruction.

The legacy plugin remains in the repository until the replacement Chat path proves the service and projection code that still needs extraction. It is fallback and evidence, not the target architecture.

## Invariants extracted from prior work

The archived work established requirements that remain useful:

- A session selection uses a complete machine/project/workspace/session identity.
- Response loss and reconnect must not create a duplicate session.
- Browser or UI replacement must not restart the session daemon.
- Live asks and extension dialogs stay in the selected Chat.
- Draft, scroll, transcript paging, and live events stay scoped to one session identity.
- Failures state the cause and available recovery without manufacturing state.
- Keyboard operation, visible focus, narrow layouts, reduced motion, and readable text remain baseline quality.
- Deterministic fixtures replace model calls in ordinary UI tests.
- Workstream and Run state come only from their typed protocols.

## Deferred seams

Do not stabilize a separate public frontend package or duplicate PI WEB's wire protocol before the first client is useful. Extract a public seam only when a second real client or repeated fork conflicts demonstrate the need.
