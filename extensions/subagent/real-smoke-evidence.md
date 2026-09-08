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

## Bulk collection, three children (2026-08-29)

A real interactive Pi lead on `anthropic/claude-sonnet-5` at low effort launched three background `scout` · `mechanics` children, ran two `sleep` bash turns without polling for them, and answered the signal with one argument-free `subagent_collect`.

| Observation | Evidence |
| --- | --- |
| new launch receipts | "answer it with subagent_collect, which reconciles every terminal child when called without an executionId" ×3 |
| one coalesced signal | one `[pi-workbench:child-completion]` message, delivered mid-run |
| one collection call | `subagent_collect` with no parameters returned `Reconciled 3 of 3 terminal children.` |
| nothing orphaned | the following `subagent_status`: `0 running, 0 terminal and uncollected, 3 launched this session` |
| results reached the lead | final reply `BULK_OK` followed by `BULK_CHILD_1`, `BULK_CHILD_2`, `BULK_CHILD_3` |

Three completions produced one signal, one collection call, and zero restated identifiers.

## Worker model override (2026-09-08)

A fresh Pi lead loaded `extensions/subagent/index.ts`, created one temporary `scout` Worker, and dispatched it in the foreground with Cognitive Role `mechanics` plus `modelOverride: "openai-codex/gpt-6-astra"`. Routing retained the role's `low` effort and fresh quota admission. The adapter verified the runtime binding before prompting, and the Worker returned:

```text
openai-codex/gpt-6-astra:low
ASTRA_WORKER_OVERRIDE_OK

Completion receipt: openai-codex/gpt-6-astra:low · worker · scout · mechanics · outcome success
```

The lead then retired the Worker. The machine-local worker and session identifiers are intentionally not recorded here.

## Deterministic coverage

Extension tests additionally cover coalescing a 23-completion fan-out into one signal with 22 suppressed returns, re-arming only on the delivered normal marker or `agent_settled`, checkpoint deferral releasing one signal under a stable key, per-execution `outcome_unknown` receipt-failure attention staying outside coalescing, detached-collection re-arming, and cancellation and shutdown suppression.
