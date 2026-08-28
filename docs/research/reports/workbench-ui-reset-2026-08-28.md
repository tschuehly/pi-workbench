# Why the Workbench UI direction changed

**Date:** 2026-08-28

**Status:** decision evidence, not an implementation plan

## Finding

The graphical client failed its main product test: the owner continued to use the terminal. A later
2026-08-28 prioritization set the replacement order: graphical text input first, then files beside
Chat, rather than another complete shell campaign.

Earlier work still provides useful runtime, session, client, and test machinery. The new direction
keeps those mechanisms and discards their old composition as the target.

## What the owner reported

- The current PI WEB experience is unusable for daily work.
- Terminal-only work is not the desired product; a proper graphical interface is still wanted.
- Workstreams remain useful, but many open Workstreams are stale or hard to interpret.
- Large implementation and review campaigns produced substantial code without useful convergence.
- Repeatedly planning, coding, and revising the shell made it easy to deepen the wrong direction.
- PI WEB runtime and selected Chat components may be worth keeping; most of the UI should be
  replaced.
- The replacement should begin with one macOS window per Chat and improve through real use.
- Current plans, observed failures, owner grievances, retained mechanisms, and historical evidence
  should be kept separate.

These observations come from attended use. They take precedence over completion claims inside an
older plan.

## What the repository showed

The code and plans explain why delivery became difficult:

- `packages/pi-web-integration/pi-web-plugin.js` is 3,069 lines and declares more than 100 functions
  or classes.
- One browser module owns navigation, responsive geometry, overlays, resizing, focus, live regions,
  Workstream presentation, mounted PI WEB surfaces, Terminal docking, and typed actions.
- The unified-shell remediation plan grew to ten phases: fixtures, shell profiles, composition,
  visual fidelity, protocol expansion, history, child execution, accessibility, installation, and
  release.
- The adopted branch completed the controlled fixture and shell-profile seam. The expected
  composition mismatch remained red, and an interrupted worktree lost the Phase 3 implementation.
- Acceptance evidence proved individual mechanisms, not that the installed product supported a
  complete daily workflow.

The Workstream Store also showed accumulation without clear attention quality. At the local
2026-08-28 snapshot it contained:

- 23 open Workstreams;
- 73 associated sessions labelled “active”;
- 29 unresolved Human Tasks; and
- 13 open Workstreams with no ledger update for more than seven days.

“Active” means associated with an open Workstream. It does not mean that a session process is alive.

The broader [agent-usage session audit](agent-usage-session-audit-2026-08-27.md) found the same
process problem: uncertain outcomes repeatedly became large implementation and review loops, which
created activity faster than landed value.

## Why the delivery shape failed

### The plugin became a second application shell

A plugin works for bounded contributions. Here, Workbench rebuilt product hierarchy and shell
behavior inside a plugin while PI WEB retained its own shell. Two places owned presentation, and the
adapter grew accordingly.

### Prototype fidelity replaced product use

The prototypes contained useful interaction ideas, but complete conformance became the delivery
unit. A green matrix could prove visual and mechanical agreement without proving that the owner
would choose the product over the terminal.

### Too many decisions moved together

The campaign coupled shell composition, Workstream semantics, standalone Chats, history, child
execution, responsive behavior, installation, and runtime lifecycle. One wrong interaction choice
could invalidate large amounts of otherwise correct engineering.

### More stored state did not improve re-entry by itself

The Workstream Store preserved continuity, but open and “active” records accumulated without a
truthful liveness meaning or an easy closure routine. Durable state is useful only when it helps the
owner decide what needs attention.

## What remains useful

Earlier work proved that:

- PI WEB can keep sessions alive while the browser UI restarts.
- Its HTTP and WebSocket clients, parsers, session controller, Chat rendering, Prompt Editor, asks,
  dialogs, Terminal, Files, and Git surfaces are substantial working modules.
- Typed Workstream mutations can survive web-process replacement.
- Session launch coordination can record pending state before creation and reconcile an uncertain
  result.
- Complete session identity prevents cross-workspace selection mistakes.
- Deterministic no-model fixtures can exercise production routes and browser behavior.
- Reconnect, focus restoration, drafts, scroll, supported window sizes, and accessibility require
  explicit verification.

The [PI WEB reuse boundary](../../integrations/pi-web/reuse-boundary.md) states exactly what the new
client keeps. Reusable mechanisms do not make their former composition the product target.

## Working hypothesis

A useful Workbench client begins with one complete attended interaction:

1. one macOS window presents one Chat;
2. graphical text input replaces terminal composition;
3. a toggleable file viewer/editor sits beside Chat; and
4. later navigation or tools enter only after use exposes the next problem.

This direction is intentionally cheap to disprove. If the focused window is not preferable to the
terminal, it can change without first unwinding Workstream navigation, shell profiles, or a complete
IDE composition.
