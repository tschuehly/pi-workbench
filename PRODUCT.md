# Product

<!-- impeccable:product-schema 1 -->

## Platform

A macOS application backed by a local web runtime.

## Users

Pi Workbench serves one software developer working with Pi across sessions, repositories, branches,
and worktrees.

## Product Purpose

Make graphical work with Pi preferable to terminal work, while preserving enough state to leave and
resume without reconstructing the work from transcripts.

Success starts with one complete Chat. New surfaces earn their place through friction observed in
real use.

## Positioning

Pi Workbench owns the product interface. It reuses PI WEB's server, session daemon, transport, and
selected UI components instead of adopting the existing PI WEB shell.

A Workstream preserves attention across related sessions. It links sessions, checkpoints, Human
Tasks, and references. It is not a Chat folder and grants no execution authority.

## Current Product Direction

The graphical client is in daily use: each macOS window holds several Chats in Tabs or Grid, with
a graphical composer, in-composer questions, a Files pane beside Chat, and an Activity roster. The
chooser asks for an explicit workspace and an existing or new Pi session, and shows Workstream
re-entry cards. Each Chat belongs to one window; Chats, drafts, files, and live events stay isolated
between windows.

The base stays PI WEB plus Pi Durable, borrowing T3 mechanisms where useful. Phone access follows
the Durable rebuild; GitHub inside Workbench is deferred. Add nothing else until daily use exposes
the next concrete problem. See the [Workbench UI plan](docs/plans/workbench-ui.md).

## Capabilities and Constraints

- PI WEB runtime owns projects, workspaces, session persistence, transport, authentication,
  reconnect, and operational lifecycle.
- Pi Workbench owns client composition and future Workstream navigation.
- A selected Chat always has a complete machine/project/workspace/session identity. Hidden shell
  state never chooses its workspace.
- Workstream state comes from the typed Workstream protocol, never from Chat text or visual state.
- Checkpoints persist automatically at meaningful attention changes and remain owner-correctable.
- Replacing or closing a client must not restart the session daemon or disturb another Chat.
- File save must reject a stale editor version instead of silently overwriting newer agent or
  external changes.
- File upload, Git, and Terminal are not part of the Workbench client; agents use the `gh` CLI.

## Evidence on Hand

- [Current UI plan](docs/plans/workbench-ui.md)
- [PI WEB reuse boundary](docs/integrations/pi-web/reuse-boundary.md)
- [UI reset evidence](docs/research/reports/workbench-ui-reset-2026-08-28.md)
- [Workstream contract](docs/contracts/workstreams.md)
- [Legacy UI plan disposition](docs/archive/pi-web-ui/README.md)
- Controlled runtime fixture: `packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs`

No customer claims, usage analytics, or validated scale distributions are recorded.

## Product Principles

- Finish one daily-use path before adding navigation around it.
- Let observed friction choose the next slice.
- Keep conversation central and reveal supporting detail only when needed.
- Reuse proven runtime behavior; replace presentation that does not help the owner.
- Keep Workstream and Run protocols authoritative regardless of client design.

## Accessibility & Inclusion

Every delivered slice must support keyboard operation, visible focus, readable text, semantic
status, reduced motion, and its declared window sizes. Accessibility is part of acceptance, not a
later hardening phase.
