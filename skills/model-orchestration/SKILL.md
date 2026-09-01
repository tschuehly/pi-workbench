---
name: model-orchestration
description: Route Pi Cognitive Roles to quota-eligible model and Model Effort bindings. Use when selecting a lead model, preparing a Workbench Dispatch, requiring independent cross-family judgment, sizing an adversarial checking panel, or checking capacity before substantial fan-out or scarce specialist work.
---

# Model orchestration

Propose one Pi binding per Cognitive Role. The Run Controller remains authoritative for Dispatch validation and launch.

The target checking contract is `Cognitive Role + Checking + consequence → required bindings`.
The current resolver accepts one Cognitive Role and optional author provider per invocation; it does
not enforce the selected Checking value or assemble a panel. See [Working
Mode](../../docs/foundation/working-mode.md).

Set `SKILL_DIR` to this skill's directory before using its bundled tools.

## 1. Classify each bounded assignment

Assign exactly one role:

| Cognitive Role | Use for |
|---|---|
| `implementation` | Routine implementation, tests, and fixes |
| `problem-solving` | Difficult implementation or bounded technical analysis |
| `design` | Novel decomposition or consequential design |
| `escalation` | Important work unresolved by the ordinary ladder |
| `investigation` | Broad repository reads and mechanical evidence collection |
| `independent-judgment` | One compact independent judgment |
| `challenge` | Challenge a distilled judgment from another model family |
| `synthesis` | Build a faithful system model from gathered evidence |
| `independent-review` | Fresh review of a bounded, high-risk diff from another model family |
| `mechanics` | Cheap mechanical work that saves meaningful lead context |
| `coordination` | Own one scope in a long run: decompose it, dispatch leaf Subagents, reconcile their evidence, decide next or stop. The role for a `coordinator` Worker dispatch |

In an orchestrated run the lead dispatches `coordination` Workers, one per non-overlapping scope, and keeps only intent, decisions, and compact child evidence in its own context; each coordinator runs the same loop one level down with fresh leaves. Judgment about the run itself (drift, stalled scopes, whether to stop) is `independent-judgment`, not a coordinator's self-report.

Include bounded scope, task risk, required Independence, and the author provider when Independence matters. `independent-judgment`, `challenge`, and `independent-review` require cross-family routing; their model binding is selected dynamically from the author provider rather than fixed to one family. When the author's completion receipt names an exact model, pass it as `independentOfModel`; default routing safely uses its provider.

### Run-scoped routing overlay

Set `PI_WORKBENCH_ROUTING_OVERLAY` to an absolute JSON path to narrow a whole run to one declared allowlist; see [`references/anthropic-opus-sonnet-overlay.json`](references/anthropic-opus-sonnet-overlay.json). It is the sole activation variable and fails closed: an unmapped role, a model outside the allowlist, or missing, unreadable, invalid, or unpropagated bytes blocks instead of falling back to default routing. Each binding receipt carries the overlay path and content hash, and the execution adapter re-verifies that hash before launch.

While an overlay is active, independence is distinct-model rather than cross-family: `--independent-of-model '<provider>/<model>'` (the Subagent tool's `independentOfModel`) is required, and the overlay selects a different model. The same parameter is safe without an overlay, where routing uses its provider for cross-family independence. Never label same-model review independent.

**Complete when:** every proposed Dispatch has exactly one Cognitive Role and a non-overlapping bounded responsibility.

## 2. Size independent checking by consequence

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

**Complete when:** the checking plan names its consequence, required roles, and any unavailable required binding; a panel also names its distinct underlying families, challenge lenses, and synthesis point.

## 3. Resolve against the live Pi runtime

Run:

```bash
node "$SKILL_DIR/scripts/resolve-runtime-binding.mjs" <cognitive-role> [--independent-of <author-provider> | --independent-of-model <provider/model>]
```

The resolver checks the vendored policy, the current Pi model catalog, and a machine-local `quota-axi --json` snapshot cached for ten minutes. Catalog and quota subprocesses each have a 15-second deadline so routing cannot silently stall a child launch. Concurrent and repeated resolutions share that snapshot, including telemetry failures; the first resolution after the cache expires refreshes it. Fresh quota telemetry with an exhausted relevant window blocks routing. Stale, unavailable, or unreadable quota telemetry produces a `degraded-quota-telemetry` admission instead: the child launch proceeds and Pi's runtime binding verification remains authoritative. An unknown role or absent model still fails closed. Routing never silently substitutes the requested role. Independent roles fail closed without a recognized author provider or a configured binding from another family.

Resolve before a major fan-out, scarce Claude call, escalation, or later major phase; resolutions inside the ten-minute window reuse the cached quota snapshot. Identify windows by `windowSeconds` and `resetsAt`; labels are secondary. A model-scoped window applies only to that model. Compare percentages only within one provider.

**Complete when:** every role has one resolver-produced `provider`, `model`, `effort`, quota admission, and quota snapshot, or the unavailable role is explicit. Disclose degraded telemetry; do not describe it as fresh quota evidence.

## 4. Submit the proposed binding

Place the complete `modelBinding` in the Work Packet without changing it. The controller resolves the named Execution Profile, checks authority, permissions, workspace, skills, budget, and expected Episode schema, then accepts or rejects the Dispatch. A child Pi process never inherits its caller's skills, permissions, evidence, or authority implicitly.

For an interactive Pi lead outside a managed Run, the harness launcher provides the same routing gate:

```bash
./scripts/pi-role <cognitive-role> [-- <pi arguments>]
```

That launcher selects only the current Pi session. It does not claim controller mediation or durable Run state.

**Complete when:** the controller receipt records the accepted binding, or the result is `ROUTING=BLOCKED` with the condition required to continue. If an independent child fails to launch or complete, disclose that failure rather than presenting the lead's own work as independent review.

Read [routing rationale](references/routing-rationale.md) only when evaluating the current policy. Read [port provenance](references/provenance.md) when auditing what graduated from Claudex.
