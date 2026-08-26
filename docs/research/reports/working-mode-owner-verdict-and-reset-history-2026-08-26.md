# Working Mode owner verdict and reset history — 2026-08-26

**Status: RESOLVED 2026-08-26.** The reassessment this document requested was run and settled the
same day. The outcome is **Decision 69** and [operating
levels](../../foundation/operating-levels.md): one `Checking: light | tests | adversarial` axis,
with a named configuration across axes being an Operating Level. Levels 1–3 are selectable; Level 4
is not, because it is defined by permissions that no code enforces.

This document is retained as the record of how the prior design became overbuilt. The rest of it
describes the state *before* that reassessment.

## Durable state before the reset

The earlier work remains available as evidence:

- The autonomous grill produced
  [Working Mode grill — decisions for verdict](working-mode-grill-decisions-2026-08-08.md) at
  commit `a583264`.
- The bounded Level 1 Entry Preset design is recorded in
  [TUI-first Entry Preset implementation grill](working-mode-tui-implementation-grill-2026-08-11.md)
  at commit `2612fe3`.
- Workstream `ws-multidimensional-working-mode`, revision 6, records the owner's 2026-08-25
  acceptance of the `Feedback | Balanced | Assurance` Entry Preset experiment.
- Workstream `ws-workbench-guiding-principles-20260807` retains the grill checkpoints, linked
  reports, review surfaces, and still-pending Human Tasks.

## Owner signals captured before the reset

During the later verdict walk, the owner gave these signals:

- waive P0;
- accept N1, D1, D3–D5, D11–D16, D18–D19, and the lead version of D21;
- reject D20;
- revise D2 because five provenance values were too many;
- request a plain-language explanation before deciding D6;
- revise D17 because standing guidance depends on the owner-facing knobs.

The discussion explored, but did not settle, these revisions:

- D2: reduce provenance to requested, admitted or guaranteed, and observed; move requirements to
  D3 rather than treating them as provenance.
- D6: avoid a central V1 resolver; require each feature that crosses a human decision boundary to
  provide its own fail-closed mechanical gate.
- D17: classify standing guidance as knob-independent fact, knob-controlled default, or removable,
  and sequence knob-dependent classification after the knobs are defined.
- N1/D22: expose at most three owner-facing controls for plan depth, checking intensity, and
  autonomy, with controls unable to grant unsupported capability or authority.

None of these signals was recorded as a numbered decision or as answers to the older pending grill
Human Tasks. They are retained only as evidence of owner intent at that point in the discussion.

## Reset direction

The owner concluded that the work had become overbuilt and too deep, and asked to restart from
scratch. The next session should not continue the D1–D22 decision tree by default. It should first
separate current supported behavior, the accepted Entry Preset experiment, unresolved proposals,
and the smallest owner need worth solving.

The fresh review should prefer deletion and existing concepts, avoid schemas and resolver machinery,
and ask no more than three prerequisite-free decisions. It must not edit
[decisions.md](../../foundation/decisions.md) or migrate Operating Level terminology until the owner
accepts a new, simpler framing.

## Fresh-session mission — completed

The mission below was carried out on 2026-08-26 through six frontier-based grilling rounds.

> Reset the Working Mode design from first principles. Inspect Workstreams
> `ws-multidimensional-working-mode` and `ws-workbench-guiding-principles-20260807` plus the current
> decisions, Operating Levels, principles, vocabulary, proposal, and grill reports. Produce a short
> owner-facing brief that distinguishes settled guidance from proposals, recommends the minimum
> viable model, and asks at most three prerequisite-free decisions. Treat D1–D22 as research, not
> settled requirements. Do not design schemas, resolvers, provenance pipelines, or settings panels.

### What the reassessment settled

- **The need was real, but not the one the proposal named.** The owner wanted a third control beside
  model and thinking budget. The nine-field vector collapsed to one axis under questioning.
- **`Optimize for: Feedback | Balanced | Assurance` was the right shape with unreadable names.** The
  owner could not read his own accepted values back six weeks later. Values are now named by
  behavior.
- **A configuration across axes *is* an Operating Level.** The ladder and the vector were not rivals:
  axes are the mechanism, Levels are the interface. This makes Levels 2 and 3 buildable today.
- **Permissions are deferred.** A Level configures behavior only. Four of the five deep modules are
  empty directories, so no Level may claim isolation, authority, or recovery.
- **Nothing was deleted.** 54 decisions describing unbuilt behavior moved to [Level 4
  concepts](../level-4-concepts.md); the nine candidate dimensions are recorded as a future axis
  backlog in [operating levels](../../foundation/operating-levels.md).

### Why the earlier attempts failed

All three — the nine-field vector, D1–D21, and the TUI-D1–D13 tree — tried to settle a complete
model before shipping any part of one. Nine months and six design documents produced no code. The
corrective is recorded in the README: add one axis at a time, from observed need.
