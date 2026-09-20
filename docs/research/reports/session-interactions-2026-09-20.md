# Session interactions, 2026-09-13 to 2026-09-20: what "status" means

Reviewed 2026-09-20. Question: what does Thomas repeatedly ask Pi sessions for, and what is the
smallest change that makes Workstream and session re-entry easier.

## Sources

- Six `openai-codex/gpt-5.6-luna:medium` Workers reviewed 39 candidate conversation sessions
  (405 session files with in-window activity; 361 child sessions used only as supporting evidence).
  Per-session reports and the synthesis live outside Git under
  `~/.pi-workbench/reports/session-interactions-2026-09-20/` (`SUMMARY.md`, `INDEX.md`,
  `manifest.json`, `INDEPENDENT-REVIEW.md`). 364 source line/entry pairs were checked mechanically;
  a fresh `anthropic/claude-fable-5-1:low` reviewer found no blocking finding in the synthesis.
- Read-only session CLI, committed as `18b043c`: `python3 tools/session-logs/cli.py`.
- Store inspection of `ws-openapi-source-learning-20260828` on 2026-09-20 (this report's example).

Historical reports are evidence, not current runtime state.

## Findings

1. "Status" means restoring context, not reporting activity: original goal, what changed, what is
   verified and by whom, what remains, the next decision, and a short continuation prompt.
2. The same need recurs inside one session after an interruption ("I'm just back from my lunch"),
   not only across sessions.
3. "What next?" is separate from permission to act. A continuation should state its scope and
   first decision before implementation.
4. Verification needs distinct labels: tests passed, Thomas checked, waiting on a maintainer.
5. Status usually turns into a short handoff. Overfilled handoffs were challenged; a reference to
   the existing plan plus the new authorization was enough.

## What already exists

- Workstream Store checkpoints carry `whatChanged`, `remains`, `next`, `nextSessionPrompt`,
  `references`; Human Tasks and links carry decisions and evidence.
- `skills/workstreams/SKILL.md` already specifies the report shape.
- `tools/workstream-dashboard/` (Workstream Atlas) renders checkpoint history and continuation
  text, but hand-codes each Workstream's purpose and state in `build-dashboard.mjs`; new Workstreams
  appear as Unreviewed. Last generated 2026-08-31.
- Workbench Chat (`../pi-web`, `apps/pi-web-macos`) knows nothing about Workstreams.

## Gaps

- **Why is not stored.** No record carries the original goal or its finish line;
  `docs/plans/workstream-goal.md` proposes `goal.set`.
- **No card where work starts.** The report exists only as chat text, which is missed.
- **Conflicting latest checkpoints.** Checkpoints are per session. On 2026-09-18 two sessions of
  `ws-openapi-source-learning-20260828` recorded different states (PR #1283 decision-ready versus
  human trial pending). A card must show both and name the conflict rather than pick one.

## Re-entry card

```text
Why       original goal and current scope (goal.set; inferred until stored)
Now       delivered result, remaining work, evidence freshness and who verified it
Decision  who must decide or check what; suggested next action
Continue  exact working directory and a short continuation prompt
```

Actions stay distinct and read-only: Explain, Refresh evidence, Show the next step, Guide a manual
check, Prepare a handoff. Preparing a prompt never starts work.

## Proposed experiment

1. Add `goal.set` with `statement` and `doneWhen`; project `currentGoal`; read it in the Atlas
   instead of the hand-coded table.
2. Set the goal on three real Workstreams and regenerate the Atlas; Thomas judges the cards.
3. If the cards work, render the same card in the Workbench Chat chooser, where Continue opens the
   session with the prompt prefilled (Slice 2a of the graphical UI plan).

## Related direction: graphical UI plan (Claude and Astra debate, 2026-09-20)

Converged, unaccepted slices, each about 300 lines, built and reviewed through Workbench Chat:

| Slice | Outcome | Mechanism |
| --- | --- | --- |
| 0 | Thomas works from Workbench Chat | nothing to build; note CLI fallbacks |
| 1a | `/mode alignment align` works in Chat; open questions survive | command arguments in `extensions/working-mode`, RPC enabled, skip ask-void for extension commands (`piSessionService.ts` prompt path) |
| 1b | Shared read channel | extension writes a disposable per-session JSON snapshot under `~/.pi-workbench/`; small read route; stale is unknown |
| 1c | Segmented mode buttons | `SessionUiControls.ts` in `WorkbenchApp.ts` |
| 2a | Resume yesterday's work | Workstream chooser and re-entry card reusing `packages/pi-web-integration/workstream-*.js` |
| 2b | Answer Human Tasks outside chat | revision-checked `human-task.answered` |
| 3 | See running and uncollected children | subagent extension state through the 1b channel |
| 4 | Modes that change behavior | one experiment after the weekly analysis reports selected versus delivered mode, commitments, missed questions, interventions, rework, and checks |

Verified while debating: Chat text beginning with `/` already reaches extension commands through
`SessionCommandService.run()` and `session.prompt()`; that path first voids any open `ask_user`
question. Commands return no payload; custom messages enter model context; client-only state
drifts because reconnect does not restart extensions.

Open owner decisions: slice order (mode-first or resume-first), whether Resume opens the existing
session or a fresh one from `nextSessionPrompt`, and whether modes stay guidance only.
