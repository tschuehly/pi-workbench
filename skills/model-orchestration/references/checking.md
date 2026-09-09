# Independent checking

The target checking contract is `Cognitive Role + Checking + consequence → required bindings`.
The current resolver accepts one Cognitive Role, optional Worker model override, and optional author
provider per invocation; it does not enforce the selected Checking value or assemble a panel. See
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
tests or adversarial review. Required fan-out does not degrade silently when quota or a binding is
unavailable; reduce scope, defer, or return `ROUTING=BLOCKED` with the missing family. The current
resolver selects one binding per invocation and has no explicit judge-family input, so a required
multi-family panel remains unavailable until policy, resolver, launcher, and tests support it;
repeated identical resolutions do not satisfy the panel.

Resolve each role through [Binding](binding.md), including its explicit run-scoped routing-overlay
exception to default cross-family independence. Report the independence actually provided.

**Complete when:** the checking plan names its consequence, required roles, and any unavailable required binding; a panel also names its distinct underlying families, challenge lenses, and synthesis point.
