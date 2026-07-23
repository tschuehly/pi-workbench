# Pi Workbench agent router

Pi Workbench allocates Human Attention and model work across durable project Runs. A deterministic
Run Controller owns lifecycle and authoritative state; terminal and graphical applications are
clients of its typed Run protocol.

## Load only what the task needs

- Read `docs/CONTEXT.md` when domain meaning or canonical language affects the work.
- Read `docs/SPEC.md` when supported behavior, architecture, or product boundaries affect the work.
- Read `docs/LEDGER.md` when decision status, open questions, or provenance affects the work.
- For localized implementation, begin with the routed code and load documentation only when needed
  to resolve meaning, constraints, or intent.

## Route by task

| Task | Read or change |
| --- | --- |
| Controller lifecycle and protocol | `packages/controller/`, `schemas/` |
| Pi dispatch and actors | `packages/pi-execution/` |
| Workspaces and delivery | `packages/repository-workspace/` |
| Evidence and immutable objects | `packages/artifact-store/` |
| PI WEB integration | `packages/pi-web-integration/`, `docs/pi-web-interface-evaluation.md` |
| macOS PI WEB wrapper | `apps/pi-web-macos/` |
| Graphical-shell boundaries | `docs/graphical-shell-strategy.md`, `docs/graphical-attention-contract.md` |
| Workflow or repository policy | `workflows/`, `repositories/` |
| Decision evidence | `docs/ledgers/` |

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
