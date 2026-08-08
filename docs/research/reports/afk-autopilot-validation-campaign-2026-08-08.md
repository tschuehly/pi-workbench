# Disposable AFK autopilot validation campaign — 2026-08-08

**Status:** Complete disposable validation evidence; production authority remains unchanged.

Related evidence:

- [failed production AFK run](afk-autopilot-production-failure-2026-08-08.md)
- [failed-run session ledger](afk-autopilot-session-ledger.md)

## Outcome

The disposable Pi Marketing Studio campaign passed. All four 2×2 matrix arms reached the same successful smoke result without production authority. The two fixed-AFK arms each completed two checkpoint/compaction/continuation cycles, finalized one immutable `succeeded` receipt, and called `goal_complete` exactly once. A separate attention fixture finalized an immutable `attention` receipt, paused its Goal, and never called `goal_complete`.

The deterministic supervisor declared the campaign settled at `2026-08-08 10:11:04 CEST`, before the `11:00 CEST` deadline. All trial, repair, and supervisor `tmux` sessions were then stopped. No campaign Pi or guarded-runtime process remained live.

This result validates the completion gate for disposable smoke work. It does **not** authorize a production launch, resolve the real production attempt's consumption state, accept a Candidate, mutate production Review Studio, sync or deliver an artifact, or publish anything.

## Matrix results

Every arm received the same direct-controller plan and executed exactly one command of this shape:

```text
node docs/business/marketing/studio/tools/autopilot-workflow.mjs start --mode smoke --run-id <unique-run-id>
```

The controller's successful workflow terminal is named `candidate`; all executed stages and the guarded render were `completed`, visual adjudication was `pass`, and correction was skipped. Here, `candidate` is a smoke-controller state, not a production Candidate or human acceptance.

| Arm | Source branch | Goal executor | Run ID | Goal terminal | Protocol evidence | Evidence commits | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `op` | original | plain Pi Goal | `afkval-op-20260808` | `complete` | no AFK checkpoints; one `goal_complete` | `b8007446c`, `a7eb99dc2` | PASS |
| `oa` | original | fixed AFK Goal | `afkval-oa-20260808` | `complete` | 2 checkpoints, 2 compactions, 1 finalization, 1 `goal_complete` | `09be257ed`, `1b4ee6cc9` | PASS |
| `np` | AFK experiment | plain Pi Goal | `afkval-np-20260808` | `complete` | no AFK checkpoints; one `goal_complete` | `a7d8473a6`, `014023d7f` | PASS |
| `na` | AFK experiment | fixed AFK Goal | `afkval-na-20260808` | `complete` | 2 checkpoints, 2 compactions, 1 finalization, 1 `goal_complete` | `781c2f4cc`, `565879144` | PASS |

The original-branch arms began at trial adaptation `2a980bab8`; the AFK-experiment arms began at runtime-fix commit `88cd88dab`. The three changed runtime files are byte-identical at those trial bases. Each arm used a separate Git branch, worktree, run root, runtime namespace, Pi session directory, `tmux` session, and Terminal window. Every lead ran `openai-codex/gpt-5.6-sol` at high effort with no token-spend, cost, or automatic-turn limit.

Each smoke produced the same admitted MP4 SHA-256, `f5ed36065a6ff8b8466af2b4316400334e4ca6daa0490399fc9a4fd214f92722`. Independent checks found H.264, 1080×1920, 30 fps, 1 second, successful full decode, no live descendants, and no orphan PID. Each workflow had stages 01–06 and 08 completed once, stage 07 skipped, zero correction rounds, and no failure.

The small matrix supports a functional conclusion, not a performance ranking. AFK protocol overhead is visible in its extra checkpoints, compactions, continuations, and judgments. Both AFK leads recorded higher cost than their same-branch plain counterparts. Cache-inclusive token traffic did not move in lockstep with cost: `na/AFK` used fewer recorded tokens than `np/plain` while costing more.

## Completion-gate hardening

The AFK extension fix is committed in `skill-incubator` as:

```text
f74543bfd2883218cf6b0a1d319fb8c038df72f4  Gate AFK Goal completion on durable outcomes
```

The extension now persists branch-local ownership and immutable receipts in the Pi session, reconciles state after reload, validates the exact current Goal ID, supports queued Goal activation, pauses non-success outcomes deterministically, cancels only after settlement, fails closed on malformed state, enforces a bounded managed-start timeout, and verifies that the evidence commit is a clean descendant of the recorded run base. Killed or aborted Git verification cannot satisfy the gate.

Verification passed:

- core extension tests: 24/24;
- strict TypeScript typecheck against the installed Pi/typebox/Node declarations;
- registration smoke: 2 tools, 2 commands, and 6 lifecycle handlers;
- `git diff --check`;
- independent Anthropic Claude Opus 5 review at high effort: `NO BLOCKERS`.

Commands, logs, dependency-resolution limits, and the retained review result are recorded in `.scratch/afk-validation-20260808T0850CEST/afk-extension-verification.json` and its referenced artifacts.

Pi was `0.84.1`; pi-goal was `0.49.6`. Both post-fix AFK arms loaded the committed extension before launch.

## Required lifecycle fixtures

### Attention cannot become success

The isolated `attention` fixture began at `88cd88dab`, committed only `docs/dev/afk-validation/attention/terminal-fixture.json` as `82fc5baf17`, and finalized outcome `attention`. Its Goal terminal is `paused`; it has one finalization and zero `goal_complete` calls. The immutable receipt records the missing human-owned token and two fresh stop judgments. No controller or workflow was launched.

### Dead-running reconciliation

All matrix arms ran the focused Node suite containing the dead-running fixture. The suite passed 6/6 and proved a stale `running` stage with a dead process is reconciled to `interrupted`, rather than remaining falsely active. The direct smoke terminals also proved their launcher and child PIDs dead with no orphans.

### Checkpoint, compaction, continuation, and finalization

Both AFK smoke arms recorded this sequence twice:

```text
afk_phase_checkpoint → agent_settled → ctx.compact → pi-goal continuation
```

Each arm then called `afk_outcome_finalize` in a separate turn, received an immutable `succeeded` receipt bound to its final evidence commit, continued once more, and called `goal_complete` exactly once.

### Malformed invocation rejects before reservation

Every matrix arm reproduced an outer-controller shape that previously reserved a namespace before rejecting. With the fix, it exited 1 with typed `preflight-error: command-policy:` and left the run root, namespace, and terminal absent.

The canonical PhotoQuest runtime fix is:

```text
88cd88dab30ef7b32e0fbdb40c32a6cd66aff8fe  Validate studio launches before reservation
```

Focused verification passed 21 Python tests and 6 Node controller tests. A pre-campaign broad Studio run, recorded in the AFK experiment's preflight evidence, exposed 17 pre-existing failures caused by the missing fixture `concepts/21-gift-off-season/review-frames/beat2_+0.3s_t7.20.png`; those failures do not exercise the changed launcher path.

## Incident and repair ledger

The zero-model supervisor polled files, Git, processes, and session JSONL every 10 seconds. It emitted transition-only events and made no steady-state model calls. Its terminal ledger contains `campaign-settled` with five terminal fixtures and a repair receipt, followed by `supervisor-stop`. Five supervisor processes were started while launch and settlement mechanics were corrected. Only the fifth source revision is retained; all five start records declare `modelPolling: false`, but the first four implementations cannot be independently re-executed.

The following table covers the material and notable incidents; `incidents/` is authoritative for the complete retained set.

| Incident | Material | Handling | Terminal evidence |
| --- | --- | --- | --- |
| Seeded pre-reservation defect | yes | Reproduced at base `4f38901ae`; a bounded Pi repaired it in a separate worktree; an independent cross-family review requested one high fix, which was resolved before commit; only a fresh successor namespace received the repair | commit `b84ca5f2a`; receipt `receipts/seeded-pre-reservation-repair.json`; successor run root, namespace, and terminal all absent |
| JSON mode handled slash commands but exited before Goal kickoff | no, launcher mechanics | Initial disposable sessions were abandoned; successors were launched in interactive TUI mode | `incidents/json-mode-no-kickoff.json` |
| First repair dispatch ran inside the supervisor process | no, launcher mechanics | Incorrect process was stopped before worktree mutation; successor supervisor launched repair in its own `tmux`/Terminal | `incidents/supervisor-repair-dispatch.json` |
| Supervisor restarted five times | no, observer mechanics | Final revision observed the terminal campaign; earlier source revisions were not retained | `incidents/supervisor-revision-restarts.json`, `ledger/events.jsonl` |
| Prompt submitted during second compaction in `na` and `oa` | no, self-recovered | No hot patch or duplicate phase; each compaction completed and continuation resumed automatically | `incidents/na-compaction-prompt-race.json`, `incidents/oa-compaction-prompt-race.json` |

The last incident is a real coordinator race worth repairing before relying on AFK execution for production: the TUI briefly reported `Cannot submit a prompt while compaction is in progress`. The text was observed in the live TUI but is absent from the session JSONL and supervisor ledger; corrected incident timestamps fall between each second checkpoint and compaction record. Recovery succeeded in both occurrences, so it did not invalidate this campaign.

No active run was hot-patched. Repair commit `b84ca5f2a` remained in the repair branch, and no matrix arm contains it. The repair branch emits a structured `pi-studio-launch-rejection/v1` launcher error; the canonical matrix fix `88cd88dab` emits the typed `preflight-error: command-policy:` line. Both reject before reservation, but their rejection envelopes did not converge.

## Usage and model routing

Campaign-session accounting covers six lead sessions (`op`, `oa`, `np`, `na`, `attention`, and `repair`) plus their captured judgment/review children. Smoke controller stages and the deterministic supervisor made no model calls.

| Scope | Sessions or executions | Cache-inclusive tokens | Recorded cost |
| --- | ---: | ---: | ---: |
| Pi lead sessions | 6 | 12,695,634 | $15.066904 |
| Judgment/review child executions | 12 | 1,731,278 | $2.049639 |
| **Total** | 18 | **14,426,912** | **$17.116543** |

These are captured-usage totals, not a billing guarantee: three child execution results contain no usage observations, so the child and overall rows are lower bounds. Pi's cache-inclusive token field is not newly billed input.

Child routing used fresh quota throughout: five `openai-codex/gpt-5.6-sol` judgments at xhigh effort, six independent `anthropic/claude-opus-5` reviews at high effort, and one `anthropic/claude-fable-5` judgment at high effort. `usage-child-detail.json` records each execution ID, source session JSONL and line, usage-event count, tokens, and cost so these aggregates can be reproduced. Consequential OpenAI-authored changes received Anthropic review. No routing launch failed and no stale/degraded quota evidence was used.

Between the saved midpoint and final quota snapshots, Claude remained at 87% for the five-hour window and 45% for the seven-day window; Codex weekly remaining moved from 45% to 44%. Provider percentages are coarse and should not be used to derive per-run billing. The totals above exclude this attended parent session's implementation and campaign-coordination traffic.

## Commits

| Repository or branch | Commit | Purpose |
| --- | --- | --- |
| Pi Workbench | `3852cef` | Record the failed overnight run and observer evidence |
| `skill-incubator` | `f74543b` | Durable AFK outcome gate and lifecycle reconciliation |
| PhotoQuest AFK experiment | `88cd88dab` | Validate all static launch inputs before reservation |
| Original-branch trial base | `2a980bab8` | Apply the same validated preflight to the original trial baseline |
| `op` | `b8007446c`, `a7eb99dc2` | Preflight and terminal smoke evidence |
| `oa` | `09be257ed`, `1b4ee6cc9` | Preflight and terminal smoke evidence |
| `np` | `a7d8473a6`, `014023d7f` | Preflight and terminal smoke evidence |
| `na` | `781c2f4cc`, `565879144` | Preflight and terminal smoke evidence |
| attention fixture | `82fc5baf17` | Immutable attention evidence |
| repair branch | `b84ca5f2a` | Independently reviewed successor-only repair |

## Protected-state audit

The final audit found every trial and repair worktree clean. No trial created production output or a production Review Studio path. Each smoke's curation remained inside its ignored run-local `smoke-review` store. No production workflow was started or resumed; no production attempt ID was reused; no canonical routing, delivery, or publication receipt changed; and no accept, sync, deliver, or publish command ran.

The primary PhotoQuest AFK worktree remains at `88cd88dab` with exactly the pre-existing unstaged file `.agents/skills/embedded-captions/SKILL.md`. Its SHA-256 remains `f89194503cf864d20830011b77c59c799ceef24a1ff72e7dff3c2a8eadfddc16`. It was never staged or committed.

Ignored machine-local campaign evidence is under `.scratch/afk-validation-20260808T0850CEST/`; it is not repository state. Key machine-readable files are `campaign-summary.json`, `usage-summary.json`, `usage-child-detail.json`, `final-audit.json`, `teardown.json`, `ledger/events.jsonl`, the `incidents/` directory, and `receipts/seeded-pre-reservation-repair.json`. The teardown receipt confirms zero `afkval-*` tmux sessions and zero matching campaign processes after settlement.

## Exact attended next action

Do not launch production yet. In an attended session, the returning human should:

1. rule whether real attempt `v1-24-dynamic-attempt-02` is consumed or reusable from the authoritative production ledger;
2. choose whether to require a bounded fix and disposable rerun for the reproducible compaction prompt race before any production AFK use; and
3. only after those two decisions, explicitly authorize either a direct attended production controller launch with a fresh approved attempt ID or a separately reviewed production AFK plan.

Until that attended ruling, leave the real canary, production Review Studio, canonical routing, acceptance, delivery, and publication unchanged.
