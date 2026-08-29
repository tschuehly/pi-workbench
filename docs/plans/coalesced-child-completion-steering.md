# Coalesced child-completion steering

Status: proposed.

## Goal

Replace per-child completion `followUp`s with one coalesced `steer` signal. In a 23-child fan-out, 20 wakes arrived after collection and 12 did no useful work. `steer` also reaches a busy lead at the next safe model boundary instead of waiting for the run to stop.

## Design

Keep the change in `extensions/subagent/completion-wakeup.mjs`. Normal attention has two states:

```text
idle -> queued -> idle
```

1. The first normal completion while `idle` sends one generic message with `{ deliverAs: "steer", triggerTurn: true }` and details `{ attention: "terminal-results" }`.
2. Later completions while `queued` enter the existing `handled` set, send nothing, and make `notify()` return `false`.
3. `rearm()` clears only `queued`; `handled` and per-child metadata validation stay unchanged. Only a new execution can send later.
4. Only `message_start` with that marker returns attention to `idle`.
5. `agent_settled` also re-arms without sending. A checkpoint-held signal remains valid and a later normal signal replaces it under the same stable key.

The message says:

> Background children finished. Call `subagent_status`, then collect and reconcile each terminal-uncollected child once. This notice authorizes no retry, relaunch, publication, or acceptance.

Delivery—not status or collection—clears the signal. The lead must collect every child in the default status roster; there is no second reminder loop.

Keep active-collection suppression, cancellation, shutdown, and exact Worker receipt-failure attention unchanged. Receipt-failure messages carry no normal marker and cannot clear or merge with normal attention.

Accepted residual: abort can discard a signal after its children entered `handled`. The results remain visible through `subagent_status` but do not wake the lead again unless another child finishes.

## Implementation

1. **Test first.** Rewrite the four assertions that intentionally change: normal delivery becomes generic `steer`; normal Worker attention loses per-child message details; settled Worker success uses the generic message; and checkpoint fan-out defers one signal instead of three. Add one 23-completion regression proving:
   - one signal, 22 suppressed `false` returns;
   - only the normal marker re-arms;
   - `agent_settled` re-arms without sending;
   - a later completion sends again;
   - after explicit re-arm, the checkpoint barrier defers and releases one signal; and
   - receipt failure, collection, cancellation, and shutdown remain correct.

   The regression must fail against the current implementation.

2. **Change the existing seam.** Add one queued flag and idempotent `rearm()` to `completion-wakeup.mjs`. In `extensions/subagent/index.ts`, re-arm on matching `message_start` and `agent_settled`, and key checkpoint deferral by normal marker or receipt-failure execution.

3. **Update current behavior.** Amend Decision 98 in `docs/foundation/decisions.md`; update `docs/plans/level-1-subagents.md`, `docs/plans/subagent-worker-iterative-improvement.md` with the failed busy-lead pilot, `extensions/subagent/README.md`, the launch receipts and tool guidance in `extensions/subagent/index.ts`, `extensions/context-checkpoint/README.md`, the keying comment in `extensions/context-checkpoint/checkpoint-barrier.mjs`, and `extensions/subagent/real-smoke-evidence.md`.

Do not change the execution adapter, Worker registry, result format, status filtering, or collection tools.

## Done when

- `npm test` passes.
- During a multi-step lead tool batch, at least two of three smoke children finish before delivery; one useful `steer` leads to one default status snapshot, each result is collected once, and no stale completion turn follows.

## Not doing

No new module, dependency, timer, global delivery setting, automatic collection or result injection, upstream Pi change, batching, retry, scheduler, or authority expansion.
