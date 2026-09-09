---
name: model-orchestration
description: Route Pi Cognitive Roles to quota-eligible model and Model Effort bindings. Use when selecting a lead model, preparing a Workbench Dispatch, requiring independent cross-family judgment, sizing an adversarial checking panel, or checking capacity before substantial fan-out or scarce specialist work.
---

# Model orchestration

Use one router under every Alignment value. Load only the guidance needed for the assignment:

- **[Binding](references/binding.md):** for every delegated Subagent or Worker invocation, lead-model
  selection, or capacity check. Classify the role, resolve the live binding, and submit it unchanged.
- **[Checking](references/checking.md):** before resolving independent assignments when Checking is
  `adversarial`, owner direction or repository policy requires independent review, or the impact of
  a wrong conclusion warrants it; also load it when sizing a checking plan. Consequence may add
  evidence requirements, never remove the selected floor.
- **[Routing rationale](references/routing-rationale.md):** only when evaluating the routing policy.
- **[Port provenance](references/provenance.md):** only when auditing what graduated from Claudex.

Checking starts unset; that does not waive owner direction, repository policy, or material risk.
Discovery is task-triggered, not a requirement to delegate or review every task. These references
change guidance, not model routing code, tool access, or execution authority. Managed Dispatch
validation and launch remain a future controller boundary, not an attended-session guarantee.

**Complete when:** the assignment has its required evidence plan and resolver-produced bindings,
or any unavailable requirement is reported explicitly.
