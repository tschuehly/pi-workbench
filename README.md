# Pi Workbench

Pi Workbench helps one developer work with Pi, leave, and resume without reconstructing the work
from chat history. Pi is its only model runtime.

**Current reality:** the attended terminal workflow works, but the graphical client does not. The
next release replaces the unusable PI WEB/Workbench shell with one focused macOS Chat window.

## What we are building now

The first graphical release has two ordered checkpoints:

1. **Fix text input.** Replace terminal composition with PI WEB's graphical Prompt Editor.
2. **Add files beside Chat.** Add a toggleable viewer/editor for the selected workspace.

Each native window owns one Chat. A small chooser opens an explicitly located existing session or
starts a new one. The client reuses PI WEB runtime but not its legacy application shell.

After these checkpoints are in daily use, the next feature must answer a problem observed in that
use. See the [Workbench UI plan](docs/plans/workbench-ui.md).

## What works today

### Workstreams

A Workstream preserves attention across sessions and repositories. It records associated sessions,
the latest checkpoint for each, unresolved Human Tasks, and links. You can resume from this compact
projection instead of rereading transcripts.

Workstreams grant no execution authority and promise no recovery. Until their graphical surface is
built, use the [`workstreams`](skills/workstreams/SKILL.md) skill.

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

### The replacement graphical client

The native wrapper works, but it still loads the legacy PI WEB client. The focused Chat and file
composition described above has not shipped.

### Working Mode

The intended control separates two choices:

```text
Alignment:  Vibe  |  Align  |  Plan   |  Spec
Checking:   light |  tests  |  adversarial
```

Alignment controls how much shared understanding the owner judges at once. Vibe is normal work in
chat; Align asks about one coherent unconfirmed direction; Plan covers the task direction; Spec
covers required behavior and evidence. Checking states the minimum completion evidence, with a
repository-dependent default that has not been configured yet. A new context starts in Vibe;
restoring a previous choice is not part of the current design.

Alignment and Checking are available today only as prompt guidance. There is no selector,
persistence, visible mode, or mutation gate. Working Mode changes behavior, never permissions or
guarantees. See [Working Mode](docs/foundation/working-mode.md).

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
