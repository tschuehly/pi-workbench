# Pi Workbench documentation

This directory separates authoritative product meaning from implementation plans, integration design, and research evidence.

## Authority order

1. [`foundation/vocabulary.md`](foundation/vocabulary.md) defines canonical domain language.
2. [`foundation/system-overview.md`](foundation/system-overview.md) defines the system shape and routes to detailed authority; [`foundation/operating-levels.md`](foundation/operating-levels.md) defines the conceptual attention and authority postures.
3. [`foundation/principles.md`](foundation/principles.md) governs system-wide design choices, while [`foundation/requirements.md`](foundation/requirements.md) preserves product outcomes and validation.
4. [`contracts/`](contracts/) owns the stable behavioral contracts at each module seam.
5. [`foundation/decisions.md`](foundation/decisions.md) records settled decisions, open questions, and evidence links.
6. [`plans/`](plans/) sequences approved future implementation without redefining contracts.
7. [`integrations/`](integrations/) applies the contracts to external products such as PI WEB.
8. [`research/`](research/) preserves source evidence, reports, and generated indexes; it is not authoritative behavior.

When documents disagree, follow the highest applicable authority and repair the lower document.

## Contracts

- [`contracts/controller.md`](contracts/controller.md) — controller lifecycle, durable state, workspaces, and artifacts.
- [`contracts/workstreams.md`](contracts/workstreams.md) — cross-session attention, sparse ledgers, attended checkpoints, and closure.
- [`contracts/execution.md`](contracts/execution.md) — Pi actors, Dispatches, Episodes, routing, and execution semantics.
- [`contracts/workflow.md`](contracts/workflow.md) — authority, quality, Working Mode, semantic work, and compounding.
- [`contracts/interfaces.md`](contracts/interfaces.md) — Human Attention, supervision, PI WEB interaction, and adapters.
- [`contracts/graphical-attention.md`](contracts/graphical-attention.md) — action-first PI WEB interaction contract.
- [`contracts/harness.md`](contracts/harness.md) — harness distribution, skills, and repository adaptation.

## Plans and integrations

- [`plans/level-1.md`](plans/level-1.md) — approved Level 1 human–Pi pair-programming implementation plan.
- [`plans/level-1-subagents.md`](plans/level-1-subagents.md) — approved attended child Pi execution plan.
- [`plans/level-1-durable-workers.md`](plans/level-1-durable-workers.md) — implemented durable attended worker identity and resumable bounded dispatch beside ephemeral subagents.
- [`plans/subagent-worker-iterative-improvement.md`](plans/subagent-worker-iterative-improvement.md) — attended-use loop for evaluating and improving Subagent and Worker behavior through the user-invoked [`compound`](../skills/compound/SKILL.md) skill.
- [`plans/pi-web-subagent-conversation-cards.md`](plans/pi-web-subagent-conversation-cards.md) — owner-approved conversation-native child-execution presentation for the isolated unified-shell candidate.
- [`plans/subagent-details-envelope-experiment.md`](plans/subagent-details-envelope-experiment.md) — approved producer-side experiment for bounded, versioned child-execution presentation details.
- [`plans/workstream-continuation-extension.md`](plans/workstream-continuation-extension.md) — shared attended-session coordination and checkpoint continuation through PI WEB and a Pi terminal extension.
- [`plans/workstream-continuation-runtime-probes.md`](plans/workstream-continuation-runtime-probes.md) — approved host-neutral probes for continuation identity, persistence, cancellation, location, and contention assumptions.
- [`plans/workstream-store-lock-recovery-experiment.md`](plans/workstream-store-lock-recovery-experiment.md) — approved local file-lock ownership and dead-owner recovery experiment.
- [`plans/pi-web-workbench-ui.md`](plans/pi-web-workbench-ui.md) — implemented desktop-first sequence for the selected Workbench hierarchy and concise current exchange.
- [`plans/pi-web-unified-shell-prototype-fidelity.md`](plans/pi-web-unified-shell-prototype-fidelity.md) — owner-approved isolated candidate sequence for realizing the canonical prototype as one coherent PI WEB shell; release still requires Acceptance.
- [`plans/pi-web-controlled-session-fixture-experiment.md`](plans/pi-web-controlled-session-fixture-experiment.md) — approved and implemented Phase 1 experiment for the governing shell plan's isolated no-model acceptance harness.
- [`plans/pi-web-unified-ui-production.md`](plans/pi-web-unified-ui-production.md) — superseded UI-only baseline plan and incomplete release evidence.
- [`plans/pi-web-message-tree.md`](plans/pi-web-message-tree.md) — implementation sequence for compact session-history navigation, continue-from-entry, and correlated Workstream forks.
- [`integrations/pi-web/evaluation.md`](integrations/pi-web/evaluation.md) and [`shell-strategy.md`](integrations/pi-web/shell-strategy.md) — PI WEB evidence and shell boundary.
- [`integrations/pi-web/customization-plan.md`](integrations/pi-web/customization-plan.md) and [`principles.md`](integrations/pi-web/principles.md) — upstream delivery sequence and integration-specific development principles.

## Research

- [`research/sources/`](research/sources/) — curated evidence and source analyses, including the [subagent implementation comparison](research/sources/subagent-implementations.md) and [monitoring and communication evidence](research/sources/subagent-worker-monitoring-and-communication.md).
- [`research/reports/`](research/reports/) — derived design reports. The [AFK compaction repair and production attempt 03 report](research/reports/afk-compaction-race-and-production-attempt-03-2026-08-08.md) is the current authority for the repaired AFK checkpoint lifecycle, its post-fix matrix, and the terminal production attempt; the earlier [AFK autopilot production failure report](research/reports/afk-autopilot-production-failure-2026-08-08.md) preserves the originating failure evidence. The [multidimensional Working Mode proposal](research/reports/multidimensional-working-mode-proposal.md) is explicitly challenge-pending and non-authoritative; the [audited TUI-first Entry Preset implementation grill](research/reports/working-mode-tui-implementation-grill-2026-08-11.md) preserves its implementation decision tree and pending owner verdicts without authorizing implementation. The [unified Chats and Workstreams artifact](research/reports/pi-web-unified-chat-workstream-prototype.html) is the canonical working interaction prototype; the earlier [Workbench UX report](research/reports/pi-web-workbench-ux-prototype.md), [structural artifact](research/reports/pi-web-workbench-ux-prototype.html), and [current-exchange artifact](research/reports/pi-web-current-exchange-prototype.html) remain supporting references.
- [`research/generated/`](research/generated/) — reproducible generated indexes; do not treat them as standing context.

Operational documentation remains beside the module it describes under `packages/`, `apps/`, `skills/`, or `scripts/`.
