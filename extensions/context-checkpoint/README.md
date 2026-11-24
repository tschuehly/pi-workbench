# Context checkpoint extension

Adds the model-facing `compact_and_continue` tool. The model calls it as the final action at a coherent phase boundary with a short summarizer focus directive (at most 750 words) and one concrete next phase (at most 120 words). Limits are in words because models estimate words better than characters or tokens.

The tool must be the only tool call in its assistant tool batch. It returns a terminating result instead of compacting during tool execution. Once the agent is settled, the extension invokes Pi's compaction API. Successful compaction injects a custom continuation message and starts the next model turn automatically. A failed compaction also resumes the model with the diagnostic so it can report the failure and decide whether the remaining context is sufficient. Session shutdown, replacement, or reload cancels any in-memory request and suppresses stale continuation callbacks.

This is a same-session, lossy context checkpoint. The focus directs Pi's summarizer; it is not the summary itself. The extension rejects oversized inputs with an actionable length diagnostic. It does not create a durable cross-session handoff, authoritative Workstream state, or a substitute for saving and verifying repository work before compaction.

## Checkpoint and continue (Durable Chats only)

`packages/durable-pilot/src/checkpoint.ts` adds a second tool, `checkpoint_and_continue(nextPhase)`. It is for lead Chats with a home Workstream. The model first writes `workstreams checkpoint <id>`, then calls the tool alone. Durable's `handoff` tool control starts a fresh context and the same run goes on there. The new context holds the current Working Mode block, a pointer to the home Workstream's latest checkpoint, every open question set verbatim (as `/back` keeps them) and the next phase. Nothing is summarized, so there is no summarizer call and no focus to limit. The tool does not check that a checkpoint was just written. Child allowlists do not offer it: children keep `compact_and_continue`.

## Context ceiling

When a session that can call `compact_and_continue` crosses 200,000 context tokens, the `turn_end` hook adds one visible `context-ceiling` entry to the context (a boundary entry, so it starts no turn) that tells the model to carry on with the current phase and to compact once it is done with `compact_and_continue`, naming what the summary must keep and the next phase. Each further 50,000 tokens adds a one-line follow-up until a compaction drops the context; it fires again at the next step above wherever the context lands. Subagent and Worker children receive the tool too; `packages/pi-execution-adapter/` keeps a child running across the settle an accepted checkpoint causes.

## Startup budget

A lead session's first reply reports how big its prompt was before the first message (input plus cache read and write, the number `scripts/context-usage.mjs` measures). Above 30,000 tokens (`STARTUP_BUDGET_TOKENS`; the owner target is 20,000 once trimmed), the owner sees a one-line warning naming the size and the command that breaks it down; the model never sees it. It fires once per session, not for resumed sessions or Subagent and Worker children.

## Checkpoint barrier

`checkpoint-barrier.mjs` makes the checkpoint atomic against background children. A background Subagent or Worker can reach terminal completion after `compact_and_continue` is accepted but before `agent_settled` fires, and its wakeup asks for a turn. The barrier blocks turn-triggering child wakes from acceptance through compaction, delivers the checkpoint result first, then releases every queued wake exactly once at the resumed turn's first `agent_start` or `agent_settled`. Releasing in the same tick as the result would race its turn start: Pi marks the session streaming only after the async `before_agent_start`, so a second triggered send runs a concurrent prompt that throws and leaves the session wedged. A failed compaction still releases them; session shutdown drops them instead of delivering them late.

There is one barrier per session, looked up by session id, because the PI WEB session daemon hosts many sessions in one process; a process-wide barrier would let one session's checkpoint hold every other session's wakes. It is shared by import: this extension owns it, and `extensions/subagent/` wraps its completion wakeup with it. The coalesced completion signal holds one stable key, so a fan-out across a checkpoint releases one signal and a later signal replaces the held one; a receipt-failure wake keys by its own execution and stays distinct.

This covers only the explicit `compact_and_continue` boundary. Pi's own threshold and overflow compaction is upstream behavior that this extension does not schedule and does not fix; see [`docs/plans/upstream-pi-summary-owner-direction.md`](../../docs/plans/upstream-pi-summary-owner-direction.md).

Run the tests with:

```sh
npm run test:context-checkpoint-extension
```
