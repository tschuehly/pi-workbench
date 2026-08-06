# Context checkpoint extension

Adds the model-facing `compact_and_continue` tool. The model calls it as the final action at a coherent phase boundary with a compaction focus and a concrete next phase.

The tool must be the only tool call in its assistant tool batch. It returns a terminating result instead of compacting during tool execution. Once the agent is settled, the extension invokes Pi's compaction API. Successful compaction injects a custom continuation message and starts the next model turn automatically. A failed compaction also resumes the model with the diagnostic so it can report the failure and decide whether the remaining context is sufficient. Session shutdown, replacement, or reload cancels any in-memory request and suppresses stale continuation callbacks.

This is a same-session, lossy context checkpoint. It is not a durable cross-session handoff, authoritative Workstream state, or a substitute for saving and verifying repository work before compaction.

Run the coordinator tests with:

```sh
node --test extensions/context-checkpoint/coordinator.test.mjs
```
