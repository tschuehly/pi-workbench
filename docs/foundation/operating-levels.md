# Pi Workbench Operating Levels

Status: settled 2026-08-26; consequence-based checking floor revised 2026-08-27. This document defines how the owner controls Pi's working behavior.

You already choose a model and a thinking budget. An Operating Level is the third control: **how
thoroughly Pi checks its own work before showing it to you.**

## The axis

```
Checking:  light  |  tests  |  adversarial
```

| Value | What Pi does |
| --- | --- |
| `light` | No test-writing, no review pass. You are watching, so you are the check. |
| `tests` | Pi writes and runs tests for the behavior it changed, before reporting. |
| `adversarial` | Everything in `tests`, plus a fresh pass by a model from another family whose job is to argue against the result. |

The values are ordered by cost and by delay before you see anything. They are not quality ranks —
`light` is the right choice when you are sitting there, and `adversarial` is wasteful when you are.
A selected value is the checking floor: explicit owner direction, repository policy, or task
consequence may increase independent checking but never remove the Level's required checks.
[`model-orchestration`](../../skills/model-orchestration/SKILL.md) sizes any required adversarial
panel and preserves model-family Independence.

## The Levels

A named configuration across the axes *is* an Operating Level. You pick a Level, not a set of knobs.

| Level | Plan agreed first? | Checking | Selectable |
| --- | --- | --- | --- |
| **1 — Pair** | No | `light` | yes |
| **2 — Agree** | Yes, before implementation | `tests` | yes |
| **3 — Contract** | Yes, with acceptance criteria | `adversarial` | yes |
| **4 — Manage** | Yes, with acceptance criteria | `adversarial` | **no** |

A Level may also carry different model and Model Effort bindings per Cognitive Role.

**Level 1 — Pair.** You work directly with one lead Pi and stay engaged. Plans emerge and change
during execution. The lead may delegate bounded work to child Pi processes and remains accountable
for reconciling their results.

**Level 2 — Agree.** You and the lead agree an execution plan before implementation starts. Because
you are no longer checking every step, Pi writes tests for what it changes. Material deviations
come back to you for plan revision.

**Level 3 — Contract.** Work proceeds against approved acceptance criteria, and a model from a
different family reviews the result against them. Correction is bounded rather than open-ended.

**Level 4 — Manage.** Not selectable. See below.

## A Level configures behavior, never permission

This is the rule that keeps the Levels honest.

Pi Workbench can promise *"at Level 3, Pi writes tests and a second model argues against the
result."* That is true the moment it is written, because it is prompt guidance plus extra model
calls, and both mechanisms already exist.

Pi Workbench cannot promise *"at Level 3, Pi works in an isolated workspace and cannot touch your
main checkout."* That would be false. `packages/repository-workspace/` is an empty directory.
Nothing enforces it. Writing it down would only mean trusting a guarantee that does not exist,
which is worse than having no Level at all.

So Levels 1–3 are selectable today: they change what Pi does, and behavior is promptable. Level 4
is defined mostly by permissions — deterministic lifecycle control, enforced workspace isolation,
durable recovery — and stays unselectable until that code exists. Four of the five modules it
depends on are empty directories. This restates
[Principle 6](principles.md#6-authority-is-structural-never-textual): permission lives in leases,
envelopes, and schemas that services enforce, never in prompt text.

Permissions and authority are deferred. When they are built, they become axes like any other.

## Candidate future axes

Axes are added one at a time, from observed need. The [withdrawn multidimensional
proposal](../research/reports/multidimensional-working-mode-proposal.md) listed nine candidate
dimensions; recording where each landed prevents rediscovering them:

| Candidate | Status |
| --- | --- |
| Verification depth | **Done** — this is the Checking axis. |
| Direction commitment | **Done** — this is the Level 1 / 2 / 3 distinction. |
| Human Attention cadence | **Done** — continuous, interrupted by one background-completion wakeup, or absent under a Goal. Unchanged. |
| Bounds — tokens, time, attempts, stopping conditions | Candidate. Partly exists through Goals and Decision 64. |
| Delegation shape | Candidate. Partly exists through Subagents and Workers. |
| Execution governance | Deferred with permissions. Needs a Run Controller. |
| Authority envelope | Deferred with permissions. Needs enforcement. |
| Durability | Deferred with permissions. Needs a durable Run ledger. |
| Workspace protection | Deferred with permissions. Empty directory today. |

The proposal failed because it tried to settle nine dimensions before shipping one. Add the next
axis when a real task cannot be expressed without it.

## Relationships

Workstreams restore and allocate Human Attention across interactive sessions at every Level. They
grant no execution authority and make no managed-recovery claim. Attended delegation to bounded
child Pi processes is available at Levels 1–3; the Level 1 / Level 2 boundary is prior agreement to
the execution plan, not the existence of child actors.

A managed Run is a separate durable authority boundary specific to Level 4. It may be linked to a
Workstream without sharing ledger ownership.
