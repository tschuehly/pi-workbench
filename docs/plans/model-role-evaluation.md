# Model–role and profile-instruction evaluation plan

**Status:** proposed; non-authoritative. No binding, profile, or policy changes because of this plan.
**Home:** separate file rather than a section in
[`subagent-worker-iterative-improvement.md`](subagent-worker-iterative-improvement.md), because that
roadmap evaluates delegation *lifecycle* behavior (wakeup, cache posture, status, messaging) with
whole-session questions, while this evaluates *which model and which instruction sentence* a bounded
assignment should get — a different unit, run inside ordinary work.

Reuses existing vocabulary and mechanics; invents no parallel framework:

- Evaluation Case / Trial / Result and the blinding, freezing, and Pareto rules from
  [`model-evaluation-campaign-proposal.md`](../research/reports/model-evaluation-campaign-proposal.md)
  (unimplemented; this plan runs its cases by hand, without the `evals/` runner).
- The evaluation loop, evidence bounds, and independent-evaluator rules of
  [`skills/compound/SKILL.md`](../../skills/compound/SKILL.md), with reports under
  `~/.pi-workbench/compound/sessions/<session-id>/`.
- The promotion rule already in the improvement roadmap: three comparable observations agreeing, or
  one reproducible high-impact failure.
- Leaderboard hypotheses H1–H7 in
  [`model-leaderboard-2026-09-22.md`](../research/reports/model-leaderboard-2026-09-22.md).

**Actors.** *Pia* runs the pairs, records Results, and reports. *Thomas* decides every binding,
profile, and policy change. Pia never edits `routing-policy.json` or `PROFILES` from an eval result.

## (a) Questions

- **Q-M1:** For each Cognitive Role, which model + Model Effort is the cheapest binding (in the
  relevant provider's quota, not API dollars) that reliably meets the role's quality threshold?
- **Q-M2:** Do the profile instruction sentences in `extensions/subagent/index.ts` PROFILES
  (`scout`, `reviewer`, `implementer`) change outcomes at all, against a sentence-free `plain`
  profile with the same tool set? The audit shows 107 scouts writing report files under "Do not
  mutate files" and 8 sessions with commit-authority conflicts, so the sentences are at least partly
  ignored and sometimes wrong.
- **Q-M3:** Is Cognitive Role being used as an effort dial rather than a kind of thinking
  (`problem-solving` chosen for "high")? If effort guidance is what leads actually need, that is a
  guidance change, not a binding change.

`plain` does not exist yet. Q-M2 requires Thomas to approve adding it to PROFILES as an evaluation
arm; until then Q-M2 runs only as sentence-present vs sentence-removed-in-brief, which is weaker.

## (b) Unit of comparison

One **pair**: the same bounded assignment, the same brief text, the same repository SHA, two arms
differing in exactly one dimension (model+effort, or profile sentence), each arm a fresh Subagent
with fresh context, launched from the same lead, background, collected once. Arms run concurrently
where quota allows; otherwise same-order-per-pair is alternated to avoid ordering bias. The lead does
not see arm A's result before arm B returns. Assignments come from real attended work, not synthetic
fixtures — a pair is only comparable if the brief was self-contained and the SHA did not move.

Discard a pair if: the brief changed between arms, either arm hit `preflight_failed`/quota blocking,
the repository mutated under review, or the harness revision differs between arms (the launch receipt
records it).

## (c) Metrics — all already exist or are one command

| Metric | Source |
|---|---|
| result used as-is vs redone/corrected by the lead | lead's own reconciliation, recorded in the pair note |
| material corrections found | blinded cross-family judge (below) |
| truncation | `truncated:true` in the child result details (8,000-char adapter budget) |
| elapsed | launch → terminal receipt timestamps |
| tool-call count | child session log, already parsed for status derivation |
| quota consumed per provider window | `quota-axi --json` before and after, per window `windowSeconds`/`resetsAt` |
| actual binding, effort, quota admission, degraded telemetry | resolver receipt on the launch |
| blinded judgment of the two results | one `independent-review` child, cross-family to *both* arms, given both results with model identity stripped and arm order randomized, asked which better answers the brief and what each missed |

Deterministic evidence outranks the judge. Where a pair's assignment has a mechanical check (tests,
a grep the child claimed, a file that must exist), run it outside both arms and let it decide.

## (d) First candidate pairs

1. **P1 — investigation: Sonnet 5 medium vs Luna high** (H1). 589 requests in two weeks is the
   biggest lever we have; Luna high scores above Sonnet 5 medium on the index at ~1/25 the price
   proxy and moves the role off claude quota. Also carries H2 (truncation is brief-driven, not
   model-driven) at no extra cost.
2. **P2 — profile sentence: `scout` vs sentence-free `plain`, both on the P1 winner** (H7/Q-M2).
   Same role, same brief; tests whether the sentence adds compliance, subtracts capability, or does
   nothing. Needs Thomas to approve the `plain` arm first.
3. **P3 — independent-review of OpenAI-authored diffs: Opus 5 high vs Fable 5.1 medium** (H4). 237
   requests, 15 truncations; Fable medium is +1 index at lower price proxy and half the latency on
   the same claude quota, so a match would buy latency and quota headroom without touching the
   cross-family rule.

Later, in order: mechanics Haiku 4.5 low vs Terra low (H3, quota rebalancing), challenge Fable 5.1
high vs medium (H5), design Sol xhigh vs Astra (H6, contract exception — Astra is override-only).

## (e) Sample size and elapsed time

Honest bound: with ~10 pairs a role-level comparison detects only gross regressions (one arm
truncating, missing evidence, or failing the assignment). Moving a binding on a real quality
difference — say 25% vs 60% "redone" — needs roughly 30–40 paired assignments; smaller differences
are not detectable at our volumes and should not be claimed.

At observed volumes (investigation ~42/day, independent-review ~17/day) and pairing only assignments
that are already bounded and self-contained (call it a third), P1 reaches 10 pairs in about 1
attended day and 30 in under a week; P3 reaches 10 pairs in 2–3 days. P2 piggybacks on P1's
assignments, so it adds runs, not calendar time. Report at 10 pairs as a screen, at 30 as a decision
input. The existing promotion rule still applies: three comparable observations agreeing, or one
reproducible high-impact failure.

## (f) What each outcome drives

- **Cheaper arm matches or wins, ≥30 pairs, no truncation or compliance regression:** Pia proposes
  the binding change; Thomas decides and edits `routing-policy.json` and
  `references/routing-rationale.md`. Never Pia, never automatically.
- **Cheaper arm loses materially:** record the binding as confirmed and stop re-testing it until a
  model, effort, or harness revision changes.
- **Sentence-free `plain` matches the sentence arm:** propose dropping or shortening that sentence in
  PROFILES, keeping only tool-set enforcement, which is mechanical.
- **Sentence arm wins:** keep the sentence and fix its known conflicts (a scout asked to write a
  report; an implementer explicitly authorized to commit) rather than deleting it.
- **Q-M3 shows roles used as an effort dial:** add effort guidance to the role descriptions instead
  of re-binding models.
- **Inconclusive:** change nothing. That is the default and the most likely outcome of a 10-pair
  screen.

## (g) What an eval result may never change on its own

- **Independence rules.** Cross-family routing for `independent-judgment`, `challenge`, and
  `independent-review` stands whatever the scores say; a higher-scoring same-family reviewer is not
  a substitute. Astra cannot review Sol-authored bytes.
- **Fail-closed routing.** Unknown role, unavailable model or effort, exhausted fresh quota, or an
  unpropagated overlay keeps blocking. No eval arm may be run by bypassing the resolver.
- **Checking floors and consequence minimums** in `references/checking.md`, including the disclosed
  single-family degradation for `high`.
- **The Astra Worker-override contract** and the Subagent no-model-override rule
  (`docs/contracts/execution.md`) — those are contract amendments Thomas approves separately.
- **Routing policy from a single pair or a single campaign.** One Trial is never sufficient; changes
  enter through the normal compounding path with provenance and an invalidation trigger.
- **The active checkout.** Eval pairs run inside ordinary attended work; they create no fixture
  branches, no automatic retries, and no relaunches.

## Evidence basis

- `~/.pi-workbench/reports/subagent-audit-20260922/` — usage volumes, receipts per role, truncation
  counts, profile-sentence conflicts, and the review of that synthesis (working evidence, not
  repository state).
- [`model-leaderboard-2026-09-22.md`](../research/reports/model-leaderboard-2026-09-22.md) — H1–H7
  and the caveats that limit them.
- [`model-evaluation-campaign-proposal.md`](../research/reports/model-evaluation-campaign-proposal.md)
  — record shapes and blinding rules if this graduates to a runner.
