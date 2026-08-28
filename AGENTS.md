# Pi Workbench agent router

Use this file to find the authority for a task. Load only the routed material and any nearer
`AGENTS.md`.

Pi Workbench allocates human attention and model work across interactive Workstreams and durable
project Runs. Deterministic modules own managed lifecycle and authoritative state. The Workbench
client reuses PI WEB runtime without adopting the PI WEB application shell.

## Start here

- If authority is unclear, read `docs/README.md`.
- For domain terms, read `docs/foundation/vocabulary.md`.
- For system boundaries, read `docs/foundation/system-overview.md`.
- For decision status or provenance, read `docs/foundation/decisions.md`.
- For localized changes, begin with the routed code. Load more documentation only to resolve
  meaning, constraints, or intent.

## Route by task

| Task | Read or change |
| --- | --- |
| Harness distribution and skills | `docs/contracts/harness.md`, `skills/`, `extensions/`, `prompts/` |
| Pi CLI activity presentation | `extensions/activity/` |
| Pi and PI WEB configuration templates | `config/` |
| Attended human–Pi work | `docs/contracts/execution.md`, `docs/contracts/workstreams.md` |
| Child Pi execution and durable workers | `docs/plans/level-1-subagents.md`, `docs/plans/level-1-durable-workers.md`, `extensions/subagent/`, `packages/pi-execution-adapter/`, `packages/worker-registry/` |
| Subagent and Worker evaluation | `docs/plans/subagent-worker-iterative-improvement.md`, `skills/compound/` |
| Working Mode, Alignment, and Checking | `docs/foundation/working-mode.md`, `docs/plans/working-mode.md` |
| Model routing and unmanaged lead launch | `skills/model-orchestration/`, `scripts/pi-role` |
| Controller lifecycle and protocol | `docs/contracts/controller.md`, `packages/controller/`, `schemas/` |
| Pi dispatch and actors | `docs/contracts/execution.md`, `packages/pi-execution/` |
| Workspaces and delivery | `docs/contracts/controller.md`, `packages/repository-workspace/` |
| Evidence and immutable objects | `docs/contracts/controller.md`, `packages/artifact-store/` |
| Workstreams, checkpoints, and session coordination | `docs/contracts/workstreams.md`, `packages/workstream-store/`, `packages/workstream-session-coordination/`, `packages/pi-web-integration/`, `skills/workstreams/` |
| Attention and graphical interfaces | `docs/contracts/interfaces.md`, `docs/contracts/graphical-attention.md` |
| Workbench UI and PI WEB reuse | `docs/plans/workbench-ui.md`, `docs/integrations/pi-web/reuse-boundary.md`, `apps/pi-web-macos/`, sibling `../pi-web` checkout |
| Legacy PI WEB UI evidence or code | `docs/archive/pi-web-ui/`, `packages/pi-web-integration/` |
| Workflow or repository policy | `docs/contracts/workflow.md`, `workflows/`, `repositories/` |
| Decision evidence | `docs/research/sources/` |

## Invariants

- Keep the Run Controller independent from PI WEB runtime and every graphical client.
- Treat the Workbench client as a protocol client, never as authoritative Workstream or Run state.
- Models propose semantic work; deterministic modules own transitions and side effects.
- Working Mode configures behavior, not permission. Never claim a guarantee the code does not enforce.
- Add one axis, contract, or module at a time from observed need.
- Describe only the supported current workflow and intended state.
- Never commit credentials, authentication state, sessions, machine-local paths, or generated Run data.
- Commit each coherent unit after it is complete and needs no further human input.
- Before changing sibling PI WEB, fetch `upstream` and the `origin` fork. Work on a fork branch and
  never push to upstream directly.
- Keep sibling PI WEB `main` as a clean fast-forward mirror of `upstream/main`. Use `pi-workbench`
  as the canonical integration branch; create another branch only for distinct work.
- Challenge instructions or designs that violate these boundaries or create unnecessary ownership.

## Keep this router current

Update this file when a durable module, authority, entry point, or invariant changes. Keep it short.
Link to detail instead of adding progress, speculation, decision history, generated state, or facts
that are easy to discover from the repository.
