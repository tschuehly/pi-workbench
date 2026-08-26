---
name: model-orchestration
description: Route Pi Cognitive Roles to quota-eligible model and Model Effort bindings. Use when selecting a lead model, preparing a Workbench Dispatch, requiring independent cross-family judgment, or checking capacity before substantial fan-out or scarce specialist work.
---

# Model orchestration

Propose one Pi binding per Cognitive Role. The Run Controller remains authoritative for Dispatch validation and launch.

The target contract is `Cognitive Role + Operating Level → model binding`. The current resolver accepts only Cognitive Role, so it is the Level 1 default policy. Do not claim that Level-specific model or Model Effort selection is active until the resolver, launcher, policy, and tests accept an Operating Level explicitly. See [operating levels](../../docs/foundation/operating-levels.md).

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

Include bounded scope, task risk, required Independence, and the author provider when Independence matters. `independent-judgment`, `challenge`, and `independent-review` require cross-family routing; their model binding is selected dynamically from the author provider rather than fixed to one family.

**Complete when:** every proposed Dispatch has one distinct Cognitive Role.

## 2. Resolve against the live Pi runtime

Run:

```bash
node "$SKILL_DIR/scripts/resolve-runtime-binding.mjs" <cognitive-role> [--independent-of <author-provider>]
```

The resolver checks the vendored policy, the current Pi model catalog, and a machine-local `quota-axi --json` snapshot cached for ten minutes. Catalog and quota subprocesses each have a 15-second deadline so routing cannot silently stall a child launch. Concurrent and repeated resolutions share that snapshot, including telemetry failures; the first resolution after the cache expires refreshes it. Fresh quota telemetry with an exhausted relevant window blocks routing. Stale, unavailable, or unreadable quota telemetry produces a `degraded-quota-telemetry` admission instead: the child launch proceeds and Pi's runtime binding verification remains authoritative. An unknown role or absent model still fails closed. Routing never silently substitutes the requested role. Independent roles fail closed without a recognized author provider or a configured binding from another family.

Resolve before a major fan-out, scarce Claude call, escalation, or later major phase; resolutions inside the ten-minute window reuse the cached quota snapshot. Identify windows by `windowSeconds` and `resetsAt`; labels are secondary. A model-scoped window applies only to that model. Compare percentages only within one provider.

**Complete when:** every role has one resolver-produced `provider`, `model`, `effort`, quota admission, and quota snapshot, or the unavailable role is explicit. Disclose degraded telemetry; do not describe it as fresh quota evidence.

## 3. Submit the proposed binding

Place the complete `modelBinding` in the Work Packet without changing it. The controller resolves the named Execution Profile, checks authority, permissions, workspace, skills, budget, and expected Episode schema, then accepts or rejects the Dispatch. A child Pi process never inherits its caller's skills, permissions, evidence, or authority implicitly.

For an interactive Pi lead outside a managed Run, the harness launcher provides the same routing gate:

```bash
./scripts/pi-role <cognitive-role> [-- <pi arguments>]
```

That launcher selects only the current Pi session. It does not claim controller mediation or durable Run state.

**Complete when:** the controller receipt records the accepted binding, or the result is `ROUTING=BLOCKED` with the condition required to continue. If an independent child fails to launch or complete, disclose that failure rather than presenting the lead's own work as independent review.

Read [routing rationale](references/routing-rationale.md) only when evaluating the current policy. Read [port provenance](references/provenance.md) when auditing what graduated from Claudex.
