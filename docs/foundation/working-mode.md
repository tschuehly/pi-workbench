# Pi Workbench Working Mode

Status: owner-confirmed intended behavior as of 2026-08-28. The Alignment control and persistent
presentation are not implemented. Checking is available only as prompt-guided behavior.

Working Mode lets the owner choose how Pi establishes shared understanding and what evidence Pi must
produce before claiming completion. It has two independent behavioral axes:

```text
Alignment:  Vibe  |  Align  |  Plan   |  Spec
Checking:   light |  tests  |  adversarial
```

Working Mode configures behavior, never permission. Human Attention, model, Model Effort, authority,
delegation, durability, and workspace protection remain separate capabilities. There are no bundled
Operating Levels.

## Alignment

Alignment values are ordered by how much shared understanding the owner must judge at once.

| Value | Shared-understanding behavior |
| --- | --- |
| `Vibe` | Work normally in chat. Pi and the owner align continuously without a separate artifact or extra guard. |
| `Align` | Before one unconfirmed product, architecture, scope, or quality choice becomes durable implementation or parallel work, Pi presents the coherent change and asks whether its direction is right. |
| `Plan` | The owner accepts a concise statement of outcome, approach, boundaries, and evidence for the whole task. |
| `Spec` | The owner accepts required behavior, constraints, and acceptance evidence; implementation strategy may adapt. |

`Vibe` is the normal interactive experience. It adds no one-slice limit, attention detector, pause
boundary, or automatic mode switch.

`Align` is a prompt-guided trial, not a mechanically enforced gate. Pi asks before turning an
uncertain semantic choice into committed work, not before every file edit. It may proceed without a
new question when implementation stays inside an already understood direction. It asks again when
evidence invalidates that direction or materially changes the consequence.

Examples:

- **Ask before:** remove an existing capability, introduce a new state owner, choose a product
  trade-off, broaden scope, or turn a prototype into the delivery architecture.
- **Proceed without asking:** rename a local symbol, repair a defect inside accepted behavior, or
  perform an implementation detail that does not alter the owner's understood outcome.
- **Ask again:** contrary evidence appears, a reversible experiment becomes a lasting dependency,
  or the proposed change gains material scope, risk, or quality consequences.

Evaluate the Align trial from observed use: missed consequential choices, unnecessary
interruptions, and summaries that are difficult for the owner to judge. Do not add a mutation lock
or richer state model without that evidence.

A `Plan` confirms task direction rather than predicting every implementation step. A `Spec` adds
behavioral precision only when the outcome needs it. Grilling may produce either artifact when
material ambiguity remains. It asks the current frontier of decisions, finds facts rather than
asking the owner for them, and ends with owner confirmation of the shared understanding.

Working Mode creates no durable plan file. Accepted direction stays in the Pi session; Workstream
checkpoints provide fresh-session and next-day continuity.

## Checking

Checking states the minimum evidence Pi must produce before reporting completion.

| Value | Minimum evidence |
| --- | --- |
| `light` | Inspect or exercise the changed result directly. No test-writing or separate review pass is required. |
| `tests` | Run the relevant automated tests that prove the changed behavior and report the exact result. |
| `adversarial` | Produce the relevant deterministic evidence, then obtain a fresh independent challenge against the result. |

The values are ordered by cost and delay, not quality. Alignment never silently selects Checking.
Explicit owner direction, repository policy, or the consequence of a wrong conclusion may require a
stronger floor, but cannot silently remove selected checks.

There is no universal Checking default. The default is repository-dependent, but no default value,
configuration schema, or format is adopted yet. Whether the owner inspects evidence live or Pi
produces it for later review may change the evidence route without changing the Checking value.

## Delegation and model orchestration

Delegation remains task-local under every Alignment value; it is not another Working Mode axis. The
intended structure is one [`model-orchestration`](../../skills/model-orchestration/SKILL.md) router
that conditionally loads Binding, Checking, future Managed-dispatch, or calibration guidance. Today
Binding and Checking guidance remain in the skill itself, no Managed-dispatch reference exists, and
the router conditionally loads only routing rationale for policy evaluation and provenance for port
audits.

## Start and presentation

A new context starts in `Vibe`. The owner may state a different Alignment or Checking value in
conversation. Persisting and restoring a prior Alignment choice is not part of the current design;
the same Pi session retains its conversation naturally.

A future visible control may present the active values, but no selection surface or persistent
footer exists today. Working Mode does not block project mutation mechanically. It cannot grant a
workspace lease, filesystem isolation, publication authority, durable execution, or recovery.
Those claims require deterministic services that enforce them.

## Human Attention and continuity

Human Attention remains distinct from Working Mode. The managed-Run Human-Attention Contract stays
intact, but interactive work gains no Attention axis, agreement, presence detector, or inferred
cadence now. Reopen that question only after repeated evidence that Pi interrupts too often, fails
to ask, or mishandles an explicit statement that the owner is away.

A Workstream checkpoint is the canonical fresh-session or next-day re-entry source. The approved
`Reconcile and End` trial is separate: it would write a session-local owner-facing Session Summary
for someone returning to the same Pi session. That summary is not read automatically for next-day
re-entry and does not replace a Workstream checkpoint. Compaction remains lossy model context;
`compound` evaluates completed sessions for harness improvement rather than continuity.

## Deferred repository adaptation

If repository-level Working Mode configuration is later adopted, its committed path is
`.pi-workbench/config.json`. Its schema, format, prompt composition, and adoption remain deferred.
Repository Adaptation—stable mode meanings with project-specific prompts, skills, commands, and
evidence—remains a hypothesis. The PhotoQuest and Embabel trials are deferred and neither target
repository is changed by this design.

Axes and configuration are added one at a time from observed need. The withdrawn
[multidimensional proposal](../research/reports/multidimensional-working-mode-proposal.md) remains
research, not a backlog or specification.
