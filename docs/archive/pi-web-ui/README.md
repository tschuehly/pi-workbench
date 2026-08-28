# Archived PI WEB UI campaigns

**This directory is historical. It defines no current implementation scope or sequence.**

For current work, use:

- the [Workbench UI plan](../../plans/workbench-ui.md) for product scope;
- the [PI WEB reuse boundary](../../integrations/pi-web/reuse-boundary.md) for the technical boundary; and
- the [2026-08-28 reset report](../../research/reports/workbench-ui-reset-2026-08-28.md) for the evidence behind the change.

## Why these campaigns stopped

The earlier documents mixed product intent, approved experiments, completed implementation evidence, and dissatisfaction found through use. That made working mechanics look like an accepted product and experiment approval look like current direction.

The original documents remain here as evidence. The tables explain why each campaign ended and which results are still useful.

## Product and implementation campaigns

| Campaign | What it attempted | Why it stopped | What remains useful |
| --- | --- | --- | --- |
| [Level 1](plans/level-1.md) | A PI WEB-first Workstream workflow with owner-confirmed checkpoints | The graphical workflow was not used; standalone Chats became valid; checkpoints became automatic and correctable | The implemented Store, attended execution, and one-home semantics for associated sessions |
| [PI WEB Workbench UI](plans/pi-web-workbench-ui.md) | Workstream hierarchy, concise exchange, Human Tasks, and protected PI WEB controls | The plugin accumulated shell ownership, and the delivered UI was not used | Typed tasks, separation of live asks, explicit anchors, and a focused Chat |
| [Unified Chats and Workstreams prototype](plans/pi-web-unified-chat-workstream-prototype.md) | One prototype combining standalone Chats, Workstreams, tools, history, and promotion | It moved too many product questions together before daily use could answer them | Standalone Chat as a lightweight destination; Workstreams remain distinct |
| [Unified UI production](plans/pi-web-unified-ui-production.md) | Production of the unified navigator in the Workbench plugin | It produced a large adapter and incomplete browser acceptance | Pure projection reducers, complete session identity, and controlled fixtures |
| [Unified shell prototype fidelity](plans/pi-web-unified-shell-prototype-fidelity.md) | A ten-phase prototype-fidelity and release campaign | Scope grew beyond a reviewable daily-use slice; Phase 3 was not retained | The no-model fixture and runtime isolation remain; complete conformance is rejected as a delivery unit |
| [Controlled session fixture](plans/pi-web-controlled-session-fixture-experiment.md) | An isolated, real-route browser harness | The experiment finished, so it no longer needs an active plan | The fixture and runner can support the replacement client |
| [Message tree](plans/pi-web-message-tree.md) | Session history and branching UI | The first usable Chat does not need it | Reconsider only if ordinary Chat use exposes history friction |
| [Subagent conversation cards](plans/pi-web-subagent-conversation-cards.md) | Structured child-execution cards | The first usable Chat does not need them | Child execution remains subordinate to its lead session |
| [Subagent details envelope](plans/subagent-details-envelope-experiment.md) | Producer metadata for child cards | It was approved only as a dependency of the now-archived card UI | Reconsider only if child inspection becomes observed friction |
| [Workstream continuation extension](plans/workstream-continuation-extension.md) | Shared coordination plus graphical and terminal continuation | The shared module landed; remaining UI and host expansion belonged to the stopped shell campaign | The implemented Store records and coordinator remain; continuation UI can be selected later |
| [Continuation runtime probes](plans/workstream-continuation-runtime-probes.md) | Host probes for the continuation campaign | This prerequisite was never started, and its UI scope was archived | Nothing is in current scope |

## Integration strategy campaigns

| Campaign | Former position | Why it stopped | What remains useful |
| --- | --- | --- | --- |
| [PI WEB evaluation](integration/evaluation.md) | Reuse PI WEB's complete shell | Attended use disproved shell reuse as the product structure | PI WEB runtime reuse remains valid |
| [Shell strategy](integration/shell-strategy.md) | Use PI WEB as the only shell and add Workbench through a thin plugin | The plugin became a shell and the resulting UI was not used | The replacement uses a Workbench client root with PI WEB runtime |
| [Customization plan](integration/customization-plan.md) | Add upstream extension seams and shell profiles | Upstream customization no longer gates the product | Completed generic changes may remain |
| [Integration principles](integration/principles.md) | Use broad plugin and upstream-first composition principles | Upstream-first composition did not produce the required product | Iteration, conversation centrality, typed state, interruption safety, and deterministic fixtures remain |

## How to use this archive

Treat dates, commits, checks, findings, and completed mechanics as historical evidence. An approval applies only to the experiment it names. Research prototypes remain in `docs/research/reports/`; package acceptance records remain beside `packages/pi-web-integration/`. Their locations preserve provenance, not current product authority.

Use current contracts for domain behavior and the current UI plan for implementation scope.
