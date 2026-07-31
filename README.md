# Pi Workbench

Pi Workbench allocates human and model attention across durable project Runs. It uses Pi as its only model-worker runtime and exposes one Run protocol to terminal and graphical clients.

## Status

Early implementation scaffold. The specification suite is rooted at [`docs/SPEC.md`](docs/SPEC.md), which routes to the detailed behavioral contracts, with canonical language in [`docs/CONTEXT.md`](docs/CONTEXT.md). The approved [Pi and PI WEB Level Adoption Plan](docs/pi-level-adoption-plan.md) defines the staged path from unmanaged interactive Pi to a managed Workbench Run; the Levels are not implemented yet.

PI WEB is the initial graphical shell candidate. It remains a client of the Workbench Run Controller rather than the owner of workflow semantics.

## Repository layout

- `packages/` — the four core modules and client integrations.
- `workflows/` — versioned Workflow Contracts.
- `repositories/` — repository packages and quality envelopes.
- `skills/`, `extensions/`, `prompts/` — curated Pi capabilities.
- `schemas/` — the versioned Run protocol registry.
- `config/` — commit-safe configuration templates.
- `docs/` — product language, specification, and decisions.

## Local development

The current PI WEB source checkout is expected at:

```text
../pi-web
```

Machine-local PI WEB state remains in `~/.config/pi-web` and `~/.pi-web`. Credentials, authentication state, sessions, and machine-specific paths must not be committed here.
