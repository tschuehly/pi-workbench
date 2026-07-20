# Pi Workbench

Pi Workbench allocates human and model attention across durable project Runs. It uses Pi as its only model-worker runtime and exposes one Run protocol to terminal and graphical clients.

## Status

Early implementation scaffold. The initial workflow and architecture are specified in [`docs/SPEC.md`](docs/SPEC.md), with canonical language in [`docs/CONTEXT.md`](docs/CONTEXT.md).

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
