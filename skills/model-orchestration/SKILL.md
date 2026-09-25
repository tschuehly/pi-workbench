---
name: model-orchestration
description: Route delegated Pi work to models by latitude. Use when a routing receipt surprises or blocks, when a problem is hard enough for a frontier panel, when sizing independent review, or when launching a lead with pi-role.
---

# Model orchestration

**Latitude** is how much a child must decide for itself: how unclear the problem is and how little
the brief specifies. Latitude picks the Cognitive Role, the role picks a model tier, and
[`references/routing-policy.json`](references/routing-policy.json) names the models. The resolver's
`--help` (`scripts/resolve-runtime-binding.mjs --help`) lists the current roles, tiers, flags, and
fallback rules.

| Role | Latitude | Tier |
| --- | --- | --- |
| `routine` | Narrow: detailed brief, accepted plan, mechanical edits, evidence collection | light |
| `implementation` | Normal: clear goal, ordinary brief | standard |
| `frontier` | Wide: unclear or novel problem, symptom-only bug, thin brief | strong |
| `coordination` | A Worker that owns one scope and dispatches leaves | standard |
| `review` | Independent judgment, challenge, or diff review; the lens goes in the brief | standard, other family |

A sharper brief or an accepted plan narrows latitude and moves the same work to a lighter tier.

## 1. Launch and read the receipt

Choose the role by latitude and launch. The launch result names the model, effort, and any
fallback. A fallback stays in the tier: the other family's model of the same strength runs, and the
receipt says why. When both tier models are unavailable, routing blocks; report the block and wait
rather than choosing a weaker role.

**Complete when:** the launched model belongs to the tier you intended, or the block is reported.

## 2. Frontier panel for the hardest problems

The reserve model, Fable, runs only when named. Use it as the second member of a **frontier
panel** when a problem is both wide-latitude and consequential, or when a single frontier child
already failed: launch two `frontier` children with the same frozen brief, one on the default
strong model and one with `modelOverride: anthropic/claude-fable-5-1`, and combine their answers
yourself after both finish. Keep each child's answer hidden from the other.

**Complete when:** both answers are collected and the combined conclusion names where they agreed
and where they differed.

## 3. Review

`review` routes to the other model family at the author's tier or above, at `xhigh`, and never below
that floor. Pass the author as `independentOfModel` from its completion receipt. To review
frontier work, name the other family's strong model as `modelOverride`; the family check still
applies. Size how many reviewers a conclusion needs with [Checking](references/checking.md).

**Complete when:** every reviewer's receipt shows a family different from the author's, or the
missing independence is reported.

## Unmanaged lead and run-scoped overlays

`./scripts/pi-role <role> [-- <pi arguments>]` launches an interactive lead through the same
resolver. `PI_WORKBENCH_ROUTING_OVERLAY=<absolute path>` narrows a run to an allowlist such as
[`references/anthropic-opus-sonnet-overlay.json`](references/anthropic-opus-sonnet-overlay.json);
under it, review is distinct-model rather than cross-family and needs `independentOfModel`.
