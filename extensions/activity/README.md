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

Supported kinds are `subagent` (`🤖`), `worker` (`🧰`), `monitor` (`👀`), and `shell` (`💻`). Optional fields are `name`, `role`, `model`, `effort`, `objective`, `activity`, and `reportedStatus`. `activity` is inferred per tool call; `reportedStatus` (subagent/worker only) is the child's own one-line self-report from its `report_status` tool, bounded to 120 characters, and sticky until the child reports again — it is not overwritten by ordinary tool activity. The surface validates and bounds every update, remains presentation-only, and clears at session shutdown. In RPC mode the Subagent and Worker entries from the same normalized map are published through `setStatus("pi-workbench:activity", JSON.stringify({ schemaVersion: 1, items }))`; snapshots contain at most 64 items and exclude shell tool arguments. The built-in `bash` and `powershell` tool lifecycle is projected automatically. Publishers remain responsible for truthful lifecycle state and removal.
