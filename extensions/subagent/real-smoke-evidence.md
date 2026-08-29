# Background completion signal smoke evidence

Date: 2026-08-11; re-run for coalesced steering on 2026-08-29.

## Idle lead, one child (2026-08-11)

A real Pi RPC lead loaded `extensions/subagent/index.ts`, used `openai-codex/gpt-5.4-mini` at low effort, and launched one `mechanics` Subagent with `background: true`. A repeat smoke asked it to follow registered tool guidance without naming the execution posture; the lead still selected `background: true`. Runtime routing selected `anthropic/claude-haiku-4-5-20251001` at low effort for the child.

The first lead turn returned `LAUNCHED` without collecting. After the child reached terminal `success`, the session received exactly one `pi-workbench:child-completion` custom message. That message triggered a second lead turn, which called `subagent_collect` exactly once, received the child sentinel, and returned `RECONCILED_WAKE_SMOKE_OK`. The smoke observed one launch, one completion message, one collection, no extension error, and no remaining parent or child process.

## Busy lead, three children (2026-08-29)

A real Pi RPC lead on `anthropic/claude-sonnet-5` at low effort launched three background `scout` · `mechanics` children in one tool batch, then ran three separate `sleep 25` bash turns before reconciling.

| Time (UTC) | Observation |
| --- | --- |
| 07:13:14.656–.668 | three `execution.launched` |
| 07:13:16.573 | lead enters its first `sleep 25` bash call |
| 07:13:17.256–.747 | all three `execution.settled success`; the first sends the signal, the other two are suppressed |
| 07:13:41.592 | one `pi-workbench:child-completion` message with details `{"attention":"terminal-results"}` delivered at the tool-batch boundary, mid-run |
| 07:13:45–07:14:11 | the lead continues `sleep 25` steps 2 and 3 without a stale wake |
| 07:14:39.089 | one `subagent_status` call: `0 running, 3 terminal and uncollected, 3 launched this session` |
| 07:14:42.266–.267 | `subagent_collect` exactly once per child |
| 07:14:43.816 | `RECONCILED_STEER_SMOKE_OK`, then `agent_settled` with no further completion message |

Three completions produced one delivered signal, one status snapshot, three collections, and no post-collection or post-settle wake.

## Deterministic coverage

Extension tests additionally cover coalescing a 23-completion fan-out into one signal with 22 suppressed returns, re-arming only on the delivered normal marker or `agent_settled`, checkpoint deferral releasing one signal under a stable key, per-execution `outcome_unknown` receipt-failure attention staying outside coalescing, detached-collection re-arming, and cancellation and shutdown suppression.
