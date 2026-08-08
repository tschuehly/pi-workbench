# AFK compaction repair and production attempt 03 — 2026-08-08

**Status:** Compaction race fixed and post-fix matrix passed. The real production attempt ran but failed before producing marketing content. No further production attempt is authorized.

Related: [the preceding disposable AFK campaign](afk-autopilot-validation-campaign-2026-08-08.md).

## Outcome

Two operations ran concurrently in separate worktrees. Isolation is evidenced by per-arm write scoping and controller launch-window snapshots:

1. The real Pi Marketing Studio controller started once in production mode as `v1-24-dynamic-attempt-03`. It failed terminally in Asset Scout after the watchdog observed no output or CPU progress for 900 seconds.
2. The AFK checkpoint extension was repaired and validated with a fresh disposable 2×2 smoke matrix plus one attention fixture. Five checkpoint/compaction/continuation transitions—four in the matrix and one in the fixture—completed without the prior prompt-during-compaction error.

The production failure is independent of the AFK compaction defect because production attempt 03 used the direct controller, not the AFK wrapper.

## Real production attempt 03

The user chose a new attempt, retiring attempt 02 after its failed pre-spawn outer launch. The controller started directly from an isolated worktree at tested runtime commit `88cd88dab`:

```text
node docs/business/marketing/studio/tools/autopilot-workflow.mjs start --mode production --run-id v1-24-dynamic-attempt-03
```

Before launch, attended checks in the isolated worktree passed 21 Python tests, 6 Node controller tests, tool availability, credential-store presence, model discovery, frozen hashes, and protected-state snapshots. Those checks remain attended scratch evidence, not committed production evidence. The controller's separate `01 Preflight` stage then validated the frozen packet hashes and one-Candidate route in under one second.

The workflow reached:

| Stage | Terminal |
| --- | --- |
| 01 Preflight | completed, one attempt |
| 02 Asset Scout | failed, one attempt |
| 03–08 | pending, zero attempts |

Asset Scout performed about 34 seconds of startup activity and then emitted no Pi JSON output or CPU progress for the full 900-second watchdog window. The watchdog terminated it with `return_code: -15`; `orphan_pids` is empty. This is the fourth identical Asset Scout progress timeout: attempt 01 recorded three stage-attempt timeouts.

A post-failure Claude Sonnet availability probe returned `AVAILABLE` in 5.4 seconds. That probe did not use the production seatbelt, isolated HOME, autopilot guard, full tool set, or frozen stage packet, so it proves only that provider exhaustion was not established. The guarded-startup cause remains unresolved.

No production source, MP4, Review Submission, acceptance, routing change, delivery, or publication was created. Preflight created only an empty Review-store directory scaffold. Attempt 03 is consumed and must not be resumed. Attempt 04 is not authorized.

Durable evidence and corrected current instructions are committed on `run/pi-marketing-autopilot-v1-attempt-03` as:

```text
0e50188b5  Record attempt 03 Asset Scout timeout
```

The terminal report is `docs/business/marketing/studio/autopilot-v1/production-attempts/v1-24-dynamic-attempt-03/terminal-report.json` in that branch. Fresh Anthropic review returned `NO BLOCKERS` after reproducing hashes, timing, protected state, timeout history, and authority limits.

## Compaction race repair

The defect was confirmed in Pi's public extension lifecycle:

1. AFK's `agent_settled` handler started callback-based compaction.
2. The handler returned before compaction completed.
3. Pi awaited the next extension handler, where pi-goal submitted its continuation during the open compaction window.

The fix keeps AFK's lifecycle handler pending until compaction completes, errors, throws synchronously, or the session disposes. Disposal releases the waiter and suppresses stale callbacks. The implementation also pins the sequential lifecycle behavior in tests and documents the required top-level-extension-before-package load order.

Commits in `skill-incubator`:

```text
c159a8e  fix: await AFK compaction before goal continuation
a6c0171  Harden AFK compaction lifecycle settlement
```

Attended verification passed 27/27 core tests, five repeated suite runs, strict TypeScript, extension registration smoke, and mutation checks with two disclosed undetected mutants. Independent Claude Opus review returned `NO BLOCKERS`.

## Post-fix matrix

The four 2×2 arms ran the same direct-controller smoke plan with separate run IDs. `attention2` ran a separate attention-fixture plan with no controller or run ID. All five used separate branches, worktrees, session directories, `tmux` sessions, and Terminal windows. Executor comparison is controlled only within each base; the original and AFK bases diverge and are not a controlled performance factor.

| Arm | Branch factor | Executor | Goal | Checkpoints / compactions | Finalization / completion | TUI race errors | Workflow |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| `op2` | original | plain Goal | complete | 0 / 0 | 0 / 1 | 0 | candidate/PASS |
| `oa2` | original | fixed AFK | complete | 2 / 2 | 1 / 1 | 0 | candidate/PASS |
| `np2` | AFK branch | plain Goal | complete | 0 / 0 | 0 / 1 | 0 | candidate/PASS |
| `na2` | AFK branch | fixed AFK | complete | 2 / 2 | 1 / 1 | 0 | candidate/PASS |
| `attention2` | AFK branch | fixed AFK | paused | 1 / 1 | 1 / 0 | 0 | no controller |

Direct session JSONL proves each checkpoint was followed by compaction and only then by the continuation prompt. Full `tmux pipe-pane` capture contains zero occurrences of `Cannot submit a prompt while compaction is in progress`, including after ANSI stripping and whitespace normalization. No equivalent failed tool or runtime error was recorded. This absence proof combines rendered pane bytes with session JSONL; an error emitted to neither channel would remain invisible.

All five worktrees are clean. Matrix evidence commits are:

- `op2`: `193d25c854`, `adad47e895`
- `oa2`: `ceb435c0aa`, `0fe686a4bf`
- `np2`: `034130e97b`, `ef64184779`
- `na2`: `400a0c8686`, `ac6d705ddf`
- `attention2`: `50f5da5b7e`

The deterministic supervisor made no model calls and settled all five arms at `12:54:00 CEST`. Summed across the five arm lead sessions, captured usage was 13,163,272 cache-inclusive tokens and $15.162806. Child subagent usage and the attended parent session are excluded, so this is a lower bound. Independent review returned `NO BLOCKERS`, with the limitation that five successful transitions are smoke-scale evidence rather than a statistical race test.

Machine-local matrix evidence is retained under `.scratch/afk-race-validation-20260808T1200CEST/` and is not repository state.

## Next attended decision

Do not authorize attempt 04 yet. First reproduce and isolate the guarded Asset Scout startup hang outside a production namespace, comparing the failed seatbelt/HOME/guard environment with the successful unguarded availability probe. Only after that diagnosis and a disposable guarded successor test should the human decide whether to authorize one fresh production attempt.
