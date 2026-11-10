# Independent checking

Consequence is the impact of a wrong conclusion, not the difficulty of the work. It sets how many
`review` children a conclusion needs. The owner's Checking value is a floor: consequence may add
reviewers, never remove required tests or review.

| Consequence | Required review |
| --- | --- |
| `low` | The Checking floor only; at `Challenge`, the review pair below |
| `medium` | One `review` |
| `high` | Two parallel `review` children from distinct non-author families |
| `critical` | An OpenAI author and the author-swap panel below, then one `review` of the evidence-bearing diff; combine the results yourself |

For a panel, give every reviewer the same distilled claim, constraints, and Primary Evidence with a
distinct lens, keep their answers hidden from each other, and pass each already-selected family as
`excludeFamilies` to the next launch. Independence follows the underlying model family, not the
gateway provider.

Meta (Ember) is the third family. When it is unavailable, only one non-author family may remain:
run a `high` panel as one reviewer and record "single-family" in the checking plan and the final
report; a second reviewer from the author's or an already-selected family never counts as
independent.

`critical` work uses an **author swap** instead: an OpenAI implementer (Astra or Sol) writes the
change, and a Claude lead delegates that authorship rather than writing it. The panel is Opus as a
`review` child plus the other OpenAI model (Sol, or Astra when Sol authored) as a `reviewer`
profile with `cognitiveRole: implementation` and `modelOverride`, since `review` refuses the
author's family. Each runs in a fresh context with a distinct lens; record the OpenAI reviewer as
same-family, distinct-model.

## Challenge review pair

Every `Challenge` review is two parallel `review` children on the same brief, blind to each other,
both at `high` with the author as `independentOfModel`: Sol (`openai-codex/gpt-6.1-sol`) and
Ember (`meta/muse-ember-1.0`) as `modelOverride`. An OpenAI author gets Opus
(`anthropic/claude-opus-5-5`) instead of Sol; a Meta author gets Opus instead of Ember. The pair
also satisfies a `high` panel. Merge duplicate findings and note which reviewer found each.

A Meta author's pair is Sol and Opus: it has no Ember, so skip the quota read and the fallback
below. Otherwise the Muse quota floor is 35% left in either window. Read it from CodexBar before
launching Ember:

```sh
jq -er '[.entries[]? | select(.provider == "muse")][0] as $m
  | [$m.primary.usedPercent, $m.secondary.usedPercent]
  | if all(type == "number") then "fiveHourUsed=\(.[0]) weekUsed=\(.[1])" else "unknown" end' \
  "$HOME/Library/Group Containers/Y5PE65HELJ.com.steipete.codexbar/widget-snapshot.json" 2>/dev/null || echo unknown
```

Above 65% used in either window, or when Ember fails to launch or hits a rate limit, run the other
reviewer alone and state "single reviewer: Ember skipped (reason)" in the report.

It prints `unknown` when the snapshot is missing, empty or unreadable, has no Muse entry, or lacks a
window reading. Then launch Ember anyway, since a rate-limit failure still triggers the fallback,
and record "Muse quota unknown" in the report.

**Complete when:** the checking plan names its consequence, each reviewer's family and lens, and
any reviewer that could not be launched.
