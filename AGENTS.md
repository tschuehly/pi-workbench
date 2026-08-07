# Pi Workbench agent router

Pi Workbench allocates Human Attention and model work across interactive Workstreams and durable
project Runs. A deterministic Run Controller owns managed lifecycle and authoritative Run state;
PI WEB is the user-facing client of its typed protocols.

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
| V1 human–Pi pair programming | `docs/plans/level-1.md` |
| V1 attended child Pi execution | `docs/plans/level-1-subagents.md`, `extensions/subagent/`, `packages/pi-execution-adapter/` |
| Operating-level concepts | `docs/foundation/operating-levels.md` |
| Model routing and unmanaged Pi lead launch | `skills/model-orchestration/`, `scripts/pi-role` |
| Controller lifecycle and protocol | `docs/contracts/controller.md`, `packages/controller/`, `schemas/` |
| Pi dispatch and actors | `docs/contracts/execution.md`, `packages/pi-execution/` |
| Workspaces and delivery | `docs/contracts/controller.md`, `packages/repository-workspace/` |
| Evidence and immutable objects | `docs/contracts/controller.md`, `packages/artifact-store/` |
| Cross-session Workstreams and attended checkpoints | `docs/contracts/workstreams.md` |
| Attention and PI WEB interfaces | `docs/contracts/interfaces.md`, `docs/contracts/graphical-attention.md` |
| PI WEB integration and fork customization | `packages/pi-web-integration/`, `docs/integrations/pi-web/`, `docs/plans/pi-web-unified-ui-production.md`, sibling `../pi-web` checkout |
| macOS PI WEB wrapper | `apps/pi-web-macos/` |
| Workflow or repository policy | `docs/contracts/workflow.md`, `workflows/`, `repositories/` |
| Decision evidence | `docs/research/sources/` |

Follow any nearer `AGENTS.md` before changing files in its directory.

## Invariants

- Keep the Run Controller independent from PI WEB.
- Treat PI WEB as a Run-protocol client, never as authoritative Run state.
- Models propose semantic work; deterministic modules own transitions and side effects.
- Documentation describes only the supported current workflow and intended state.
- Never commit credentials, authentication state, sessions, machine-local paths, or generated Run data.
- Commit each coherent unit of work once it is complete and no further human input is required.
- Before changing the sibling PI WEB checkout, fetch both `upstream` and the `origin` fork; develop on a fork branch and never push directly to upstream.
- Keep sibling PI WEB `main` as a clean fast-forward mirror of `upstream/main`. Continue the existing fork branch for its scope; create another branch only for distinct work.
- Challenge instructions or designs that violate these boundaries or create unnecessary ownership.

## Keep this router current

Update this file in the same change when a durable module, authoritative document, entry point, or
invariant changes. Keep it concise and link to detail. Do not add task progress, speculative plans,
decision history, generated state, or information already easy to discover from the linked source.
