# Pi Workbench

Pi Workbench helps one developer work with Pi, leave, and resume without reconstructing the work
from chat history. Pi is its only model runtime.

**Current reality:** the attended terminal workflow and the graphical Workbench client both work.
The macOS app hosts the Workbench client from the PI WEB fork.

## What we are building now

Each native window holds several Chats in Tabs or Grid, with a chooser that shows Workstream
re-entry cards, in-composer questions, a Files pane with a live editor, and an Activity roster. The
client reuses PI WEB runtime but not its legacy application shell. The base stays PI WEB plus Pi
Durable; phone access follows the Durable rebuild. Each next feature must answer a problem observed
in use. See the [Workbench UI plan](docs/plans/workbench-ui.md).

## What works today

### Workstreams

A Workstream preserves attention across sessions and repositories. It records associated sessions,
the latest checkpoint for each, unresolved Human Tasks, and links. You can resume from this compact
projection instead of rereading transcripts.

Workstreams grant no execution authority and promise no recovery. The Workbench chooser shows them
as re-entry cards; to create, checkpoint or close them, use the
[`workstreams`](skills/workstreams/SKILL.md) skill.

### Bounded child Pi processes

A lead session can give one bounded assignment to a fresh child Pi and collect one result. A child
may run in the background and wake the lead once when it finishes. No child process survives the
attended session.

### Durable workers

A Worker is a name plus a resumable Pi session for repeated assignments in one scope. Its identity
survives; its execution does not.

### Model routing

Workbench classifies work by Cognitive Role and resolves each role to a model and thinking budget.

## What is not fully implemented

### Working Mode

`/mode` sets four independent choices:

```text
Alignment:      Default | Align | Plan | Spec
Attention:      Default | Focused | Switching | Phone | AFK
Checking:       Default | Exercise | Test | Challenge
Orchestration:  Main | Subagents | Workers
```

Alignment sets how shared understanding is established, Attention how and whether Pia contacts
the owner, Checking the minimum completion evidence, and Orchestration the structure of primary
execution. A change reaches the model as one tagged message with the next prompt, leaving the
system prompt and its cache unchanged; the session records it and resume restores it. Working Mode
changes behavior, never permissions, tools, or the skill catalog. See
[Working Mode](docs/foundation/working-mode.md).

### Managed execution

Four package directories are placeholders: `controller/`, `pi-execution/`,
`repository-workspace/`, and `artifact-store/`. Claims about a Run Controller, enforced workspace
isolation, durable Run recovery, or managed execution describe unbuilt concepts. They live in
[Level 4 concepts](docs/research/level-4-concepts.md) and are not authoritative behavior.

## Documentation map

- [`docs/README.md`](docs/README.md) — where to find authority, plans, and evidence.
- [`docs/foundation/`](docs/foundation/) — vocabulary, system boundaries, principles, and decisions.
- [`docs/contracts/`](docs/contracts/) — stable behavior at module boundaries.
- [`docs/plans/`](docs/plans/) — implementation sequences and their status.
- [`docs/research/`](docs/research/) — evidence and reports; never product authority.
- [`AGENTS.md`](AGENTS.md) — task router for agents working in this repository.

## Repository layout

- `packages/` — persistence, execution, and integration modules; four remain placeholders.
- `skills/`, `extensions/`, `prompts/` — Pi capabilities distributed by the harness.
- `config/` — commit-safe configuration templates.
- `schemas/`, `workflows/`, `repositories/` — protocol and policy scaffolding.

## Local development

Keep a PI WEB source checkout at `../pi-web`.

Machine-local state belongs outside this repository: `~/.config/pi-web`, `~/.pi-web`, and
`~/.pi-workbench/workstreams`. Never commit credentials, authentication state, sessions, or
machine-specific paths.

Run the repository checks with:

```sh
npm test
```

This command covers model routing, quota startup, activity and autonomous-grill extensions, child
execution, the Pi execution adapter, Worker registry, Workstream Store, session coordination, and
PI WEB integration.
