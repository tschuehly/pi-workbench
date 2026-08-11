# DODOREACH Status Widgets Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

Research only. Nothing in this ledger is an accepted recommendation, an approved plan, or a settled
decision. Every classification below is a candidate for a later separate decision.

## Verdict

DODOREACH names private `/show-prompt`, `/extensions`, and `/codex-usage` commands together with
custom status widgets. No implementation, package, screenshot analysis, configuration, or behavioral
description is linked. Their trigger details, data sources, refresh behavior, and usefulness therefore
remain unevaluated. Public Codex-usage widgets corroborate the general interaction class, not the
private implementation; no matching public `/show-prompt` or `/extensions` mechanism was established.

What *is* demonstrable is the surface such widgets would occupy, and there the finding is sharp and
independent of DODOREACH: Pi's status and widget primitives are terminal-only. In an RPC host such as
PI WEB they resolve to no-ops, while `hasUI` still reports true. Workbench already ships an extension
that writes a status line into that void. That asymmetry is a real, cheap-to-verify gap in the
Workbench harness, and it is the only durable finding this source occasions.

## Scope and method

The source is the private-implementation list recorded in
[`dodo-reach-pi-tool-shaping.md`](dodo-reach-pi-tool-shaping.md), which states that DODOREACH's
"status widgets" are private. The assignment confirms the implementation is private and unlinked. No
public artifact was located or is attributed here, and the X thread was not re-fetched during this
pass (anonymous access to `x.com` was blocked; see
[`dodo-reach-pi-mobile-web-ui.md`](dodo-reach-pi-mobile-web-ui.md) for the recorded failure).

Because the source offers no mechanism, the comparison below is deliberately one-sided: it inspects
only demonstrable Pi, PI WEB, and Workbench behavior, at the revisions checked out locally.

| Artifact | Identity | Evidence used |
| --- | --- | --- |
| Pi extension runner | `@earendil-works/pi-coding-agent` `0.84.1`, `dist/core/extensions/runner.js`, `dist/core/extensions/types.d.ts` | `noOpUIContext`, `hasUI()`, `setStatus`/`setWidget`/`setFooter` declarations |
| PI WEB session service | sibling `../pi-web` at `8644d99`, `src/server/sessions/piSessionService.ts` | `sessionUiContext` proxy |
| PI WEB dialog store | same checkout, `src/server/sessions/pendingExtensionDialogStore.ts` | supported dialog kinds |
| Workbench quota startup | `extensions/quota-startup/index.ts` | `ctx.ui.setStatus` and `ctx.hasUI` usage |

## Claim, preserved as a claim

> DODOREACH built personal status widgets for their Pi environment.

That is the complete evidentiary content. Unstated and therefore unevaluated: what the widgets
displayed, where the data came from, how often they refreshed, whether they used `setStatus`,
`setWidget`, `setFooter`, or a custom terminal component, whether they survived RPC hosts, and
whether they changed any outcome. This ledger records no inferred mechanism, because inference here
would be invention.

## What is demonstrable in Pi and PI WEB

### Pi's status and widget surface is a full TUI contract

`ExtensionUIContext` declares `setStatus(key, text)` for footer status, `setWidget(key, content)` for
content above or below the editor — including a component factory — plus `setFooter`, `setHeader`,
`setTitle`, `custom`, and editor manipulation (`dist/core/extensions/types.d.ts`). This is a rich
terminal extension surface, and it is where status or widget output from `ExtensionUIContext` lives.
PI WEB browser plugins have separate host-rendered status regions.

### Under RPC, most of that contract silently disappears

The runner defines `noOpUIContext`, whose `setStatus`, `setWidget`, `setFooter`, `setHeader`,
`custom`, and `editor` members do nothing (`dist/core/extensions/runner.js:88`). PI WEB binds
extensions with `mode: "rpc"` and installs a `Proxy` over the runner's UI context that overrides
exactly five members: `notify`, `theme` (a plain-text theme), and the three dialog primitives
`confirm`, `select`, and `input`. Its own comment is explicit that "every other UI method delegates
to Pi's headless defaults so unsupported surfaces cancel safely instead of hanging"
(`src/server/sessions/piSessionService.ts`, `sessionUiContext`). PI WEB's pending-dialog store
validates only `confirm`, `select`, and `input`
(`src/server/sessions/pendingExtensionDialogStore.ts`).

So in a PI WEB session: notifications are projected into the session notification store and inbox;
dialogs park a daemon-held promise the browser answers; status text and widgets are discarded.

### `hasUI` does not tell an extension whether status will be seen, but `mode` does

`hasUI()` returns `this.uiContext !== noOpUIContext` (`runner.js:275`). PI WEB's proxy is a distinct
object, so `hasUI` reports true in a browser session. An extension that gates on `ctx.hasUI` and then
calls `setStatus` therefore takes the interactive path and writes to nothing. Pi already exposes the
narrower host discriminator: `ctx.mode` is `"tui" | "rpc" | "json" | "print"`, and PI WEB binds
extensions as `rpc`. The gap is not a missing Pi capability query; it is that Workbench's own
`quota-startup` extension does not use the existing one.

### Workbench already writes into that void

`extensions/quota-startup/index.ts` gates on `ctx.hasUI`, then calls
`ctx.ui.setStatus("quota-startup", …"Repairing Claude quota access…")` before the repair and clears it
after. In a PI WEB session the confirm dialog and the notifications appear, and the progress status
does not. The behavior is not broken — the repair still completes and reports through `notify` — but
the only continuous-progress signal in that flow is invisible in the selected Workbench shell.

## Comparison with implemented Workbench reality

Workbench's presentation contract is deliberately projection-based: PI WEB consumes canonical
Workstream projections, and mechanical status, checkpoint state, and unresolved human tasks remain
inspectable without launching another model turn
([`docs/contracts/interfaces.md`](../../contracts/interfaces.md)). Durable status therefore does not
depend on an extension footer at all, which is architecturally stronger than a terminal widget: it
survives restart, reconnect, and session replacement.

The gap is narrower and more concrete than "Workbench lacks status widgets". It is that *ephemeral,
in-flight extension progress* has no PI WEB projection, and extensions cannot detect that. Terminal
Pi users see it; PI WEB users, who are the supported V1 users, do not.

A prior review already recorded the same boundary from the other direction:
[`pi-ecosystem.md`](pi-ecosystem.md) items 16–17 note PI WEB's limited host UI and show
`@narumitw/pi-goal` already using `ctx.mode === "tui"` to select terminal behavior and a non-TUI
fallback. Public Codex-usage widgets also commonly call `setStatus` or `setWidget` without host gating,
so this is an ecosystem compatibility pattern rather than a distinctive DODOREACH mechanism. This
ledger confirms the host boundary at PI WEB `8644d99` and Pi `0.84.1`.

Against the source, the honest position is: there is insufficient evidence to say whether DODOREACH's
widgets are better than anything. They may well be excellent in a terminal; that is unmeasurable from
here and irrelevant to a browser-first client.

## Candidate lessons (none accepted)

- **Experiment — verify and use the existing host discriminator.** Confirm in one terminal session
  and one PI WEB session that `ctx.mode` reports `tui` and `rpc` respectively, then make
  `quota-startup` use status only in TUI and a projected fallback elsewhere. Falsifier: if runtime
  mode disagrees with actual host capabilities, reopen the need for a richer capability query.
  Owning boundary: `extensions/` plus [`docs/contracts/harness.md`](../../contracts/harness.md).
- **Experiment — route in-flight progress through a projected channel.** The narrow, testable version
  is to make `quota-startup`'s repair progress visible in PI WEB using an already-projected primitive,
  and to measure whether the owner can tell a stalled repair from a running one. It must not become a
  second status authority competing with canonical Workstream projections.
- **Insufficient evidence — the widgets themselves.** No adopt, adapt, or reject verdict is possible
  on an unlinked implementation with no described mechanism. Recording it as unknown is the accurate
  outcome.
- **Reject as a shortcut — building Workbench UX on terminal-only primitives.** Any Workbench surface
  that matters must reach the selected shell. Decision 76 already sets the route: prove the need in a
  bounded adapter and contribute a generic extension point upstream rather than assuming the terminal
  contract.

## Open questions

1. Is `ctx.mode` sufficiently truthful across every supported host, or does Workbench need a finer
   capability contract only after a concrete mismatch is observed?
2. Which Workbench extension states are genuinely in-flight and ephemeral, and which belong in a
   durable Workstream projection instead?
3. Does a projected status channel risk competing with attention-first presentation, given that
   PI WEB is required to keep passive activity from competing with required judgment?
4. Is there any public DODOREACH artifact that would turn the widget claim into inspectable evidence,
   and is it worth asking rather than guessing?

## Confidence and limitations

High confidence in the Pi and PI WEB behavior described: each statement is a direct read of the named
file at the named revision. Medium-high confidence in the practical consequence for
`extensions/quota-startup/index.ts`, which was verified by code reading rather than by running a
PI WEB session with a forced repair path; a live confirmation remains outstanding. No confidence in
any characterization of DODOREACH's widgets beyond their claimed existence, and no mechanism for them
is asserted anywhere in this ledger.
