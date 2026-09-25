# Independent checking

Consequence is the impact of a wrong conclusion, not the difficulty of the work. It sets how many
`review` children a conclusion needs. The owner's Checking value is a floor: consequence may add
reviewers, never remove required tests or review.

| Consequence | Required review |
| --- | --- |
| `low` | The Checking floor only; at `Challenge`, one `review` |
| `medium` | One `review` |
| `high` | Two parallel `review` children from distinct non-author families |
| `critical` | The `high` panel, then one `review` of the evidence-bearing diff; combine the results yourself |

For a panel, give every reviewer the same distilled claim, constraints, and Primary Evidence with a
distinct lens, keep their answers hidden from each other, and pass each already-selected family as
`excludeFamilies` to the next launch. Independence follows the underlying model family, not the
gateway provider.

With Anthropic and OpenAI, only one non-author family exists. The policy's third family (Grok
through GitHub Copilot) supplies the second `high` reviewer when Copilot quota is available.
Otherwise run the `high` panel as one reviewer and record "single-family: Copilot quota
unavailable" in the checking plan and the final report. `critical` never accepts that reduction.
A second reviewer from the author's or an already-selected family never counts.

**Complete when:** the checking plan names its consequence, each reviewer's family and lens, and
any reviewer that could not be launched.
