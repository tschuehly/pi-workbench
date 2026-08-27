# Pi Workbench Working Mode

Status: owner-settled intended behavior as of 2026-08-27. Alignment selection, mutation gating,
and persistent display are not implemented; Checking is available only as prompt-guided behavior.

Working Mode lets the owner choose how Pi aligns before mutation and how Pi checks the resulting
work. It has two independent axes:

```text
Alignment:  Vibe  |  Plan   |  Spec
Checking:   light |  tests  |  adversarial
```

There are no bundled Operating Levels. Human Attention, model, Model Effort, authority, delegation,
durability, and workspace protection remain separate capabilities rather than hidden parts of a
mode.

## Start in Discovering

Every task starts read-only with both values unselected:

```text
Alignment: — · Checking: — · Discovering
```

Pi gathers enough evidence to understand the task, then recommends both values with one short
reason. The owner chooses. Pi cannot mutate the project until that choice is explicit.

The current values and state remain visible in the session footer, survive session resume, and
change only prospectively. Pi may recommend a change but cannot choose one. Repository policy or
task consequence may reject insufficient Checking; the owner still chooses an acceptable value.

## Alignment

Alignment is the minimum shared understanding required before Pi may mutate the project.

| Value | Before mutation | Stopping point |
| --- | --- | --- |
| `Vibe` | No separate artifact. Pi may realize one small, reversible idea directly. | Return after one owner-inspectable slice, before expanding the work. |
| `Plan` | The owner accepts a concise statement of outcome, approach, boundaries, and evidence. | Work stays inside that shared direction; a material deviation returns for alignment. |
| `Spec` | The owner accepts the required behavior, constraints, and acceptance evidence. | Work stays inside that accepted behavior; implementation strategy may adapt. |

`Vibe` is not permission to do everything in one turn. An inspectable slice is a concrete result the
owner can judge before another slice begins; it is not a universal line, file, or time limit.
Removing an existing capability is allowed when the owner's request explicitly includes that
trade-off. Otherwise, removal is a Material Question and mutation pauses.

`Plan` is intentionally concise. It exists to confirm shared understanding, not to predict every
implementation step. `Spec` is larger only when the outcome needs more behavioral precision; it
does not freeze implementation details.

Grilling is a technique for producing a Plan or Spec when material ambiguity remains. It asks only
the frontier of decisions that can be answered, uses evidence rather than asking the owner for
facts Pi can find, and stops when the selected artifact can be accepted—not when models run out of
questions.

Every recommendation, question, Plan, Spec, and review message applies the `write-for-humans` skill.

## Checking

Checking controls how thoroughly Pi verifies the work before reporting.

| Value | What Pi does |
| --- | --- |
| `light` | No required test-writing or separate review pass. The attending owner directly checks the result. |
| `tests` | Pi writes and runs tests for the changed behavior before reporting. |
| `adversarial` | Everything in `tests`, plus a fresh cross-family challenge whose job is to argue against the result. |

The values are ordered by cost and delay, not by quality. A selected value is the checking floor.
Explicit owner direction, repository policy, or the consequence of a wrong conclusion may require
more independent checking, but cannot silently remove the selected checks. The
[`model-orchestration`](../../skills/model-orchestration/SKILL.md) skill sizes required adversarial
fan-out and preserves model-family Independence.

## Selection and execution

Selecting `Vibe` permits one owner-inspectable slice and then relocks for review. Selecting `Plan`
or `Spec` keeps the project read-only while Pi prepares the corresponding artifact; the owner
explicitly proceeds after accepting it. Plan and Spec execution continue inside the accepted
direction and relock on completion or a Material Question. Changing either axis applies only to
future work.

Working Mode may withhold an available mutation capability; it cannot grant one. It cannot grant a workspace lease, filesystem
isolation, publication authority, durable execution, or recovery guarantee. Those claims require
deterministic services that enforce them.

## Future dimensions

Axes are added one at a time from observed need. The withdrawn
[multidimensional proposal](../research/reports/multidimensional-working-mode-proposal.md) remains
research, not a backlog or specification.

| Dimension | Status |
| --- | --- |
| Alignment intensity | Current intended axis. |
| Checking depth | Current intended axis; prompt-guided today, without selection or persistent display. |
| Human Attention cadence | Existing session capability, not a Working Mode axis. |
| Bounds, delegation shape | Candidate only when observed work requires a control. |
| Authority, execution governance, durability, workspace protection | Deferred until deterministic services can enforce them. |
