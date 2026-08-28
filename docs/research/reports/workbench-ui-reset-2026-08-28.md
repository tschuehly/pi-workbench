# Workbench UI reset — observed problems and retained lessons

**Date:** 2026-08-28

**Status:** decision evidence, not an implementation plan

## Owner position

The owner is not using the graphical client. The terminal remains the working interface even after substantial PI WEB and Workbench UI implementation.

The owner reported these problems directly:

- The current PI WEB experience is unusable for daily work.
- A proper graphical interface is still wanted; terminal-only operation is not the desired product.
- Workstreams are useful, but many open Workstreams have become stale or hard to interpret.
- Large implementation and review campaigns produced a great deal of code without converging on useful software.
- Planning, coding, and revising the shell repeatedly made it easy to run in circles and deepen the wrong direction.
- The useful PI WEB runtime and selected Chat modules may be worth keeping, while most of the UI should be replaced.
- The replacement should begin with a minimal macOS Chat window, one window per Chat, and improve through real use.
- Historical material should be separated into prior plans, observed failures, owner grievances, retained mechanisms, and evidence instead of remaining one active-looking body of plans.

These are product observations from attended use. They take precedence over an earlier plan's internal completion claims.

## Repository evidence

The implementation reflects the reported complexity:

- `packages/pi-web-integration/pi-web-plugin.js` is 3,069 lines with more than 100 function or class declarations.
- The plugin owns navigation, responsive geometry, overlays, resizing, focus, live regions, Workstream presentation, mounted PI WEB surfaces, Terminal docking, and typed actions in one browser module.
- The unified-shell remediation plan grew to ten phases covering fixtures, shell profiles, composition, visual fidelity, protocol expansion, history, child execution, accessibility, installation, and release.
- The adopted branch completed the controlled fixture and shell-profile seam, while the expected composition mismatch remained red and the Phase 3 implementation was lost with an interrupted worktree.
- The acceptance evidence proves many individual mechanisms but explicitly does not prove the installed product's complete daily workflow.
- At the 2026-08-28 local snapshot, the Workstream Store listed 23 open Workstreams, 73 associated “active” sessions, and 29 unresolved Human Tasks. Thirteen open Workstreams had no ledger update for more than seven days. “Active” records association state, not whether a session process is alive.

The earlier session audit reached the same process diagnosis at broader scale: uncertain outcomes were repeatedly turned into large execution and review loops, producing velocity without proportionate landed value. See [`agent-usage-session-audit-2026-08-27.md`](agent-usage-session-audit-2026-08-27.md).

## What was wrong with the delivery shape

### The plugin seam became the application

The plugin interface was useful for bounded contributions. It was not a good seam for replacing the whole product hierarchy. Workbench rebuilt shell behavior inside a dedicated view while PI WEB retained its own shell responsibilities, creating duplicate ownership and a large adapter.

### Prototype fidelity replaced product use

The prototypes contain valuable interaction ideas, but production work became organized around complete conformance rather than the next usable daily path. A green matrix could not answer whether the owner would choose the interface over the terminal.

### Too many concerns moved together

Shell composition, Workstream semantics, standalone Chats, message history, child execution, responsive behavior, installation, and operational lifecycle were coupled into one release direction. A wrong interaction choice therefore invalidated large amounts of otherwise correct engineering.

### State volume hid attention quality

The Workstream Store preserves useful continuity, but open/active counts accumulated without a truthful “currently alive” meaning or an easy closure routine. More durable records did not automatically make re-entry easier.

## What prior work proved

The prior effort was not empty. It produced reusable behavior:

- PI WEB can keep Pi sessions alive independently from a restartable browser UI.
- Its HTTP/WebSocket clients, parsers, session controller, Chat rendering, Prompt Editor, asks, dialogs, Terminal, Files, and Git surfaces are substantial working modules.
- Workstream mutations can cross a typed plugin service and survive web-process replacement.
- Session launch coordination can record pending before creation and reconcile uncertain outcomes.
- Complete session identity prevents cross-workspace selection errors.
- Deterministic no-model fixtures can exercise real production routes and browser behavior.
- Reconnect, focus restoration, drafts, scroll, narrow layouts, and accessibility need explicit verification.

These mechanisms are retained in [`../../integrations/pi-web/reuse-boundary.md`](../../integrations/pi-web/reuse-boundary.md). Their old composition is not retained as the target.

## New working hypothesis

A useful Workbench client starts as one complete attended interaction, not as a portfolio system. One macOS window presents one Chat. The client reuses PI WEB below that surface and adds navigation or tools only after using the smaller client reveals the next friction.

This hypothesis is intentionally easy to disprove. If the Chat window is not preferable to the terminal, the team can change the surface without first unwinding Workstream navigation, shell profiles, and a complete IDE composition.
