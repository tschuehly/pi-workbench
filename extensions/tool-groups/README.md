# Tool groups

Keeps rarely used tool groups out of the lead's startup context. A new session starts without them;
`tools_enable({ group })` adds a group, and its tools reach the model on the next request.

| Group | Tools | Also active when |
| --- | --- | --- |
| `workers` | `worker_create`, `worker_dispatch`, `worker_status`, `worker_retire` | Orchestration is Workers |
| `monitor` | every tool from pi-process-monitor | — |
| `atelier` | `atelier` (extensions/atelier) | — |
| goal | `goal_complete`, `goal_blocked`, `goal_wait` | a `/goal` is active (not enableable) |

- **Cache:** tools added mid-session are declared as a transcript delta, which Pi sends to Anthropic
  as deferred tools, so the cached prefix survives. A `before_agent_start` handler that returns
  `systemPrompt` (ponytail does) forces a full transcript checkpoint instead, so every tool change
  then misses the cache.
- **Goal tools:** pi-goal refuses to start unless its tools are active, so they stay active while the
  session is idle and are removed from every model run without an active goal (the latest
  `goal-state` entry). A `/goal` typed while a run streams fails with pi-goal's message.
- **Resume:** a resumed branch keeps every group its transcript had active; a session from before
  tool declarations keeps everything.
- **Aliases:** pi-claude-code-use `mcp__<extension>__<tool>` aliases are hidden with their tools.
- **MCP** is not a group: Pi's built-in MCP support exposes server tools through `codemode` or
  `tool_search` (see `mcp.json`), so they cost no startup context.
- **Children** are untouched: `--tools` allowlists never register these tools or `tools_enable`.

`npm run test:tool-groups-extension` runs a real Pi session against a scripted model.
