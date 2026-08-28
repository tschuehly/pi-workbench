# Activity extension

Interactive Pi renders one bounded **Active** surface above the editor. Each line puts the changing action first, followed by compact identity, Cognitive Role, and model tags; the complete line is capped at 100 characters. Before the first action, the launch objective is the fallback.

Other extensions publish session-local presentation state through Pi's existing event bus:

```ts
pi.events.emit("pi-workbench:activity", { type: "upsert", item: {
  id: "stable-owner-id", kind: "subagent", role: "independent-review",
  model: "anthropic/claude-opus-5", objective: "Review activity design", activity: "reading runtime.ts",
} });
pi.events.emit("pi-workbench:activity", { type: "complete", item: {
  id: "stable-owner-id", kind: "subagent", role: "independent-review",
  outcome: "success", summary: "No blocking findings",
} });
pi.events.emit("pi-workbench:activity", { type: "remove", id: "stable-owner-id" });
```

Supported kinds are `subagent` (`🤖`), `worker` (`🧰`), `monitor` (`👀`), and `shell` (`💻`). Optional fields are `name`, `role`, `model`, `effort`, `objective`, and `activity`. A `complete` event removes the active item and keeps up to three bounded human-facing summaries under **Done** until the next interactive input. The surface remains presentation-only and clears at session shutdown. Built-in `bash` and `powershell` lifecycle is projected automatically. Publishers remain responsible for truthful lifecycle state.
