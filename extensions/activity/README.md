# Activity extension

Interactive Pi renders one bounded **Active** surface above the editor. Each item stays on one line: an icon identifies its kind, optional identity and Cognitive Role precede a shortened model name, and the objective plus latest activity share a 120-character sentence.

Other extensions publish session-local presentation state through Pi's existing event bus:

```ts
pi.events.emit("pi-workbench:activity", { type: "upsert", item: {
  id: "stable-owner-id", kind: "subagent", role: "independent-review",
  model: "anthropic/claude-opus-5", objective: "Review activity design", activity: "reading runtime.ts",
} });
pi.events.emit("pi-workbench:activity", { type: "remove", id: "stable-owner-id" });
```

Supported kinds are `subagent` (`🤖`), `worker` (`🧰`), `monitor` (`👀`), and `shell` (`💻`). Optional fields are `name`, `role`, `model`, `effort`, `objective`, and `activity`. The surface validates and bounds every update, remains presentation-only, and clears at session shutdown. The built-in `bash` and `powershell` tool lifecycle is projected automatically. Publishers remain responsible for truthful lifecycle state and must remove terminal items.
