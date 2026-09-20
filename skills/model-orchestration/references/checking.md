# Independent checking

The target checking contract is `Cognitive Role + Checking + consequence → required bindings`.
The resolver accepts one Cognitive Role, author identity, and reviewer-family exclusions per
invocation. The lead assembles the panel; the resolver does not enforce the selected Checking value. See
[Working Mode](../../../docs/foundation/working-mode.md).

## Size independent checking by consequence

A Cognitive Role says what one assignment does. Consequence says how many independent assignments
are required by the owner-selected Checking value, repository policy, or material risk. Judge
consequence by the impact of a wrong conclusion, not by implementation difficulty.

| Consequence | Minimum independent checking |
|---|---|
| `low` | The selected Checking floor only; at `adversarial`, one cross-family `challenge` |
| `medium` | One `independent-judgment` or `challenge` |
| `high` | Two parallel `challenge` assignments from distinct non-author model families |
| `critical` | The `high` panel, then one `independent-review` at the evidence-bearing boundary and a separate `synthesis` |

Give parallel challengers the same distilled claim, constraints, and Primary Evidence, but distinct challenge lenses. Keep their answers hidden from one another and collect all terminal results before synthesis. Independence follows the underlying model family, not the gateway provider; two models routed through GitHub Copilot are independent only when their underlying families differ from the author and from each other.

The owner-selected Checking value is a floor: consequence may add checking but never remove required
tests or adversarial review. Resolve the panel before launching: retain the same author identity and exclude each already-selected
`modelBinding.independence.selectedFamily` from subsequent resolutions with repeatable
`--exclude-family` flags (Subagent `excludeFamilies`). Required fan-out does not degrade silently when
quota or a binding is unavailable; reduce scope, defer, or return `ROUTING=BLOCKED` with the missing
family. Repeated selections of the same family do not satisfy a distinct-family panel.

Resolve each role through [Binding](binding.md), including its explicit run-scoped routing-overlay
exception to default cross-family independence. Report the independence actually provided.

**Complete when:** the checking plan names its consequence, required roles, and any unavailable required binding; a panel also names its distinct underlying families, challenge lenses, and synthesis point.
