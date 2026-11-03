# Independent checking

Consequence is the impact of a wrong conclusion, not the difficulty of the work. It sets how many
`review` children a conclusion needs. The owner's Checking value is a floor: consequence may add
reviewers, never remove required tests or review.

| Consequence | Required review |
| --- | --- |
| `low` | The Checking floor only; at `Challenge`, one `review` |
| `medium` | One `review` |
| `high` | Two parallel `review` children from distinct non-author families |
| `critical` | An OpenAI author and the author-swap panel below, then one `review` of the evidence-bearing diff; combine the results yourself |

For a panel, give every reviewer the same distilled claim, constraints, and Primary Evidence with a
distinct lens, keep their answers hidden from each other, and pass each already-selected family as
`excludeFamilies` to the next launch. Independence follows the underlying model family, not the
gateway provider.

With Anthropic and OpenAI, only one non-author family exists. Run a `high` panel as one reviewer
and record "single-family" in the checking plan and the final report; a second reviewer from the
author's or an already-selected family never counts as independent.

`critical` work uses an **author swap** instead: an OpenAI implementer (Astra or Sol) writes the
change, and a Claude lead delegates that authorship rather than writing it. The panel is Opus as a
`review` child plus the other OpenAI model (Sol, or Astra when Sol authored) as a `reviewer`
profile with `cognitiveRole: implementation` and `modelOverride`, since `review` refuses the
author's family. Each runs in a fresh context with a distinct lens; record the OpenAI reviewer as
same-family, distinct-model.

**Complete when:** the checking plan names its consequence, each reviewer's family and lens, and
any reviewer that could not be launched.
