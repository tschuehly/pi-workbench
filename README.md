# Pi Workbench

Pi Workbench helps one developer spend their attention well across agent-assisted work. It makes
pair programming with Pi durable across sessions, so you can leave and come back without
reconstructing state from chat history.

Pi is the only model runtime it uses.

## What works today

**Workstreams.** A Workstream is a container for your attention across sessions and repositories.
It holds several concurrent Pi sessions, the last confirmed checkpoint for each, unresolved
questions, and links. You leave, come back, and read the projection instead of scrolling a
transcript. A Workstream grants no execution authority and promises no recovery.

**Bounded child Pi processes.** A lead session can delegate work to a fresh child Pi — one child,
one assignment, one result. Children can run in the background and wake the lead once when they
finish. Nothing survives the session.

**Durable workers.** A worker is a name plus a resumable Pi session, for repeated work in one
scope. Identity survives the session; execution never does.

**Model routing by Cognitive Role.** Work is classified by the kind of thinking it needs, and each
role resolves to a model and thinking budget.

## What does not work today

**PI WEB is broken.** The documentation describes it as the user-facing client. That is the
intended design, not the current state. **The terminal is the working surface.** Use the
[`workstreams`](skills/workstreams/SKILL.md) skill to read and update Workstreams directly.

**Four of the nine packages are empty directories.** `controller/`, `pi-execution/`,
`repository-workspace/`, and `artifact-store/` contain only a `.gitkeep`. Documentation that
describes a Run Controller, managed execution, enforced workspace isolation, or durable Run
recovery is describing something unbuilt. Those decisions are collected in
[Level 4 concepts](docs/research/level-4-concepts.md) and are marked non-authoritative.

## How you control Pi's behavior

You already pick a model and a thinking budget. The third control is **how thoroughly Pi checks its
own work before showing it to you**:

```
Checking:  light  |  tests  |  adversarial
```

A named configuration across the axes is an **Operating Level**, so you choose a Level rather than
tuning knobs:

| Level | Plan agreed first? | Checking |
| --- | --- | --- |
| **1 — Pair** | No | `light` — you are watching, so you are the check |
| **2 — Agree** | Yes | `tests` — Pi tests what it changed |
| **3 — Contract** | Yes, with acceptance criteria | `adversarial` — another model family argues against the result |
| **4 — Manage** | *not selectable — needs code that does not exist* |

**A Level changes what Pi does, never what Pi is allowed to do.** Permissions need enforcement, and
that enforcement is not built. Details in [Operating Levels](docs/foundation/operating-levels.md).

## What's next

Making **Level 2 real**: writing the prompt guidance and per-Level model bindings so that "here is a
plan, execute it thoroughly" actually changes how Pi behaves. It is small, testable, and it is the
thing you cannot do today.

After that, one axis at a time from observed need — not a complete model. Nine months of Working
Mode design produced no code precisely because it tried to settle everything before shipping
anything. Pi Workbench advocates iterative work, so its own development has to demonstrate it.

## Where everything else lives

This README is the file for a human. Everything below is context for an agent, read on demand.

- [`docs/README.md`](docs/README.md) — map of all documentation and its authority order.
- [`docs/foundation/`](docs/foundation/) — decisions that govern code, canonical vocabulary,
  principles, Operating Levels.
- [`docs/contracts/`](docs/contracts/) — behavioral contracts at each module seam.
- [`docs/plans/`](docs/plans/) — implementation sequences, some complete, some not started.
- [`docs/research/`](docs/research/) — evidence, reports, and unbuilt concepts. Never authoritative.
- [`AGENTS.md`](AGENTS.md) — task router for agents working in this repository.

## Repository layout

- `packages/` — persistence, execution mechanics, client integration (four are placeholders).
- `skills/`, `extensions/`, `prompts/` — curated Pi capabilities.
- `config/` — commit-safe configuration templates.
- `schemas/`, `workflows/`, `repositories/` — protocol and policy scaffolding.

## Local development

A PI WEB source checkout is expected at `../pi-web`.

Machine-local state stays outside this repository: `~/.config/pi-web`, `~/.pi-web`, and Workstreams
in `~/.pi-workbench/workstreams`. Never commit credentials, authentication state, sessions, or
machine-specific paths.

Run the checks with:

```sh
npm test
```

That runs model routing, the Pi execution adapter, the worker registry, the Workstream store,
session coordination, the PI WEB integration, and the extension tests.
