# Next steps

For a fresh session. Refine the concepts first, then work on the Workbench in small steps.

## Where things stand

**Settled and committed.** Work is controlled by one dial: how carefully the agent checks its own
work before reporting.

```
light  |  tests  |  adversarial
```

`light` writes no tests and runs no review — you are watching, so you are the check. `tests` writes
and runs tests for what changed. `adversarial` adds a second model from another provider whose job
is to argue against the result. Recorded as Decision 69 and
[operating levels](docs/foundation/operating-levels.md).

**Done.** Twenty video-editing skills (1,376 words) no longer load in any project. They moved to
`~/.agents/skills-video/`; `~/.claude/skills/` still has them. The skills index dropped from 2,807
to 1,431 words. Restore with `mv ~/.agents/skills-video/* ~/.agents/skills/`. To use them in a video
project, add to that project's `.pi/settings.json`:

```json
{ "skills": ["/Users/tschuehly/.agents/skills-video"] }
```

**Not usable yet.** PI WEB's new Workstreams UI is still being built, so the terminal is the working
surface. The design is sound; only the UI is unfinished.

## The idea to refine

Each repository and project should get **only the skills and prompts it needs**, and the intensity
setting should decide how much of that loads. A `light` session should carry less than a session
does today, not more.

## What is still open

1. **Naming.** Four levels are defined but you consistently want three, and the fourth cannot be
   selected. The names — Pair, Agree, Contract, Manage — come from an abandoned model. Proposal:
   three settings named `light / tests / adversarial`, no numbers, and Level 4 dropped entirely
   since managed execution is a different unbuilt thing already recorded in
   [level 4 concepts](docs/research/level-4-concepts.md).
2. **Per-repository audit.** Which skills and prompts each project actually needs. The video cut was
   the obvious case; the rest needs judgment.
3. **Admission rule.** What earns a place in every session's context. Dossier already written:
   [default-context challenge](docs/research/reports/default-context-challenge-dossier.md), tracked
   as `task-challenge-default-context`.

## The one technical unknown

**Can an extension remove context, or only add to it?**

Pi has no per-project way to exclude a skill. There is only `--no-skills`, which turns everything
off, and additive `--skill` paths. So the video cut required moving files.

`event.systemPromptOptions` is documented as mutable and exposes `.skills`, `.selectedTools`,
`.promptGuidelines`, and `.contextFiles`. But `before_agent_start` runs *after* the prompt is built,
so changing `.skills` there may do nothing.

**Probe it before designing anything.** Write one throwaway extension that drops all but three
skills and print the resulting prompt size. Reference: `examples/extensions/prompt-customizer.ts` in
the Pi package.

- Works → intensity-based context loading is possible, and per-project skill selection stops
  requiring file moves.
- Does not work → intensity can only add text. Say so and stop rather than building the additive
  version, which was already tried and reverted (reflog `48331fa`, `fc19ec6`).

## What remains in the standing context

Measured 2026-08-26, after the video cut.

| Source | Words |
| --- | ---: |
| Skills index (37 skills) | 1431 |
| `extensions/subagent` guidelines and tool descriptions | 762 |
| `AGENTS.md` project, global, nested | 894 |
| PONYTAIL MODE block | ~700 |
| `extensions/context-checkpoint` | 139 |

`extensions/subagent` is the largest single thing Pi Workbench itself contributes. The
default-context dossier records that its guidelines were added on reasoning rather than on any
observed failure, so it is the first candidate to test against the admission rule.

## Suggested order

1. Fix the naming — cheap now, harder after anything is built on it.
2. Run the probe.
3. Then decide per-repository skill sets, informed by whether the probe passed.

Do not implement before agreeing a plan. The last attempt skipped that step and was reverted.

## Open tasks

Workstream `ws-level-2-and-post-settlement-20260826` holds five: review the settlement, 34
machine-local paths in `docs/research/sources/recent-repositories.md`, the unbounded
`autonomous-grill` skill, eight unstarted plans, and three contradictions among the kept decisions.

Workstream `ws-workbench-guiding-principles-20260807` holds eight, including writing the
incrementalism maxim in your own words.
