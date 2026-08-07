# FirstMate coordination mate — capability plan

**Status: proposed, NOT approved for V1.** This plan sits below the approved authority chain and does
not redefine any contract. It is gated on one decision (see [Gating decision](#gating-decision)):
whether to unbundle a level-agnostic *coordination mate* from the Level 4 *managed-authority* machinery
that the [system overview](../foundation/system-overview.md) currently bundles under "Portfolio Broker /
FirstMate." Until that decision is recorded in [`decisions.md`](../foundation/decisions.md), treat this
as design exploration, not a commitment.

Evidence for the policy question is the throwaway logic prototype at
[`packages/pi-web-integration/firstmate-decision-prototype.html`](../../packages/pi-web-integration/firstmate-decision-prototype.html).

## Goal

Let one owner run several interactive Pi sessions while a **mate** watches them and, per decision point,
either **notifies the owner** or **lets the session continue** when it judges the call safe with
reasonable certainty — especially for low-spec "vibing." This is [kunchenguid/firstmate](https://github.com/kunchenguid/firstmate)'s
core loop ("talk to one agent, ship with a crew") applied inside Pi Workbench.

## What firstmate is, and how it maps onto Workbench

firstmate is an "agent distro": you talk to one *first mate*; it spawns autonomous crewmates in isolated
git worktrees, supervises them with a zero-token event-driven watcher, escalates only real decisions, and
returns finished PRs, approved local merges, or scout reports. Its mechanisms already have Workbench
counterparts — the mate is not a new architecture, it is a coordination surface plus two missing signals.

| firstmate mechanism | Existing Workbench counterpart | Status |
| --- | --- | --- |
| One *first mate* liaison | Coordinator / Broker (Level 4 concept in [system-overview](../foundation/system-overview.md)) | concept exists |
| *Crewmate* per task | Worker / Subagent — attended child Pi ([`extensions/subagent/`](../../extensions/subagent/index.ts)) | exists (attended) |
| **ship** task | **Ship** authority role ([execution contract](../contracts/execution.md)) | exists |
| **scout** task | **Scout** authority role | exists |
| Disposable git worktree | Repository Workspace `lease/land/release` ([controller](../contracts/controller.md)) | exists |
| Project modes (`no-mistakes`/`direct-PR`/`local-only`) + `yolo` | Autonomy Envelope + Publication actions | concept exists |
| All state on disk, reconcile on restart | Durable controller state + reconciliation | Level 4 |
| **ask-user finding** (pause + decision) | — | **missing** |
| `fm-send` (steer a running worker) | — | **missing** |
| Zero-token watcher + wake types (signal/stale/check/heartbeat) | Workstream `watch` projection | partial (coarse) |
| ask-user-authority + `yolo` posture | Coordination-mate decision policy | **prototype only** |
| Turn-end guard ("no turn ends blind") | — | missing (Level 4) |
| `/afk` away-mode digests | Discontinuous attention | Level 4 |

The decisive gaps are the two signals a mate needs to do anything real, plus the policy that uses them.

## Needed capabilities

### C1 — Session decision signal (pause + confidence)  · *required, buildable now*

A running Pi session, on reaching a choice it would otherwise resolve silently or via `ask_user`, emits a
structured **decision point** rather than only blocking a human:

```
{ sessionId, question, options[], proposedAnswer, confidence: 0..1,
  reversibility: reversible|hard|irreversible, materiality, blastRadius }
```

Today neither seam exposes this. PI WEB has `ask_user`, but the Workbench plugin cannot read it; the
[`PiRpcExecutionAdapter`](../../packages/pi-execution-adapter/) exposes only `dispatch → observe → terminal`
with no decision-point observation. **Build:** add a `decision_point` observation to the execution
`observe` stream (and a matching Workstream projection field) so a watcher can see "this session is paused,
here is the call and how sure it is." `reversibility`/`blastRadius` are first-class because they gate
auto-continue independently of confidence (see C3).

### C2 — Reply channel to a running session  · *required, buildable now*

The mate or the owner sends an answer back into a paused session so it continues. Mirrors firstmate's
`fm-send`. Today the adapter is one-shot with no `send`. **Build:** `adapter.send(executionId, answer)` on
the execution adapter, and a Workstream-mediated `answer` that routes to the live session. Keep it
fail-closed: an answer that cannot be delivered surfaces as an error, never a silent drop.

### C3 — Coordination-mate decision policy  · *required; prototype validated the shape*

Given a decision point and the owner's envelope, decide **auto-continue** vs **escalate**. The
[logic prototype](../../packages/pi-web-integration/firstmate-decision-prototype.html) validated the core
`evaluatePolicy(pending, config)` and the honesty counter ("decisions let proceed without you"). The
prototype used a single confidence threshold; firstmate's ask-user-authority shows why that is not enough:
**destructive, irreversible, and security-sensitive calls escalate regardless of confidence.** So the real
policy is:

```
auto-continue  ⇔  autoContinue enabled
               ∧ confidence ≥ threshold
               ∧ reversibility = reversible
               ∧ materiality within the envelope
```

Everything else escalates. `yolo`/threshold live in an explicit **Autonomy Envelope**, never a global switch.

### C4 — Supervision + attention surface  · *required*

The mate watches N sessions and surfaces, at a glance, **which need you vs. which are running unattended
right now** — the attention-scaling reality the prototype makes visible. Extend the Workstream `watch`
projection with decision-point state and an unattended-progress tally, and present it in the
[PI WEB integration](../../packages/pi-web-integration/) as an advisory panel + a chat you can interrogate.
The mate's cross-session synthesis is **ephemeral and advisory** — it never writes the ledger or checkpoints
(the [Workstream contract](../contracts/workstreams.md) forbids a background model turn from doing so).

### C5 — Away mode + durable reconciliation  · *deferred, Level 4-gated*

firstmate's `/afk` digests, turn-end guard, and restart-proof reconciliation require discontinuous attention
and managed authority. Explicitly out of this plan; it is the genuinely Level 4 part and needs the
[Run Controller](../contracts/controller.md).

## How it fits — invariants preserved

- **The mate grants no authority and never writes a repo.** It coordinates attention; each session keeps its
  own Scout/Ship authority. The Coordinator-never-holds-a-write-lease invariant is untouched.
- **Auto-continue lives only inside an explicit Autonomy Envelope**, and destructive/irreversible/
  security-sensitive decisions always escalate — matching firstmate and the "no blanket autonomy switch"
  boundary in the system overview.
- **Mate synthesis is advisory, not authoritative state.** Decision points and answers are semantic records;
  the digest is ephemeral.
- **Run Controller stays independent of PI WEB**; the mate is a client of typed protocols.

## Staged plan

| Phase | Delivers | Attention posture | Gate |
| --- | --- | --- | --- |
| 0 (done) | Policy logic prototype | — | — |
| 1 | C1 decision signal + C2 reply channel on the execution adapter; mate in **notify-only** mode (auto-continue OFF) | Level 1 — owner present, mate only routes/queues | none beyond normal review |
| 2 | C3 policy with envelope + reversibility axis; C4 attention surface in PI WEB; auto-continue **within envelope** | Level 1–2 — owner present but attention scaled across sessions | **[gating decision](#gating-decision)** |
| 3 | C5 away mode, durable reconciliation, cross-project brokering | Level 4 — discontinuous attention | separate Level 4 decision + Run Controller |

Phase 1 is honest to build now: with auto-continue OFF the mate is pure "watch and notify," which does not
grant autonomy and keeps the owner in the loop. Phase 2 is the "let it continue with reasonable certainty"
step and is what the gating decision unlocks.

## Gating decision

Record in [`decisions.md`](../foundation/decisions.md): *does Workbench unbundle a level-agnostic coordination
mate (attention routing + advisory synthesis, no granted authority) from the Level 4 managed-authority
machinery, and correct the system-overview FirstMate exclusion to name only the managed-authority part?*
Phase 2 depends on "yes." Phase 1 and this document do not.

## Evidence

- Policy prototype: [`packages/pi-web-integration/firstmate-decision-prototype.html`](../../packages/pi-web-integration/firstmate-decision-prototype.html)
- Source: [kunchenguid/firstmate](https://github.com/kunchenguid/firstmate) `README.md` and `AGENTS.md` (task lifecycle, supervision protocol §8, escalation §9, ask-user authority).
