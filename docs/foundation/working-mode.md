# Pi Workbench Working Mode

Status: the owner-approved Pi terminal slice provides `/mode` and a footer indicator. Both axes
remain prompt-guided behavior, not mechanically enforced gates.

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

The terminal control starts Checking at `unset`: it adds no selected evidence floor and leaves
explicit owner direction, repository policy, and task consequences in effect. `unset` is absence
of a selection, not a fourth Checking level or an instruction to skip checks. No repository default
configuration schema or format is adopted yet. Whether the owner inspects evidence live or Pi
produces it for later review may change the evidence route without changing the Checking value.

## Delegation and model orchestration

Delegation remains task-local under every Alignment value; it is not another Working Mode axis. The
[`model-orchestration`](../../skills/model-orchestration/SKILL.md) skill is one router with separate
Binding and Checking references. Binding applies to every delegated Subagent or Worker invocation;
Checking applies when independent challenge is required by the selected floor, owner direction,
repository policy, or material risk. Routing rationale and provenance remain conditional references
for policy evaluation and port audits. Managed Dispatch remains a future controller boundary.

## Start and presentation

In the Pi terminal, `/mode` opens a built-in picker: choose an axis, then its value. The footer
shows both selections as guidance. Choices apply to the next prompt, not an already-running agent
loop. Changing either axis leaves the other unchanged; cancelling leaves both unchanged.

Selections exist only in extension memory. Startup, `/reload`, `/new`, `/resume`, and `/fork` or
`/clone` reset them to `Vibe` and `unset`. Compaction and `/tree` navigation retain the current
in-memory choices rather than restoring historical ones. Conversation remains ordinary session
context; the control neither parses chat for selections nor removes earlier owner instructions.
Use `/mode` to change the displayed selection.

The control is terminal-only; RPC, print, and JSON sessions receive no selector or injected Working
Mode guidance from this extension. No settings or session entries are written. Working Mode does
not block project mutation mechanically or grant workspace leases, filesystem isolation,
publication authority, durable execution, or recovery. Those claims require deterministic services
that enforce them. See the [extension](../../extensions/working-mode/README.md) for use and checks.

## Skill discovery trial

The owner-approved trial filters the automatic skill catalog on the next terminal prompt in the
checkout hosting this extension. It does not change installation, skill files, command completion,
`/skill:name` expansion, tools, permissions, or repository instructions. Outside that checkout and
in non-terminal sessions, discovery stays unchanged. Unknown skills retain Pi's existing behavior.
This is a fixed Workbench trial, not a repository configuration loader.

The reviewed mapping is identical under Vibe, Align, Plan, and Spec:

| Automatic discovery | Skills |
| --- | --- |
| All modes, task-triggered | `define-goal`, `write-for-humans`, `codebase-design`, `prototype`, `atelier`, `btw`, `focus-handoff`, `workstreams`, `writing-for-agents`, `mcp-scripting`, `monitor`, `ponytail`, `agent-browser`, `diagnosing-bugs`, `research`, `wizard`, `model-orchestration` |
| Checking `tests` or `adversarial` | `tdd` |
| Checking `adversarial` only | `code-review`, `ponytail-review` |
| Manual-only in every mode | `grilling`, `domain-modeling`, `to-spec`, `autonomous-grill`, `grill-with-docs`, `handoff`, `improve-codebase-architecture`, `process-scan-inbox`, `setup-matt-pocock-skills`, `teach`, `to-tickets`, `triage`, `wayfinder`, `workbench-compound`, `analyze-source-for-workbench`, `marketing-studio`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `customize-pi-web-presentation` |

This records the 41 reviewed skills, not a complete installation audit. Discovery permits
consideration when the task matches; it does not make a skill mandatory. In particular, discovering
`tdd` does not require test-first development, and discovering `model-orchestration` does not require
delegation. `customize-pi-web-presentation` remains explicit legacy PI WEB tooling, not a retired skill.

Filtering only removes entries Pi already included. It does not install missing skills or override
an existing manual-only flag. Hidden skills remain explicitly callable when installed; repository
requirements can still direct their use. Already loaded instructions remain in conversation context
and cannot be erased by changing a dial. Tests can prove prompt delivery and command preservation,
not model obedience. See the [extension checks](../../extensions/working-mode/README.md).

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
