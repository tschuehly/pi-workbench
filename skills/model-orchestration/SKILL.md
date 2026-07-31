---
name: model-orchestration
description: Route Pi Cognitive Roles to quota-eligible model and Model Effort bindings. Use when selecting a lead model, preparing a Workbench Dispatch, requiring independent cross-family judgment, or checking capacity before substantial fan-out or scarce specialist work.
---

# Model orchestration

Propose one Pi binding per Cognitive Role. The Run Controller remains authoritative for Dispatch validation and launch.

For unmanaged Levels, the target contract is `Cognitive Role + Entry Preset → Execution Profile → model binding`. The current resolver still accepts only Cognitive Role and therefore represents the pre-Level default policy. Do not claim that Level-specific model or Model Effort selection is active until the resolver, launcher, policy, and tests accept an Entry Preset explicitly.

Set `SKILL_DIR` to this skill's directory before using its bundled tools.

## 1. Classify each bounded assignment

Assign exactly one role:

| Cognitive Role | Use for |
|---|---|
| `routine-execution` | Routine implementation, tests, and fixes |
| `hard-execution` | Difficult implementation or bounded technical review |
| `consequential-deliberation` | Novel decomposition or consequential design |
| `exceptional-escalation` | Important work unresolved by the ordinary ladder |
| `wide-evidence-gathering` | Broad repository reads and mechanical evidence collection |
| `bounded-advice` | One compact independent judgment |
| `gpt-adversary` | Challenge a distilled GPT-authored judgment |
| `system-comprehension` | Build a faithful system model from gathered evidence |
| `gpt-diff-review` | Fresh review of a bounded, high-risk GPT-written diff |
| `background-mechanics` | Cheap mechanical work that saves meaningful lead context |

Include bounded scope, task risk, required Independence, and the author family when review independence matters.

**Complete when:** every proposed Dispatch has one distinct Cognitive Role.

## 2. Resolve against the live Pi runtime

Run:

```bash
node "$SKILL_DIR/scripts/resolve-runtime-binding.mjs" <cognitive-role>
```

The resolver checks the vendored policy, the current Pi model catalog, and a fresh `quota-axi --json` snapshot. It fails closed when the role is unknown, the model is absent, quota is stale or unreadable, or a relevant window is exhausted. Quota gates eligibility; it never weakens or silently substitutes the requested role.

Refresh before a major fan-out, scarce Claude call, exceptional escalation, or later major phase. Identify windows by `windowSeconds` and `resetsAt`; labels are secondary. A model-scoped window applies only to that model. Compare percentages only within one provider.

**Complete when:** every role has one resolver-produced `provider`, `model`, `effort`, and fresh quota snapshot, or the unavailable role is explicit.

## 3. Submit the proposed binding

Place the complete `modelBinding` in the Work Packet without changing it. The controller resolves the named Execution Profile, checks authority, permissions, workspace, skills, budget, and expected Episode schema, then accepts or rejects the Dispatch. A child Pi process never inherits its caller's skills, permissions, evidence, or authority implicitly.

For an interactive Pi lead outside a managed Run, the harness launcher provides the same routing gate:

```bash
./scripts/pi-role <cognitive-role> [-- <pi arguments>]
```

That launcher selects only the current Pi session. It does not claim controller mediation or durable Run state.

**Complete when:** the controller receipt records the accepted binding, or the result is `ROUTING=BLOCKED` with the condition required to continue.

Read [routing rationale](references/routing-rationale.md) only when evaluating the current policy. Read [port provenance](references/provenance.md) when auditing what graduated from Claudex.
