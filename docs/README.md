# Pi Workbench documentation

This directory separates authoritative product meaning from implementation plans, integration design, and research evidence.

## Authority order

1. [`foundation/vocabulary.md`](foundation/vocabulary.md) defines canonical domain language.
2. [`foundation/system-overview.md`](foundation/system-overview.md) defines the system shape and routes to detailed authority; [`foundation/working-mode.md`](foundation/working-mode.md) defines Alignment and Checking.
3. [`foundation/principles.md`](foundation/principles.md) governs system-wide design choices, while [`foundation/requirements.md`](foundation/requirements.md) preserves product outcomes and validation.
4. [`contracts/`](contracts/) owns the stable behavioral contracts at each module seam.
5. [`foundation/decisions.md`](foundation/decisions.md) records settled current and intended behavior with explicit implementation status, plus open questions and evidence links. Decisions describing the unbuilt controller and managed Run live in [`research/level-4-concepts.md`](research/level-4-concepts.md) and are not authoritative.
6. [`plans/`](plans/) sequences approved future implementation without redefining contracts.
7. [`integrations/`](integrations/) applies the contracts to external products such as PI WEB.
8. [`research/`](research/) preserves source evidence, reports, and generated indexes; it is not authoritative behavior.

When documents disagree, follow the highest applicable authority and repair the lower document.

## Contracts

- [`contracts/controller.md`](contracts/controller.md) — controller lifecycle, durable state, workspaces, and artifacts.
- [`contracts/workstreams.md`](contracts/workstreams.md) — cross-session attention, sparse ledgers, attended checkpoints, and closure.
- [`contracts/execution.md`](contracts/execution.md) — Pi actors, Dispatches, Episodes, routing, and execution semantics.
- [`contracts/workflow.md`](contracts/workflow.md) — managed workflow authority, quality, semantic work, and compounding.
- [`contracts/interfaces.md`](contracts/interfaces.md) — Human Attention, supervision, graphical client behavior, and adapters.
- [`contracts/graphical-attention.md`](contracts/graphical-attention.md) — action-first Workbench client interaction contract.
- [`contracts/harness.md`](contracts/harness.md) — harness distribution, skills, and repository adaptation.

## Plans and integrations

- [`contracts/workstreams.md`](contracts/workstreams.md) and [`contracts/execution.md`](contracts/execution.md) — current attended workflow behavior; the former Level 1 implementation plan is archived.
- [`plans/working-mode.md`](plans/working-mode.md) — prompt-guided Working Mode trial and evidence required before any selector, persistence, or gate.
- [`plans/level-1-subagents.md`](plans/level-1-subagents.md) — implemented attended child Pi execution plan.
- [`plans/level-1-durable-workers.md`](plans/level-1-durable-workers.md) — implemented durable attended worker identity and resumable bounded dispatch beside ephemeral subagents.
- [`plans/subagent-worker-iterative-improvement.md`](plans/subagent-worker-iterative-improvement.md) — attended-use loop for evaluating and improving Subagent and Worker behavior through the user-invoked [`compound`](../skills/compound/SKILL.md) skill.
- [`plans/workbench-ui.md`](plans/workbench-ui.md) — current iterative graphical-client plan, beginning with one Chat per macOS window.
- [`plans/workstream-store-lock-recovery-experiment.md`](plans/workstream-store-lock-recovery-experiment.md) — approved Store lock recovery experiment, still required by the durable-worker lock rationale.
- [`integrations/pi-web/reuse-boundary.md`](integrations/pi-web/reuse-boundary.md) — current boundary between the Workbench client and reused PI WEB runtime/modules.
- [`archive/pi-web-ui/`](archive/pi-web-ui/) — superseded shell, plugin, unified-navigation, prototype-fidelity, history, and child-card plans with their disposition.

## Research

- [`research/sources/`](research/sources/) — curated evidence and source analyses, including the [subagent implementation comparison](research/sources/subagent-implementations.md) and [monitoring and communication evidence](research/sources/subagent-worker-monitoring-and-communication.md).
- [`research/reports/`](research/reports/) — derived design reports. The [AFK compaction repair and production attempt 03 report](research/reports/afk-compaction-race-and-production-attempt-03-2026-08-08.md) is the current authority for the repaired AFK checkpoint lifecycle, its post-fix matrix, and the terminal production attempt; the earlier [AFK autopilot production failure report](research/reports/afk-autopilot-production-failure-2026-08-08.md) preserves the originating failure evidence. The [deterministic Goal supervision proposal](research/reports/deterministic-goal-supervision-2026-08-14.md) records the PhotoQuest benchmark lesson and maps any future managed supervision to the existing Watcher and Run Controller boundaries rather than a second model controller. The [multidimensional Working Mode proposal](research/reports/multidimensional-working-mode-proposal.md) and the [TUI-first Entry Preset implementation grill](research/reports/working-mode-tui-implementation-grill-2026-08-11.md) were **withdrawn on 2026-08-26** and remain research into how the design became overbuilt. Decision 69 and [`foundation/working-mode.md`](foundation/working-mode.md) are the authoritative replacement; the [agent-usage session audit](research/reports/agent-usage-session-audit-2026-08-27.md) supplies the observed failure behind the Alignment axis. [`research/level-4-concepts.md`](research/level-4-concepts.md) collects decisions that describe unbuilt managed behavior. The [UI reset report](research/reports/workbench-ui-reset-2026-08-28.md) records the owner-observed failure and retained lessons. Earlier PI WEB and Workbench prototypes remain historical interaction evidence; none is a current fidelity target.
- [`research/generated/`](research/generated/) — reproducible generated indexes; do not treat them as standing context.

Operational documentation remains beside the module it describes under `packages/`, `apps/`, `skills/`, or `scripts/`.
