# Subagent extension

Level 1's attended `subagent` tool. One invocation accepts only `task`, a bundled `profile`, and a `cognitiveRole`; it resolves a fresh provider/model/effort binding through Workbench model-orchestration policy and delegates process lifecycle to `packages/pi-execution-adapter/`.

Bundled profiles are `scout`, `planner`, `reviewer`, and `implementer`. Their requested tools are intersected with the adapter's host ceiling. User/project profiles, static model fields, batches, chains, retries, transcript forks, and background execution are intentionally unsupported.

The child uses a fresh, machine-local persistent Pi RPC session. Progress is normalized without raw thinking content, cancellation is confirmed through process termination, and the parent receives only the compact terminal result and session metadata. This grants no managed Run authority, durable actor identity, workspace isolation, recovery, acceptance, or publication right.
