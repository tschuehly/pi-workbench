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

**Done.** Twenty video-editing skills (1,376 words) no longer load in any project. The skills index
dropped from 2,807 to 1,431 words.

They were not deleted — they belong to PhotoQuest, which already managed skills with
[skills.sh](https://skills.sh) and a tracked `skills-lock.json`. The files had gone missing from its
`.agents/skills/`, leaving 18 broken symlinks in `.claude/skills`; the supported repair is
`npx skills experimental_install`. PhotoQuest commits `c16d66b0e` and `9084bfb2f` restore them and
point `SETUP.md` at skills.sh. `npx skills list` now reports them as
`Source: heygen-com/hyperframes`, project-scoped.

**Done.** The 19 global symlinks into PhotoQuest were removed after its long-running Pi session
stopped. PhotoQuest retains its project-scoped copies, taking this repository's skill index from 57
skills / 2,821 words to 38 / 1,483.

The pattern worth repeating: a skill belongs to the repository that uses it, installed with
`skills add -s <name>` (project-scoped by default), never globally.

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

## Two ways to scope a skill, in order of preference

1. **Vendor it into the repository that uses it.** Then no configuration is needed anywhere, a fresh
   checkout works, and no other project pays for it. This is what PhotoQuest now does.
2. **Exclude it in settings.** Pi supports `!` negation globs in the `skills` array of
   `~/.pi/agent/settings.json`, and per-project additions through a project `.pi/settings.json`.
   Neither is documented in `docs/skills.md`, but the global settings file already uses the first.

**No extension is needed to choose which skills a project loads.** Prefer vendoring, then settings;
never move files around by hand, which is what the first attempt here did.

### Global configuration cleanup

**Done.** The 18 paths for the deleted `PhotoQuest.pi-marketing-autopilot-v1` worktree and the dead
video-skill negation glob were removed from `~/.pi/agent/settings.json`.

## The remaining technical unknown

**Can an extension remove context that settings cannot reach** — prompt guidelines, tool
descriptions, and `AGENTS.md` content — or only add to it?

`event.systemPromptOptions` is documented as mutable and exposes `.skills`, `.selectedTools`,
`.promptGuidelines`, and `.contextFiles`. But `before_agent_start` runs *after* the prompt is built,
so changing it there may do nothing. Settings already cover skills; this probe matters for
everything else.

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
