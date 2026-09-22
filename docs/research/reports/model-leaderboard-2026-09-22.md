# Model leaderboard read for our catalog — 2026-09-22

**Status:** research note; non-authoritative. It changes no binding. Candidate changes below are
hypotheses to test, not recommendations.

## Scope and source

Owner direction was to check `artificialanalysis.ai/leaderboards/models` before touching any model
binding. The text extract used here was fetched 2026-09-22 and is kept with the subagent audit at
`~/.pi-workbench/reports/subagent-audit-20260922/leaderboard-2026-09-22.md`; it was not re-fetched
for this note. Usage volumes come from `usage-by-role-2026-09-22.md` in the same directory (107
audited lead sessions, 2026-09-08..22). Current bindings are
`skills/model-orchestration/references/routing-policy.json` (version 3).

Columns used: **Intelligence** = the site's composite index; **Price** = its blended `$/1M tokens`;
**Latency** = seconds to first answer token; **Total** = end-to-end response seconds.

## Where our bindings sit

| Role (receipts, 2 wks) | Binding | Index | Price | Latency → total | Cheaper-or-stronger rows on the page |
|---|---|---|---|---|---|
| investigation (318 + 10 override) | Sonnet 5 medium | 28 | $1.00 | 2.7 → 10.1 s | Luna high 32 @ $0.04; Terra medium 30 @ $0.18; Sol medium 39 @ $0.50 |
| independent-review (178/24/3) | Opus 5 high / Sol high / Grok 4.6 high | 48 / 42 / 44 | $3.61 / $0.81 / $1.86 | 15.0 / 12.1 / 42.8 s | Fable 5.1 medium 49 @ $2.98; Astra high 51 @ $1.73 (same family as Sol — not independent of it) |
| coordination (120) | Sol high | 42 | $0.81 | 12.1 → 19.1 s | Terra high 34 cheaper but weaker |
| implementation (81) | Sol medium | 39 | $0.50 | 5.1 → 12.9 s | Opus 5 low 39 @ $1.10 (same index, claude quota) |
| problem-solving (70 + 76 Luna override) | Sol high | 42 | $0.81 | 12.1 → 19.1 s | Grok 4.6 medium 43 @ $1.50 |
| independent-judgment (43) | Fable 5.1 low / Sol medium / Grok 4.6 high | 47 / 39 / 44 | $2.37 / $0.50 / $1.86 | 8.0 / 5.1 / 42.8 s | Fable low already outscores Sol max (47) |
| challenge (30) | Fable 5.1 high / Sol xhigh / Grok 4.6 high | 51 / 44 / 44 | $3.91 / $1.18 / $1.86 | 23.6 / 31.2 / 42.8 s | Fable medium 49 @ $2.98 at 8.6 s |
| mechanics (29) | Haiku 4.5 low | 17 | $0.21 | 21.0 → 26.5 s | Luna low 21 @ $0.01; Terra low 27 @ $0.14; both 1M ctx vs Haiku's 200k |
| synthesis (26) | Opus 5 high | 48 | $3.61 | 15.0 → 23.9 s | Fable 5.1 medium 49 @ $2.98 |
| design (15 + 10 Astra + 7 Fable 5) | Sol xhigh | 44 | $1.18 | 31.2 → 38.1 s | Astra medium 50 @ $1.54 at 5.7 s latency |
| escalation (2) | Sol max | 47 | $1.99 | 120.8 → 126.7 s | Astra high 51 @ $1.73 at 69 s; Fable 5.1 high 51 |

Shape of the curve for our catalog: the index saturates near 53 (Fable 5.1 max/xhigh, Astra max) and
price rises far faster than index above ~46. Our ladder is mostly built on the flat part.

## Striking gaps

1. **Investigation is the largest lever and the worst-placed binding.** Sonnet 5 medium is index 28
   at $1.00 — the second-lowest index of any binding we use, and Sonnet 5 is the one model whose
   effort ladder collapses at the bottom (low 24, medium 28, high 32). Luna high scores 32 at $0.04
   with 138 t/s output, and 589 investigation requests in two weeks make this the highest-volume
   role. The audit's 107 auditors ran on Luna high and produced consistent bounded analyses (Astra
   spot-check of 17: counting inconsistencies, no wrong facts) — suggestive, not a quality ranking.
2. **Investigation truncation is the visible failure, not intelligence.** 18 of 318 investigation
   results exceeded the 8,000-character adapter budget. A cheaper model does not fix that; brief
   shape and result budget do. Any investigation comparison must measure truncation separately.
3. **Astra high (51, $1.73) outscores every binding we actually use, including Sol max (47, $1.99)
   and Opus 5 high (48, $3.61).** It is a Worker-override only today. It is also OpenAI family, so
   it can never supply independence from Sol-authored bytes — the constraint is structural, not
   score-based.
4. **Escalation's top rung is not our strongest available model.** Sol max costs 120.8 s to first
   token for index 47, below Fable 5.1 high, Astra high, and Opus 5 high. With 2 escalation requests
   in two weeks this is cheap to leave alone; it matters only if escalation starts being used.
5. **Judgment vs challenge effort spread is small.** Fable 5.1 low (47) to high (51) buys 4 index
   points for 1.6× price and 3× latency; Fable medium (49, $2.98, 8.6 s) sits between them and beats
   Opus 5 high on index at lower price. If the index tracks anything we care about, our judgment
   panel already has the cheaper-faster option unused.
6. **Mechanics is bound to the weakest model in the catalog on the scarcest quota.** Haiku 4.5 is
   index 17 with a 200k context, drawing claude quota that the rationale reserves for specialist
   value, while Luna low (21) and Terra low (27) are cheaper, have 1M context, and draw codex quota.
   Volume is small (29), so the payoff is quota rebalancing, not quality.
7. **Within-family effort steps are bought with latency, not price.** Fable 5.1 high → xhigh is +2
   index and 23.6 → 187.9 s to first token; Astra high → max is +2 index and 69 → 293 s. For
   attended work where the owner is waiting, the effort dial is mostly a latency dial.

## Caveats that limit every row above

- **This is a general intelligence index, not a coding, review, or agentic benchmark.** It says
  nothing about tool use, repository navigation, long-horizon sessions, instruction adherence,
  honest uncertainty, or staying inside a bounded assignment — which is most of what our Cognitive
  Roles buy. A 4-point index gap is not evidence about review quality.
- **Price is API dollars; we pay subscription quota per provider.** Codex, claude, and copilot
  windows are separate and cannot be traded. The real constraint is quota balance across families:
  a model that is 25× cheaper in API dollars but on an exhausted window is unavailable, and a more
  expensive model on an idle window is free to us. Read the Price column as relative weight inside
  one provider, never as our bill.
- **Copilot was effectively unavailable.** Premium quota was 0% for most of the audit window and 10
  `ROUTING=BLOCKED` occurrences were recorded, so the third family in every independent list could
  not be selected. Checking now has an explicit single-family fallback for `high`; that is a quota
  fact, not a statement about Grok.
- **Family diversity is required for independent roles regardless of score.** `independent-judgment`,
  `challenge`, and `independent-review` must route outside the author's family. No leaderboard
  position can substitute a same-family reviewer for a cross-family one.
- **Effort labels are vendor-specific.** `medium` on Sonnet 5 and `medium` on Astra are not the same
  quantity of thinking; cross-family effort comparisons at fixed effort names are meaningless.
- **Latency figures are single API responses.** An agentic child spends most of its wall clock in
  tool loops; output speed (t/s) predicts our elapsed time better than the latency column, which is
  why Luna's 138 t/s and Gemini 3.8 Flash's 329 t/s matter more here than they look.
- **The audit measured orchestration, not answer quality.** No model ranking can be derived from it.

## Hypotheses to test (not a binding table)

- **H1 — investigation:** Luna high matches Sonnet 5 medium on bounded repository investigation at
  ~1/25 of the price proxy and frees claude quota. Biggest lever: 589 runs.
- **H2 — investigation truncation:** result truncation is driven by brief and budget, not model, and
  tracks equally across H1's two arms.
- **H3 — mechanics:** Terra low or Luna low matches Haiku 4.5 low on mechanical work and moves the
  role off claude quota; Haiku's 200k context is the real constraint, not its index.
- **H4 — review/synthesis:** Fable 5.1 medium matches Opus 5 high for `independent-review` and
  `synthesis` of OpenAI-authored work at lower price proxy and half the latency.
- **H5 — challenge effort:** Fable 5.1 medium finds the same material corrections as Fable 5.1 high.
- **H6 — design/escalation:** Astra high or medium beats Sol xhigh/max for `design` on non-independent
  work, at lower latency — testable only where independence is not required.
- **H7 — profile sentences:** the profile instruction sentence, not the model, explains part of the
  observed behavior (scouts writing files despite "Do not mutate files" in 107 audit children; 8
  sessions with conflicting commit authority). Model comparisons must hold the profile fixed.

Evaluation mechanics, units of comparison, sample sizes, and who decides:
[`docs/plans/model-role-evaluation.md`](../../plans/model-role-evaluation.md).
