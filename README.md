# Pi Workbench

Pi Workbench allocates human and model attention across durable project Runs. It uses Pi as its only model-worker runtime and exposes one Run protocol to terminal and graphical clients.

## Status

V1 implements the approved [Level 1 Plan](docs/plans/level-1.md): durable Workstreams, attended PI WEB sessions, confirmed checkpoints, resume and closure, plus bounded attended child Pi execution. Start with the [documentation map](docs/README.md). The specification suite is rooted at the [system overview](docs/foundation/system-overview.md), with canonical language in the [vocabulary](docs/foundation/vocabulary.md). The [Operating Levels specification](docs/foundation/operating-levels.md) defines Levels 2–4 as concepts rather than roadmap commitments.

PI WEB hosts the supported interactive runtime and remains a typed-protocol client, not authoritative Workstream or Run state.

## Repository layout

- `packages/` — persistence, execution mechanics, future managed modules, and client integrations.
- `workflows/` — versioned Workflow Contracts.
- `repositories/` — repository packages and quality envelopes.
- `skills/`, `extensions/`, `prompts/` — curated Pi capabilities.
- `schemas/` — the versioned Run protocol registry.
- `config/` — commit-safe configuration templates.
- `docs/` — foundation, authoritative contracts, plans, integrations, and research evidence.

## Local development

The current PI WEB source checkout is expected at:

```text
../pi-web
```

Machine-local PI WEB state remains in `~/.config/pi-web` and `~/.pi-web`; Workstreams default to `~/.pi-workbench/workstreams`. Credentials, authentication state, sessions, and machine-specific paths must not be committed here.

Run deterministic Level 1 checks with:

```sh
npm run test:model-routing
npm run test:pi-execution-adapter
npm run test:workstream-store
npm run test:pi-web-integration
(cd ../pi-web && npm run typecheck && npm test)
```
