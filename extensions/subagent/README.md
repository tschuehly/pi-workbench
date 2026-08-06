# Subagent extension

Level 1's attended `subagent` tool. One invocation accepts only `task`, a bundled `profile`, a `cognitiveRole`, and an optional `background` flag; it resolves a fresh provider/model/effort binding through Workbench model-orchestration policy and delegates process lifecycle to `packages/pi-execution-adapter/`.

By default the tool streams progress and blocks until the child finishes. With `background: true` it returns a handle immediately so the lead can launch several children and keep working. Three companion tools reconcile backgrounded children within the same session: `subagent_status` (non-blocking snapshot of one child or a list of all), `subagent_collect` (stream remaining progress and return the compact terminal result), and `subagent_cancel` (cancel and confirm termination). Backgrounding is in-session only: children still die on `session_shutdown` and receive no durable identity, recovery, or unattended lifetime. Durable, unattended background execution remains deferred to the controller.

Bundled profiles are `scout`, `planner`, `reviewer`, and `implementer`. Their requested tools are intersected with the adapter's host ceiling. User/project profiles, static model fields, batches, chains, retries, transcript forks, and durable background execution that survives the session are intentionally unsupported.

The child uses a fresh, machine-local persistent Pi RPC session. Progress is normalized without raw thinking content, cancellation is confirmed through process termination, and the parent receives only the compact terminal result and session metadata. This grants no managed Run authority, durable actor identity, workspace isolation, recovery, acceptance, or publication right.
