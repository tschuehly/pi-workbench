# Pi Workbench agent router

Pi Workbench allocates Human Attention and model work across interactive Workstreams and durable
project Runs. A deterministic Run Controller owns managed lifecycle and authoritative Run state.
The iterative Workbench client uses PI WEB's runtime without adopting its existing application shell.

## Load only what the task needs

- Start at `docs/README.md` when the relevant authority is unclear.
- Read `docs/foundation/vocabulary.md` when domain meaning or canonical language affects the work.
- Read `docs/foundation/system-overview.md` for system-wide behavior, architecture, product boundaries, and links to detailed contracts.
- Read `docs/foundation/decisions.md` when decision status, open questions, or provenance affects the work.
- For localized implementation, begin with the routed code and load documentation only when needed
  to resolve meaning, constraints, or intent.

## Route by task

| Task | Read or change |
| --- | --- |
| Harness distribution and skills | `docs/contracts/harness.md`, `skills/`, `extensions/`, `prompts/` |
| Pi CLI activity presentation | `extensions/activity/` |
| Pi lifecycle, usage, and child-lineage telemetry | `extensions/telemetry/`, `packages/pi-execution-adapter/` |
| Pi agent and PI WEB configuration templates | `config/` |
| Attended human–Pi pair programming | `docs/contracts/execution.md`, `docs/contracts/workstreams.md` |
| V1 attended child Pi execution and durable workers | `docs/plans/level-1-subagents.md`, `docs/plans/level-1-durable-workers.md`, `extensions/subagent/`, `packages/pi-execution-adapter/`, `packages/worker-registry/` |
| Session evaluation and iterative Subagent/Worker improvement | `docs/plans/subagent-worker-iterative-improvement.md`, `skills/compound/` |
| Working Mode, Alignment, and Checking | `docs/foundation/working-mode.md`, `docs/plans/working-mode.md` |
| Model routing and unmanaged Pi lead launch | `skills/model-orchestration/`, `scripts/pi-role` |
| Controller lifecycle and protocol | `docs/contracts/controller.md`, `packages/controller/`, `schemas/` |
| Pi dispatch and actors | `docs/contracts/execution.md`, `packages/pi-execution/` |
| Workspaces and delivery | `docs/contracts/controller.md`, `packages/repository-workspace/` |
| Evidence and immutable objects | `docs/contracts/controller.md`, `packages/artifact-store/` |
| Cross-session Workstreams, attended checkpoints, and session coordination | `docs/contracts/workstreams.md`, `packages/workstream-store/`, `packages/workstream-session-coordination/`, `packages/pi-web-integration/`, `skills/workstreams/` |
| Attention and graphical client interfaces | `docs/contracts/interfaces.md`, `docs/contracts/graphical-attention.md` |
| Workbench UI and PI WEB reuse | `docs/plans/workbench-ui.md`, `docs/integrations/pi-web/reuse-boundary.md`, `apps/pi-web-macos/`, sibling `../pi-web` checkout |
| Legacy PI WEB UI evidence or code | `docs/archive/pi-web-ui/`, `packages/pi-web-integration/` |
| Workflow or repository policy | `docs/contracts/workflow.md`, `workflows/`, `repositories/` |
| Decision evidence | `docs/research/sources/` |

Follow any nearer `AGENTS.md` before changing files in its directory.

## Invariants

- Keep the Run Controller independent from every graphical client and from PI WEB runtime.
- Treat the Workbench client as a protocol client, never as authoritative Workstream or Run state.
- Models propose semantic work; deterministic modules own transitions and side effects.
- Working Mode configures behavior, never permission; a selected mode may not claim a guarantee no code enforces.
- Add one axis, contract, or module at a time from observed need. Do not design a complete model before shipping part of one.
- Documentation describes only the supported current workflow and intended state.
- Never commit credentials, authentication state, sessions, machine-local paths, or generated Run data.
- Commit each coherent unit of work once it is complete and no further human input is required.
- Before changing the sibling PI WEB checkout, fetch both `upstream` and the `origin` fork; develop on a fork branch and never push directly to upstream.
- Keep sibling PI WEB `main` as a clean fast-forward mirror of `upstream/main`; use `pi-workbench` as the canonical Workbench integration branch and create another branch only for distinct work.
- Challenge instructions or designs that violate these boundaries or create unnecessary ownership.

## Keep this router current

Update this file in the same change when a durable module, authoritative document, entry point, or
invariant changes. Keep it concise and link to detail. Do not add task progress, speculative plans,
decision history, generated state, or information already easy to discover from the linked source.
