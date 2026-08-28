# Archived PI WEB UI direction

Status: historical. Nothing in this directory authorizes or sequences current implementation.

The current direction is [`../../plans/workbench-ui.md`](../../plans/workbench-ui.md). The retained technical boundary is [`../../integrations/pi-web/reuse-boundary.md`](../../integrations/pi-web/reuse-boundary.md). The reset evidence is [`../../research/reports/workbench-ui-reset-2026-08-28.md`](../../research/reports/workbench-ui-reset-2026-08-28.md).

## Why this archive exists

Earlier documents mixed four different things:

1. intended product behavior;
2. implementation sequences and approvals;
3. evidence from completed experiments;
4. owner dissatisfaction discovered through use.

Keeping them together made implemented mechanics look like an accepted product and made an approved experiment look like the current direction. This archive preserves the original plans while the current plan separately states what will be built.

## Archived plans

| Document | What it planned | Why it stopped | What survives |
| --- | --- | --- | --- |
| [`plans/level-1.md`](plans/level-1.md) | PI WEB-first Workstream workflow with owner-confirmed checkpoints | The graphical workflow was not used, standalone Chats became valid, and checkpoints became automatic/correctable | Implemented Store, attended execution, and one-home semantics for associated sessions |
| [`plans/pi-web-workbench-ui.md`](plans/pi-web-workbench-ui.md) | Workstream hierarchy, concise exchange, Human Tasks, and protected PI WEB controls | The plugin accumulated shell ownership and the delivered UI was not used | Typed tasks, live-ask separation, explicit anchors, focused Chat |
| [`plans/pi-web-unified-chat-workstream-prototype.md`](plans/pi-web-unified-chat-workstream-prototype.md) | One prototype combining standalone Chats, Workstreams, tools, history, and promotion | Too many product questions moved together before daily use | Standalone Chat as a lightweight destination; Workstreams remain distinct |
| [`plans/pi-web-unified-ui-production.md`](plans/pi-web-unified-ui-production.md) | Productionize the unified navigator in the Workbench plugin | Produced a large adapter and incomplete browser acceptance | Pure projection reducers, complete session identity, controlled fixtures |
| [`plans/pi-web-unified-shell-prototype-fidelity.md`](plans/pi-web-unified-shell-prototype-fidelity.md) | Ten-phase prototype-fidelity and release campaign | Scope expanded beyond a reviewable daily-use slice; Phase 3 was not retained | Keep the no-model fixture and runtime isolation; reject complete conformance as the delivery unit |
| [`plans/pi-web-controlled-session-fixture-experiment.md`](plans/pi-web-controlled-session-fixture-experiment.md) | Isolated real-route browser harness | Experiment completed; no longer needs an active plan | Reuse the fixture and runner for the replacement client |
| [`plans/pi-web-message-tree.md`](plans/pi-web-message-tree.md) | Session history and branching UI | Not needed for the first usable Chat | Reconsider only after ordinary Chat use exposes history friction |
| [`plans/pi-web-subagent-conversation-cards.md`](plans/pi-web-subagent-conversation-cards.md) | Structured child-execution cards | Not needed for the first usable Chat | Preserve child execution as subordinate to its lead session |
| [`plans/subagent-details-envelope-experiment.md`](plans/subagent-details-envelope-experiment.md) | Producer metadata for child cards | Approved only as a dependency of the archived card UI | Reconsider only when child inspection becomes observed friction |
| [`plans/workstream-continuation-extension.md`](plans/workstream-continuation-extension.md) | Shared coordination plus graphical and terminal continuation | The shared module landed; the remaining UI and host expansion belonged to the stopped shell campaign | Keep implemented Store records and coordinator; select any continuation UI later |
| [`plans/workstream-continuation-runtime-probes.md`](plans/workstream-continuation-runtime-probes.md) | Host probes for the continuation campaign | Unstarted prerequisite to archived UI scope | No current scope |

## Archived integration strategy

| Document | Former position | Current disposition |
| --- | --- | --- |
| [`integration/evaluation.md`](integration/evaluation.md) | PI WEB's complete shell should be reused | Runtime reuse remains valid; shell reuse was disproved by attended use |
| [`integration/shell-strategy.md`](integration/shell-strategy.md) | PI WEB was the only shell and Workbench used a thin plugin | Replaced by a Workbench client root using PI WEB runtime |
| [`integration/customization-plan.md`](integration/customization-plan.md) | Add upstream extension seams and shell profiles | Completed generic changes may remain; upstream customization no longer gates the product |
| [`integration/principles.md`](integration/principles.md) | Broad principles for the plugin/upstream strategy | Iteration, conversation centrality, typed state, interruption safety, and deterministic fixtures were extracted; upstream-first composition was rejected |

## Evidence that remains where it was produced

Research prototypes stay under `docs/research/reports/` because they are interaction evidence, not plans. Package acceptance records stay beside `packages/pi-web-integration/` because they document implemented legacy behavior and reusable fixtures. Neither location is current product authority.

## Reading an archived document

Treat dates, commits, checks, and findings as historical evidence. Treat approvals as approval for the named experiment only. Follow current contracts for domain semantics and the current UI plan for implementation scope.
