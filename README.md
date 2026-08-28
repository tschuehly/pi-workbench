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

**The graphical client is being reset.** The implemented PI WEB/Workbench shell is not usable for
daily work, so the terminal remains the working surface. The replacement starts with one macOS
window per Chat and reuses PI WEB below the application shell. Use the
[`workstreams`](skills/workstreams/SKILL.md) skill to read and update Workstreams until a later UI
slice brings them into the client.

**Four of the nine packages are empty directories.** `controller/`, `pi-execution/`,
`repository-workspace/`, and `artifact-store/` contain only a `.gitkeep`. Documentation that
describes a Run Controller, managed execution, enforced workspace isolation, or durable Run
recovery is describing something unbuilt. Those decisions are collected in
[Level 4 concepts](docs/research/level-4-concepts.md) and are marked non-authoritative.

## How you control Pi's behavior

The intended Working Mode has two independent choices:

```text
Alignment:  Vibe  |  Align  |  Plan   |  Spec
Checking:   light |  tests  |  adversarial
```

Alignment controls how much shared understanding the owner judges at once. Vibe is normal work in
chat; Align asks about one coherent unconfirmed direction; Plan covers the task direction; Spec
covers required behavior and evidence. Checking states the minimum completion evidence, with a
repository-dependent default that has not been configured yet. A new context starts in Vibe;
restoring a previous choice is not part of the current design.

This control is **not implemented yet**. Current sessions do not mechanically block mutation or
show persistent mode state. Working Mode changes behavior, never permission: it cannot grant
workspace isolation, publication authority, durable execution, or recovery. Details in
[Working Mode](docs/foundation/working-mode.md).

## What's next

Build the first usable graphical slice: one Pi Chat per native macOS window, with a small chooser for
an explicitly located existing or new session. Deliver PI WEB's graphical Prompt Editor first, then
its workspace file viewer/editor as a toggleable right-hand pane without loading the legacy shell.

After those owner-selected checkpoints are in real use, add only the next capability whose absence is concrete. See the concise
[Workbench UI plan](docs/plans/workbench-ui.md). Working Mode remains a separate intended control.

## Where everything else lives

This README is the file for a human. Everything below is context for an agent, read on demand.

- [`docs/README.md`](docs/README.md) — map of all documentation and its authority order.
- [`docs/foundation/`](docs/foundation/) — decisions that govern code, canonical vocabulary,
  principles, and Working Mode.
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
