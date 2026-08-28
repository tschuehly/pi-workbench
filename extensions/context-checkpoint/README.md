# Context checkpoint extension

Adds the model-facing `compact_and_continue` tool. The model calls it as the final action at a coherent phase boundary with a short summarizer focus directive (at most 1,200 characters) and one concrete next phase (at most 800 characters).

The tool must be the only tool call in its assistant tool batch. It returns a terminating result instead of compacting during tool execution. Once the agent is settled, the extension invokes Pi's compaction API. Successful compaction injects a custom continuation message and starts the next model turn automatically. A failed compaction also resumes the model with the diagnostic so it can report the failure and decide whether the remaining context is sufficient. Session shutdown, replacement, or reload cancels any in-memory request and suppresses stale continuation callbacks.

This is a same-session, lossy context checkpoint. The focus directs Pi's summarizer; it is not the summary itself. The extension rejects oversized inputs with an actionable length diagnostic. It does not create a durable cross-session handoff, authoritative Workstream state, or a substitute for saving and verifying repository work before compaction.

## Checkpoint barrier

`checkpoint-barrier.mjs` makes the checkpoint atomic against background children. A background Subagent or Worker can reach terminal completion after `compact_and_continue` is accepted but before `agent_settled` fires, and its wakeup asks for a turn. The barrier blocks turn-triggering child wakes from acceptance through compaction, delivers the checkpoint result first, then releases every queued wake exactly once. A failed compaction still releases them; session shutdown drops them instead of delivering them late.

The barrier is one process-local instance shared by import: this extension owns it, and `extensions/subagent/` wraps its completion wakeup with it. Wakes are keyed by execution and receipt status, so one execution cannot wake the lead twice while a terminal wake and a receipt-failure wake stay distinct.

This covers only the explicit `compact_and_continue` boundary. Pi's own threshold and overflow compaction is upstream behavior that this extension does not schedule and does not fix; see [`docs/plans/upstream-pi-summary-owner-direction.md`](../../docs/plans/upstream-pi-summary-owner-direction.md).

Run the tests with:

```sh
npm run test:context-checkpoint-extension
```
