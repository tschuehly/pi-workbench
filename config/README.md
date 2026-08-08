# Commit-safe configuration templates

Each template records deliberate Workbench harness configuration. Live copies stay machine-local;
never commit credentials, sessions, or machine-specific paths.

| Template | Live location |
| --- | --- |
| `pi-agent-settings.example.json` | `~/.pi/agent/settings.json` (global Pi agent settings) |
| `pi-web.example.json` | `~/.config/pi-web/config.json`, or a repository-local `.pi-web/config.json` |
| `workbench.example.json` | Workbench configuration template; no module consumes it yet |

## Pi agent settings

Pi has no include mechanism: merge the fragment into the live file by hand, preserving unrelated
personal fields (theme, models, packages). Pi reads settings at process start, so the merged values
reach the lead and every child Pi launched afterwards; restart running sessions to apply them.

Why these values:

- `retry` raises Pi's transient-error budget from 3 attempts (~14 s) to 8. Pi doubles the delay each
  attempt, so the schedule reaches 256 s and rides out roughly 8.5 minutes of provider or network
  outage. Attended child dispatches previously died after three connection errors.
- `retry.provider.*` stays at Pi defaults (0 SDK retries): per Pi's settings documentation,
  SDK-level retries can absorb usage-limit errors before Pi sees them and stall the agent.
