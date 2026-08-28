# Pi Workbench documentation

Use this page to find the right source. Product meaning, contracts, plans, and evidence have
different authority; do not treat a completed experiment or old plan as current scope.

## Where to start

| Question | Read |
| --- | --- |
| What does a term mean? | [`foundation/vocabulary.md`](foundation/vocabulary.md) |
| How does the system fit together? | [`foundation/system-overview.md`](foundation/system-overview.md) |
| What behavior is required? | [`foundation/requirements.md`](foundation/requirements.md) and [`contracts/`](contracts/) |
| Why was a choice made, and is it implemented? | [`foundation/decisions.md`](foundation/decisions.md) |
| What should be built next? | [`plans/`](plans/) |
| What did research or an experiment show? | [`research/`](research/) |

When documents disagree, follow the highest applicable source below and repair the lower one.

## Authority order

1. [`foundation/vocabulary.md`](foundation/vocabulary.md) — canonical domain language.
2. [`foundation/system-overview.md`](foundation/system-overview.md) and
   [`foundation/working-mode.md`](foundation/working-mode.md) — system shape and Working Mode.
3. [`foundation/principles.md`](foundation/principles.md) and
   [`foundation/requirements.md`](foundation/requirements.md) — design rules, product outcomes, and
   validation.
4. [`contracts/`](contracts/) — stable behavior at module boundaries.
5. [`foundation/decisions.md`](foundation/decisions.md) — settled current or intended choices, with
   implementation status and provenance.
6. [`plans/`](plans/) — approved implementation sequence; plans do not redefine contracts.
7. [`integrations/`](integrations/) — application of contracts to products such as PI WEB.
8. [`research/`](research/) — source evidence and reports; never authoritative behavior.

Unbuilt managed-Run decisions live in [`research/level-4-concepts.md`](research/level-4-concepts.md),
not in the authoritative decision record.

## Contracts

- [`controller.md`](contracts/controller.md) — controller lifecycle, durable state, workspaces, and
  artifacts.
- [`workstreams.md`](contracts/workstreams.md) — cross-session attention, checkpoints, and closure.
- [`execution.md`](contracts/execution.md) — Pi actors, Dispatches, Episodes, routing, and execution.
- [`workflow.md`](contracts/workflow.md) — managed workflow authority, quality, and compounding.
- [`interfaces.md`](contracts/interfaces.md) — human attention, supervision, clients, and adapters.
- [`graphical-attention.md`](contracts/graphical-attention.md) — graphical interaction and acceptance.
- [`harness.md`](contracts/harness.md) — harness distribution, skills, and repository adaptation.

## Current work and implemented plans

- [`plans/workbench-ui.md`](plans/workbench-ui.md) — current graphical-client plan: fix text input,
  then add files beside Chat.
- [`integrations/pi-web/reuse-boundary.md`](integrations/pi-web/reuse-boundary.md) — what the new
  client reuses from PI WEB and what it replaces.
- [`contracts/workstreams.md`](contracts/workstreams.md) and
  [`contracts/execution.md`](contracts/execution.md) — current attended workflow.
- [`plans/working-mode.md`](plans/working-mode.md) — prompt-guided Working Mode trial and evidence required before any selector, persistence, or gate.
- [`plans/level-1-subagents.md`](plans/level-1-subagents.md) — implemented attended child execution.
- [`plans/level-1-durable-workers.md`](plans/level-1-durable-workers.md) — implemented durable Worker
  identity and resumable dispatch.
- [`plans/subagent-worker-iterative-improvement.md`](plans/subagent-worker-iterative-improvement.md) —
  attended evaluation through the [`compound`](../skills/compound/SKILL.md) skill.
- [`plans/workstream-store-lock-recovery-experiment.md`](plans/workstream-store-lock-recovery-experiment.md)
  — approved experiment required by the durable-Worker lock rationale.
- [`archive/pi-web-ui/`](archive/pi-web-ui/) — stopped PI WEB shell and unified-UI campaigns, with a
  disposition for each document.

## Research worth locating quickly

### Current evidence

- [UI reset report](research/reports/workbench-ui-reset-2026-08-28.md) — why the graphical direction
  changed and what remains reusable.
- [Agent-usage session audit](research/reports/agent-usage-session-audit-2026-08-27.md) — observed
  failure behind the Alignment axis.
- [Subagent implementation comparison](research/sources/subagent-implementations.md) and
  [monitoring and communication evidence](research/sources/subagent-worker-monitoring-and-communication.md).

### AFK and supervision evidence

- [AFK compaction repair and production attempt 03](research/reports/afk-compaction-race-and-production-attempt-03-2026-08-08.md)
  — current evidence for the repaired AFK checkpoint lifecycle and its post-fix matrix.
- [Earlier AFK production failure](research/reports/afk-autopilot-production-failure-2026-08-08.md)
  — originating failure evidence.
- [Deterministic Goal supervision proposal](research/reports/deterministic-goal-supervision-2026-08-14.md)
  — maps future supervision to existing Watcher and Run Controller boundaries.

### Withdrawn design work

The [multidimensional Working Mode proposal](research/reports/multidimensional-working-mode-proposal.md)
and [TUI-first Entry Preset grill](research/reports/working-mode-tui-implementation-grill-2026-08-11.md)
were withdrawn on 2026-08-26. They explain how the design became overbuilt; Decision 69 and
[`foundation/working-mode.md`](foundation/working-mode.md) replace them.

Earlier PI WEB and Workbench prototypes are historical interaction evidence, not fidelity targets.
Generated indexes under [`research/generated/`](research/generated/) are reproducible outputs, not
standing context.

Operational documentation stays beside the module it describes under `packages/`, `apps/`,
`skills/`, or `scripts/`.
