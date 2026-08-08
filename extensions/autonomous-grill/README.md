# Autonomous Grill extension

Adds `/autonomous-grill` to Pi's command picker. Run it with a target:

```text
/autonomous-grill Decide whether to replace the cache layer
```

With no argument, interactive Pi opens an editor for the target. The extension reads the authoritative instructions from `skills/autonomous-grill/SKILL.md`, injects them as hidden session context, and starts the lead turn. It does not duplicate orchestration logic or create durable Run state.

The active Pi model remains the lead. Every advisor and closing-audit child uses the `challenge` Cognitive Role:

| Lead provider family | Child model | Model Effort |
| --- | --- | --- |
| OpenAI | `anthropic/claude-fable-5` | `high` |
| Anthropic | `openai-codex/gpt-5.6-sol` | `xhigh` |

The runtime resolver checks current model availability and quota admission before every child launch. It fails closed rather than silently changing the Cognitive Role.
