# Coalesced child-completion steering

Status: proposed.

## Outcome

Replace one queued `followUp` per terminal background child with one outstanding completion signal delivered as `steer`. The signal reaches a busy lead after its current assistant tool batch, before the next model call. It tells the lead to inspect the authoritative `subagent_status` roster and collect every terminal-uncollected child once.

A 23-child attended fan-out exposed the current defect: all children emitted one wake and were collected once, but 20 wakes arrived after collection and 12 wake cycles did no useful work. The owner also rejected waiting until the lead stops because that reacts too late. Coalescing removes the backlog; `steer` provides the required next-boundary latency.

## Smallest design

Keep the change inside the existing completion-wakeup module. Add no timer, dependency, setting, scheduler, or new module.

Normal completion attention has two states:

```text
idle -> queued -> idle
```

- On the first normal terminal completion while `idle`, keep the existing per-execution validation and deduplication, set `queued`, and send one generic custom message with `{ deliverAs: "steer", triggerTurn: true }`. Its details are `{ attention: "terminal-results" }`.
- Further normal completions while `queued` still enter the existing `handled` set, send nothing, and make `notify()` return `false`.
- On `message_start` for the exact `terminal-results` marker, return to `idle`. Later completions may then schedule the next signal.
- If `agent_settled` occurs while still `queued`, return to `idle` without sending. During explicit compaction, the barrier-held signal remains valid; another normal signal replaces it under the same stable key.

The generic message says:

> One or more background children have terminal results. Call `subagent_status` with no arguments, then call `subagent_collect` exactly once for every terminal-uncollected execution and reconcile all results. Do not retry, relaunch, publish, or accept an outcome based only on this signal.

Delivery, not a particular status or collection call, clears the signal. This keeps the interface small. The lead remains prompt-accountable for collecting every child shown by the default status roster; if it ignores that instruction and collects only some, the extension does not add a second reminder loop. A human abort can discard the outstanding signal after its children entered `handled`; those results remain discoverable through `subagent_status`, but they do not wake the lead again unless a later completion schedules another signal.

Keep active-collection suppression, cancellation, shutdown, and per-execution `handled` semantics unchanged. Keep Worker receipt-failure attention exact, separately deduplicated, and on its current delivery path; it has a different safety action and does not carry the normal attention marker.

Keep the checkpoint barrier. Key normal attention by its stable marker so a later signal replaces the held signal; retain execution-specific receipt-failure keys.

## Implementation

### 1. Add one deterministic regression

Extend `extensions/subagent/completion-wakeup.test.mjs` and `extensions/subagent/index.test.mjs` to prove:

- 23 distinct normal completions before delivery produce one `steer` message;
- the 22 suppressed notifications return `false` and remain execution-deduplicated;
- only `message_start` with the normal attention marker re-arms delivery;
- a later completion sends one new signal;
- `agent_settled` re-arms without sending;
- after an explicit re-arm, checkpoint fan-out defers and releases one stable normal signal;
- receipt-failure attention cannot clear or merge with normal attention; and
- active collection, cancellation, and shutdown retain current behavior.

Rewrite the four existing assertions that intentionally change: normal delivery uses `steer`, normal Worker attention becomes generic, settled Worker success no longer exposes per-child message details, and the checkpoint test explicitly re-arms before proving that one fan-out signal is deferred and released. Add one idempotent `rearm()` method to the existing wake module's production interface; call it for matching `message_start` and `agent_settled` events captured by the index test harness.

Completion criterion: the new regression and the four rewritten assertions fail against the current per-child `followUp` behavior for the expected reasons.

### 2. Change the existing seam

Edit:

- `extensions/subagent/completion-wakeup.mjs` — own the queued flag, generic message, marker, and idempotent re-arm operation;
- `extensions/subagent/index.ts` — re-arm for matching `message_start` and `agent_settled`, and key checkpoint deferral by normal marker or receipt-failure execution.

Normal `notify(meta)` continues to require the current per-child metadata for validation and deduplication, but the generic message does not carry that metadata. Receipt-failure message details remain unchanged.

Do not change the execution adapter, Worker registry, result format, status filtering, or collection tools.

Completion criterion: every test passes after the four enumerated assertion rewrites; unchanged Subagent, Worker receipt-failure, cancellation, shutdown, and checkpoint guarantees remain green.

### 3. Update current behavior

Update together:

- `docs/foundation/decisions.md` — amend Decision 98;
- `docs/plans/level-1-subagents.md`;
- `docs/plans/subagent-worker-iterative-improvement.md` — record the failed busy-lead pilot;
- `extensions/subagent/README.md`;
- `extensions/context-checkpoint/README.md` and the keying comment in `checkpoint-barrier.mjs`;
- the Subagent and Worker prompt guidance and background-result text in `extensions/subagent/index.ts`; and
- `extensions/subagent/real-smoke-evidence.md` after verification.

Completion criterion: neither documentation nor runtime guidance claims that normal completion queues one `followUp` per execution.

### 4. Verify

Run:

```sh
npm test
```

Then run one attended smoke with three short background children while the lead executes a multi-step tool batch, so at least two children finish before the signal is delivered. Verify one `steer`, one default status snapshot, one collection per terminal child, and no stale completion turn afterward.

## Non-goals

- No global delivery-mode setting.
- No debounce or timer.
- No automatic collection or result injection.
- No upstream Pi queue API change.
- No batching, retry, scheduler, or authority expansion.
