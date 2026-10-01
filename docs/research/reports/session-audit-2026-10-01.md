# Session audit 2026-10-01: combined recommendations

Private source: `~/.pi-workbench/reports/session-audit-20261001/` (per-session reports, syntheses, judge verdicts). Session IDs are prefixes resolvable with `tools/session-logs/cli.py read <id>`.

Scope: 242 lead sessions with two or more user messages, 2026-09-01 to 2026-10-01. One Sonnet 5.5 auditor per session ([INDEX.md](INDEX.md)), four Opus project syntheses (`*/_SYNTHESIS.md`, `_other_SYNTHESIS.md`), then two independent adversarial judges, Fable ([_JUDGE_fable.md](_JUDGE_fable.md)) and Astra ([_JUDGE_astra.md](_JUDGE_astra.md)), each verifying cited log lines against current code.

## Read the raw counts with care
Both judges found that the raw counts (1,182 findings; "~113 /tmp sessions") overstate current problems:
- About 300 findings blame rules that did not exist yet: the global `/tmp` rule dates from 10-01, `PI_TMP` from 09-29, `.installed` from 09-25, and the five-role enum from 09-25.
- Many problems are already fixed: non-blocking collect, completion-notice wording, the model shown in launch receipts, background-by-default bash, dev-checkout paths, and write-for-humans re-reads (which only OpenAI leads did, and which stopped after 09-25).
- The sample is contaminated. Some "lead" sessions are delegated coordinators (for example `2926ae5e`, `5708464c`). One incident was counted twice because it was pasted into a second session. Some reports cite line offsets in the exported text, not raw JSONL lines (Astra).

## Where both judges agree (do these)
| # | Change | Type | Evidence |
|---|---|---|---|
| 1 | **Make the goal stop on Thomas's "stop".** Add a model-callable `goal_pause` to pi-goal (Astra), or a small hook that pauses on short stop messages (Fable). Also decide whether `automaticTurns: null` (unlimited) in `~/.pi/agent/pi-goal.json` should be finite; the package default is 25. | code + config | 01a0d26d L1963–2020 (131 continuations after "Lets stop here"); 01a0c8dc L4053 |
| 2 | **Workstreams skill: paste-ready records.** Add one stdin `append - <<'JSON'` example covering `checkpoint.replaced` (with `payload.sessionId`) and `link.upsert` (`reference`, not `target`), plus field limits. Make `workstreams.mjs <op> --help` work; today it fails with "Input is not valid JSON". Remove the instruction that makes a read-only status question write an overview. | skill + code | 01a0c440 L145, 01a0a927 L57, 01a0f279 L62, 01a0f26a L110–122 (still failing on 10-01), 01a0af95 L906 |
| 3 | **Role drift and blind preflight errors.** `skills/orient/SKILL.md:24` still says `investigation` (a retired role). `CAPABILITY_EXCEEDED` in `packages/pi-execution-adapter/src/index.js:500` should name the missing tools. Add a static check that profiles fit the adapter. | skill + code | 01a0d7a3 L144–150 (8 blind retries), 01a0d78f |
| 4 | **Guard `/tmp` in code, not prose**, but do **not** set `TMPDIR=$PI_TMP`: an 84-character path breaks Unix sockets (01a0f6c5). Fable: a `tool_call` hook in `extensions/pi-tmp` that blocks write/edit under `/tmp` and warns in bash. Astra: `workstream-store` should also reject `PI_TMP` paths as durable references, because PI_TMP gets swept. | code | 01a0c8e8 L4 (Chat launch broken by a `/private/tmp` worktree), 01a0e730 L26, 01a0dc97 L331 |
| 5 | **Promotion needs trial evidence for the exact revision** (or an owner waiver) in `scripts/promote-installed` switch commands. Fable rates this low confidence because a flag can be gamed; Astra wants a receipt tied to the revision. | code | 01a0ebf7 L104–109, 01a0ed13 L105–150 |
| 6 | **Serialize heavy gates** in embabel/me `scripts/ci/gate.sh` with a machine-wide lock keyed by the git common directory. Use a macOS-safe lock, not `flock`. Per-session background-bash limits miss child processes. | code (embabel/me) | 01a0d86c L6–16, 01a0d818 L199 (load 40–138) |
| 7 | **Visual "done" claims.** The Atelier skill says the visual pass must not be delegated, but global AGENTS.md says to delegate visual inspection. Resolve that conflict. Preflight PASS should read "render checks passed; visual judgment pending"; otherwise report "unverified". | skill | 01a08610 L1524, 01a0f270 L100–106, 01a0ed2b L512 |
| 8 | **No new AGENTS.md prose** for message style, alignment, nicknames, skill locations or `.installed`: it is already in global AGENTS.md, Working Mode or tool descriptions. The only exception is the secret-output bullet in row 10 below. | delete-guidance | both judges |

## Only one judge found it (verified; worth doing)
| # | Change | From | Evidence |
|---|---|---|---|
| 9 | **`ask_human` silently caps every wait at 10 minutes**: `ping-a-human-pi/extension/index.ts:78` sets `REQUEST_TIMEOUT_MS = 600_000`. Patch it to `max(timeoutMs, 600_000)`, or state the cap in Working Mode's Phone text. | Fable | 01a0758d L1546–1548, 01a0cd59 L1283 (both time out at exactly +10:00) |
| 10 | **Secret output.** Fable: redact token-shaped output in a background-bash `tool_result` hook. Astra: no regex redactor (false sense of safety); one AGENTS.md bullet instead ("never print secret values or credential-file bodies"), and model discovery via `pi --list-models`, not dumping `auth.json`. **Disagreement.** Recommendation: the AGENTS.md bullet now; a redactor only as defense in depth, never described as a guarantee. | both, differently | 01a08a51 L32–33, 01a0c41e L17 |
| 11 | **Keep child receipts across extension reload** (in-session only, no resurrection). | Astra | 01a0d86c L244–255, 01a0d8e3 L41–72 |
| 12 | **background-bash wording.** The launch result should say "end the turn; completion arrives", and `bash_status` should be described as diagnostic only, never for polling. | Fable | 01a0ee41 L171–185, 01a0ed22 (71 calls) |
| 13 | **gh-stack skill: one line**: "Never `git rebase --onto` a stacked branch; use `gh stack rebase`." | Fable | 01a0e72e (14× `--onto`), 01a0c2da |
| 14 | **Duplicate `/orient` launches in PI WEB.** In 5 of 45 sessions the same message arrives 40–65 s later. Fable calls it a launcher bug; Astra says duplicate messages alone don't prove a double submit. **Diagnose first.** | Fable (disputed) | 01a0d7f6 L5/L12, 01a0ec85, 01a0d76d |
| 15 | **Session-logs CLI:** `list --match` for searching across sessions (Fable). Classify sessions with a `parentSession` as children, and validate cited lines (Astra), so the next audit is cleaner. | both | 01a0c9b8, 2926ae5e |

## Rejected by both judges
- AFK phone notifications, approval for every checkpoint write, a one-round cap on reviews, TTL deletion of worktrees, truncating `compact_and_continue` input, and more message-style guidance.
- The "disk sweeper never built" claim: `pi-disk-sweep.sh` runs weekly.
- The "invalid roles accepted silently" claim: the roles were valid at the time, and the enum is enforced now.

## Security
Owner-action items (exposed credentials, one public-repository exposure) are kept in the private report only.
