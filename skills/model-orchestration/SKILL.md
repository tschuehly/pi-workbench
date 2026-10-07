---
name: model-orchestration
description: Route delegated Pi work to models by latitude. Use when a routing receipt surprises or blocks, when a problem is hard enough for a frontier panel, when sizing independent review, or when launching a lead with pi-role.
---

# Model orchestration

A launch names a **profile**, what kind of work the child does (scout, planner, reviewer,
implementer), and a **Cognitive Role**, how much it must decide. The role picks the model tier;
[`references/routing-policy.json`](references/routing-policy.json) names the models, and the
resolver's `--help` (`scripts/resolve-runtime-binding.mjs --help`) lists tiers, flags, and fallback.

Test your own brief to choose the role:

| If you can write | Role | Tier | Example |
| --- | --- | --- | --- |
| A list of what to check or change | `routine` | light | Collect what named guides and tools say about a topic |
| The finish line, but not the approach | `implementation` | standard | Weigh sources and recommend one option; build a specified change |
| Neither: only a symptom or an open question | `frontier` | strong | "Reports keep opening with meta-commentary; find out why and fix it" |

A brief that is a checklist plus a final judgment is two assignments: a `routine` child collects,
then you decide or launch an `implementation` child. A topic that feels important does not widen
the brief; a sharper brief or an accepted plan moves the same work to a lighter tier.
`coordination` is a Worker that owns one scope; `review` is covered in step 3.

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

`light-review` is the same family check on the light tier at `high`. Use it only for PR text,
documentation, comment replies, and classifying findings; every code diff, including a one-line
fix, gets `review`.

**Complete when:** every reviewer's receipt shows a family different from the author's, or the
missing independence is reported.

## Unmanaged lead and run-scoped overlays

`./scripts/pi-role <role> [-- <pi arguments>]` launches an interactive lead through the same
resolver. `PI_WORKBENCH_ROUTING_OVERLAY=<absolute path>` narrows a run to an allowlist such as
[`references/anthropic-opus-sonnet-overlay.json`](references/anthropic-opus-sonnet-overlay.json);
under it, review is distinct-model rather than cross-family and needs `independentOfModel`.
