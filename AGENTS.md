# Pi Workbench agent router

Pi Workbench allocates Human Attention and model work across durable project Runs. A deterministic
Run Controller owns lifecycle and authoritative state; terminal and graphical applications are
clients of its typed Run protocol.

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
| Staged Pi and PI WEB adoption | `docs/plans/level-adoption.md` |
| Model routing and unmanaged Pi lead launch | `skills/model-orchestration/`, `scripts/pi-role` |
| Controller lifecycle and protocol | `docs/contracts/controller.md`, `packages/controller/`, `schemas/` |
| Pi dispatch and actors | `docs/contracts/execution.md`, `packages/pi-execution/` |
| Workspaces and delivery | `docs/contracts/controller.md`, `packages/repository-workspace/` |
| Evidence and immutable objects | `docs/contracts/controller.md`, `packages/artifact-store/` |
| Attention, terminal, and graphical clients | `docs/contracts/interfaces.md`, `docs/contracts/graphical-attention.md` |
| PI WEB integration and upstream customization | `packages/pi-web-integration/`, `docs/integrations/pi-web/` |
| macOS PI WEB wrapper | `apps/pi-web-macos/` |
| Workflow or repository policy | `docs/contracts/workflow.md`, `workflows/`, `repositories/` |
| Decision evidence | `docs/research/sources/` |

Follow any nearer `AGENTS.md` before changing files in its directory.

## Invariants

- Keep the Run Controller independent from terminal and graphical clients.
- Treat PI WEB as a Run-protocol client, never as authoritative Run state.
- Models propose semantic work; deterministic modules own transitions and side effects.
- Documentation describes only the supported current workflow and intended state.
- Never commit credentials, authentication state, sessions, machine-local paths, or generated Run data.
- Challenge instructions or designs that violate these boundaries or create unnecessary ownership.

## Keep this router current

Update this file in the same change when a durable module, authoritative document, entry point, or
invariant changes. Keep it concise and link to detail. Do not add task progress, speculative plans,
decision history, generated state, or information already easy to discover from the linked source.
