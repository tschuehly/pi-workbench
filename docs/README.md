# Pi Workbench documentation

This directory separates authoritative product meaning from implementation plans, integration design, and research evidence.

## Authority order

1. [`foundation/vocabulary.md`](foundation/vocabulary.md) defines canonical domain language.
2. [`foundation/system-overview.md`](foundation/system-overview.md) defines the system shape and routes to detailed authority.
3. [`foundation/principles.md`](foundation/principles.md) governs system-wide design choices, while [`foundation/requirements.md`](foundation/requirements.md) preserves product outcomes and validation.
4. [`contracts/`](contracts/) owns the stable behavioral contracts at each module seam.
5. [`foundation/decisions.md`](foundation/decisions.md) records settled decisions, open questions, and evidence links.
6. [`plans/`](plans/) sequences approved future implementation without redefining contracts.
7. [`integrations/`](integrations/) applies the contracts to external products such as PI WEB.
8. [`research/`](research/) preserves source evidence, reports, and generated indexes; it is not authoritative behavior.

When documents disagree, follow the highest applicable authority and repair the lower document.

## Contracts

- [`contracts/controller.md`](contracts/controller.md) — controller lifecycle, durable state, workspaces, and artifacts.
- [`contracts/workstreams.md`](contracts/workstreams.md) — cross-session attention, sparse ledgers, checkpoints, and FirstMate.
- [`contracts/execution.md`](contracts/execution.md) — Pi actors, Dispatches, Episodes, routing, and execution semantics.
- [`contracts/workflow.md`](contracts/workflow.md) — authority, quality, Working Mode, semantic work, and compounding.
- [`contracts/interfaces.md`](contracts/interfaces.md) — Human Attention, supervision, PI WEB interaction, and adapters.
- [`contracts/graphical-attention.md`](contracts/graphical-attention.md) — action-first PI WEB interaction contract.
- [`contracts/harness.md`](contracts/harness.md) — harness distribution, Entry Presets, skills, and repository adaptation.

## Plans and integrations

- [`plans/level-adoption.md`](plans/level-adoption.md) — staged adoption from unmanaged interactive Pi to managed Runs.
- [`integrations/pi-web/evaluation.md`](integrations/pi-web/evaluation.md) and [`shell-strategy.md`](integrations/pi-web/shell-strategy.md) — PI WEB evidence and shell boundary.
- [`integrations/pi-web/customization-plan.md`](integrations/pi-web/customization-plan.md) and [`principles.md`](integrations/pi-web/principles.md) — upstream delivery sequence and integration-specific development principles.

## Research

- [`research/sources/`](research/sources/) — curated evidence and source analyses.
- [`research/reports/`](research/reports/) — derived design reports.
- [`research/generated/`](research/generated/) — reproducible generated indexes; do not treat them as standing context.

Operational documentation remains beside the module it describes under `packages/`, `apps/`, `skills/`, or `scripts/`.
