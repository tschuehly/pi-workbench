# Next steps

Status: current as of 2026-08-27.

## Working Mode is settled

```text
Alignment: Vibe | Plan | Spec
Checking:  light | tests | adversarial
```

Operating Levels are retired. Every task should begin read-only in Discovering; Pi investigates,
recommends both values, and the owner chooses before mutation. The configuration remains visible
and survives resume. The canonical behavior is in
[Working Mode](docs/foundation/working-mode.md).

## Next implementation

Follow the [Working Mode plan](docs/plans/working-mode.md):

1. Add the persisted reducer and fail-closed discovery gate.
2. Add owner selection, Plan and Spec acceptance, and one-slice Vibe behavior.
3. Keep Checking independent and truthful about prompt guidance versus mechanical evidence.
4. Show the same state continuously in Pi and PI WEB.

Do not implement the withdrawn multidimensional design or restore bundled presets.

## What remains in the standing context

Historical measurement from 2026-08-26, retained as evidence for the
[agent-usage session audit](docs/research/reports/agent-usage-session-audit-2026-08-27.md):

| Source | Words |
| --- | ---: |
| Skills index (37 skills) | 1,431 |
| `extensions/subagent` guidelines and tool descriptions | 762 |
| `AGENTS.md` project, global, nested | 894 |
| PONYTAIL MODE block | about 700 |
| `extensions/context-checkpoint` | 139 |

These measurements are evidence, not the current Working Mode design or an implementation backlog.
