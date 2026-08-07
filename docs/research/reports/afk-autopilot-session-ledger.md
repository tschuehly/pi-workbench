# Ledger — AFK autopilot session observation

Read-only analysis of one recorded Pi session. No files in the observed worktree were touched.

## Source

- Source: machine-local Pi session record; identifier and storage path intentionally omitted
- Started: 2026-08-06T20:53:37Z in an isolated PhotoQuest experiment worktree
- Model: `anthropic/claude-opus-4-8`, thinking level `medium`
- Size: 15 JSONL records (1 session + 2 config + 12 message records), ~44 KB, last event 20:54:55Z (~78 s of activity)

## Timeline (what actually happened)

| # | Role | Event |
| --- | --- | --- |
| 4 | user | Kickoff = the **`afk-plan-compaction` prompt verbatim**, args `Execute docs/dev/2026-08-06-22-40_plan-full-autopilot-studio-test.md` |
| 5 | assistant | `read` the plan file |
| 6 | toolResult | Plan returned (experiment plan, 6 phases, HIGH risk) |
| 7 | assistant | 2× `bash`: git status/branch/worktree + scratch dir listing |
| 8–9 | toolResult | On branch `experiment/pi-autopilot-concept-33`; `video-pipeline.pi.mjs` not at repo root |
| 10 | assistant | 2× `read`: `HANDOFF.md`, `EXPERIMENT-REPORT.md` |
| 11–12 | toolResult | Prior experiment handoff + full report returned |
| 13 | assistant | thinking (notes cost/complexity/dependencies) + 2× `bash`: locate `*.pi.mjs`, studio/out dirs, vendor, launcher, git log |
| 14–15 | toolResult | Found pipeline under `.scratch/…`, rendered mp4s present, launcher present, git log |

**The session ends here — right after reconnaissance, before Phase 0 began.** No planning conclusion, no edits, no pipeline launch, no commit, no compaction. The last assistant turn produced tool calls; there is no following assistant turn consuming results 14/15. The run was stopped/abandoned during orientation.

## Findings

### F1 — This is the AFK prompt executing in the field
Msg 4 is the exact text of `prompts/afk-plan-compaction.md`. So this session is direct field evidence of that prompt driving a real, HIGH-risk autopilot plan. Useful signal for whether the prompt's framing holds up.

### F2 — Target plan is HIGH risk and explicitly gated
`2026-08-06-22-40_plan-full-autopilot-studio-test.md`: P2 research, effort L, **Risk HIGH**. It exercises delivery/publish lanes touching OneDrive + live channels. Locked decisions: **no cost ceiling** (model spend authorized, only a quota floor), **delivery to a TEST dest only** (real OneDrive/publish out of scope for the whole plan), concept selection via S0 backlog. 6 phases (0–5), each with a go/no-go gate and STOP conditions.

### F3 — Prompt/plan authority tension (the important one)
The `afk-plan-compaction` prompt says "proceed through all phases without stopping for confirmation." The plan says "do not advance until the gate passes… nothing is delivered, published, or signed off without an explicit human instruction naming the phase," and Phase 3 keeps "the human as the actual approver." These are reconcilable — the plan's human gates are exactly the "ambiguity/authority/approval" blockers the AFK prompt tells the agent to stop for — **but only if the executor treats the plan's gates as hard STOPs over the prompt's "don't pause" default.** This is the single biggest risk the prompt+plan combination creates and worth a doc note.

### F4 — Known blocker sits at Phase 0
Both HANDOFF and REPORT record the one real defect: the `build-fix-r1` render **STALLED** (pi at 0% CPU, no completion). Run `…mshpoh95` is left paused and **will re-stall** unless a render/agent liveness watchdog is added first. Phase 0 exists specifically to fix this and gates everything downstream. The session ended before attempting it.

### F5 — Prior experiment context is rich and already committed
The concept-33 single-lane experiment was classified **PORTABLE WITH ADAPTATION**; proved routing, structured output, live vision, blind dual-arm frame review, the human-ratification (S1-LOCK) gate, SIGKILL interruption + journaled $0 cache-replay resume. Rendered candidate `out/33-best-tip-for-wedding-final.mp4` (1080×1920, 21.8s, 15 MB) is human-accepted, calm-only. Spend so far: Run 1 $10.05, Run 2 $54.22; quota at close five_hour 87% / seven_day 75% remaining.

### F6 — Clean-tree invariant already broken (documented, uncommitted)
Build agents autonomously patched 3 studio tools for the hardened sandbox (Puppeteer `pipe:true`; ffmpeg `stdio:'pipe'`) — in-worktree, uncommitted. Recorded as the strongest "portable with adaptation" signal but an open decision (upstream vs revert). Also `.review-tmp/` is an untracked dir in the worktree.

### F7 — Isolation held
Work is confined to the `PhotoQuest.pi-autopilot-concept-33` git worktree; the primary `PhotoQuest` checkout is documented as untouched. Seatbelt sandbox, cred scrub, and `guardExperimentTool` (blocks publish/deploy/onedrive/HIGH-lane) are the reused safety scaffolding. No publish/deliver/sign-off occurred in the prior experiment.

### F8 — No compaction observed
The AFK prompt's headline mechanism (`compact_and_continue`) never fired — the session was far too short (78 s, ~44 KB) and ended during orientation. So this transcript yields **zero evidence about compaction behavior**; it only exercises the prompt's "before implementation" reconnaissance stage.

### F9 — Model/thinking binding
Lead ran on `claude-opus-4-8` at thinking `medium`. Reconnaissance was efficient: 3 assistant turns, 6 tool calls, batched in parallel (2+2+2), before stopping.

## Assessment

The session is an **incomplete AFK run**: it faithfully executed the prompt's pre-implementation steps (identify plan → read plan → verify repo state → gather authority/evidence) and then stopped before Phase 0. There is no failure signature in the transcript itself — it simply ends. Whether this was an intentional human stop, a crash, or a handoff is not determinable from the file alone (last record is a normal toolResult, no error).

## Open questions

1. Why did the run stop after reconnaissance? (human interrupt vs. crash vs. deliberate pause — not in the transcript)
2. Will the executor honor the plan's human gates (F3) over the prompt's "don't pause" default when it reaches Phase 3/delivery?
3. Was Phase 0's liveness watchdog ever built? (prerequisite for any resume of `…mshpoh95`)

## Provenance

Analysis derived only from the machine-local Pi session record, read via a local parser. Its identifier and storage path are intentionally omitted. No web sources. No mutations to the observed worktree or its repository.
