# Autonomous Grill extension

Adds `/autonomous-grill` to Pi's command picker. Run it with a target:

```text
/autonomous-grill Decide whether to replace the cache layer
```

With no argument, interactive Pi opens an editor for the target. The extension reads the authoritative instructions from `skills/autonomous-grill/SKILL.md`, injects them as hidden session context, and starts the lead turn. It requires the `worker_*` and `subagent` tools from `extensions/subagent/`; package loading supplies them, while a partial extension load cannot run the grill. It does not duplicate orchestration logic or create durable Run state.

The active Pi model remains the lead. Recurring advice and the closing audit use different child forms:

| Work | Child form | Cognitive Role | Current binding | Independence |
| --- | --- | --- | --- | --- |
| Decision-by-decision advisor rounds | One durable attended `planner` worker, resumed across bounded dispatches | `design` | `openai-codex/gpt-5.6-sol` at `xhigh` | Anchored by its prior rounds; not independent and not guaranteed cross-family |
| Closing completeness audit | One fresh `reviewer` Subagent per audit | `challenge` | OpenAI lead → `anthropic/claude-fable-5` at `high`; Anthropic lead → `openai-codex/gpt-5.6-sol` at `xhigh` | Fresh-context and cross-family independent from the lead provider; with an Anthropic lead it uses the same model and effort as the worker |

The lead resumes an active advisor worker already scoped to this grill or creates one, dispatches it one assignment at a time, and retires every advisor worker after the final audit, replacement, or terminal stop. Worker continuity replaces the old per-round advisor ledger. A compact dissent summary remains only as the bounded handoff to each fresh closing-audit Subagent.

Every worker and Subagent dispatch resolves a fresh binding, fails closed rather than changing the requested Cognitive Role, and verifies the runtime model and effort. Quota admission may use the shared cached snapshot or explicitly degraded telemetry. The worker's continued session does not pin its model, grant Run authority, or make its output independent.
