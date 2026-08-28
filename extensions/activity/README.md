# Activity extension

Interactive Pi renders one bounded **Active** surface above the editor. Width-aware, single-line activity pills pack into one to three columns and wrap as units. Each pill leads with the current action, protects model and Model Effort metadata, and adds compact identity and Cognitive Role when width permits; launch objectives are not rendered.

Other extensions publish session-local presentation state through Pi's existing event bus:

```ts
pi.events.emit("pi-workbench:activity", { type: "upsert", item: {
  id: "stable-owner-id", kind: "subagent", role: "independent-review",
  model: "anthropic/claude-opus-5", objective: "Review activity design", activity: "reading runtime.ts",
} });
pi.events.emit("pi-workbench:activity", { type: "remove", id: "stable-owner-id" });
```

Supported kinds are `subagent` (`🤖`), `worker` (`🧰`), `monitor` (`👀`), and `shell` (`💻`). Optional fields are `name`, `role`, `model`, `effort`, `objective`, and `activity`. The surface validates and bounds every update, remains presentation-only, and clears at session shutdown. The built-in `bash` and `powershell` tool lifecycle is projected automatically. Publishers remain responsible for truthful lifecycle state and must remove terminal items.
