# Product

<!-- impeccable:product-schema 1 -->

## Platform

macOS application backed by a local web runtime

## Users

Pi Workbench serves one software developer conducting attended work with Pi and returning to related work across sessions, repositories, branches, and worktrees.

## Product Purpose

Pi Workbench provides a graphical working surface that is preferable to the terminal while preserving durable attention across sessions. Success begins with one complete Chat and grows only from friction observed in daily use.

## Positioning

The Workbench client is its own product interface. It reuses PI WEB's server, session daemon, transport, and selected leaf UI modules rather than adopting the existing PI WEB application shell.

A Workstream is a finite cross-session attention container. It links independently anchored sessions, checkpoints, Human Tasks, and references; it is neither a Chat folder nor an execution-authority boundary.

## Current Product Direction

The first slice is one Chat per macOS window:

- A blank window selects an explicit workspace and an existing or new Pi session.
- The selected Chat fills the window.
- The owner can read, send, steer, stop, answer live questions, and return to persisted sessions.
- Several windows may operate independent Chats without state crossover.

Workstreams remain useful and supported through their Store and terminal skill, but they do not enter the graphical client until the Chat slice is useful in daily work.

## Capabilities and Constraints

- PI WEB runtime owns session persistence, projects, workspaces, transport, authentication, reconnect, and operational lifecycle.
- The Workbench client owns its composition and later Workstream navigation.
- Every selected session uses a complete machine/project/workspace/session identity; hidden current-workspace state never chooses a Chat anchor.
- Workstream state comes from the typed Workstream protocol, never Chat text or visual state.
- Checkpoints persist automatically at meaningful attention changes and remain correctable by the owner.
- Browser or client replacement must not restart the session daemon or disturb unrelated Chats.
- Working Mode, Files, Git, Terminal, Workstreams, history, and child inspection join the client only through later observed-need slices.

## Evidence on Hand

- Current UI plan: `docs/plans/workbench-ui.md`
- PI WEB reuse boundary: `docs/integrations/pi-web/reuse-boundary.md`
- UI reset evidence: `docs/research/reports/workbench-ui-reset-2026-08-28.md`
- Workstream semantics: `docs/contracts/workstreams.md`
- Legacy UI plans and disposition: `docs/archive/pi-web-ui/README.md`
- Controlled runtime fixture: `packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs`

No customer claims, usage analytics, or validated scale distributions are currently recorded.

## Product Principles

- Deliver one complete daily-use path before adding navigation around it.
- Let observed friction choose the next slice.
- Keep conversation central and supporting detail absent until needed.
- Reuse proven runtime behavior; replace presentation that does not serve the owner.
- Keep Workstream and Run protocols authoritative regardless of client design.

## Accessibility & Inclusion

Every delivered slice preserves keyboard operation, visible focus, readable text, semantic status, reduced-motion behavior, and operability at the supported window sizes. Accessibility is part of each slice rather than a final hardening phase.
