# Commit-safe configuration templates

Each template records deliberate Workbench harness configuration. Live copies stay machine-local;
never commit credentials, sessions, or machine-specific paths.

| Template | Live location |
| --- | --- |
| `pi-agent-settings.example.json` | `~/.pi/agent/settings.json` (global Pi agent settings) |
| `pi-web.example.json` | `~/.pi-web-durable/config.json` (the Durable instance), or a repository-local `.pi-web/config.json` |
| `workbench.example.json` | Workbench configuration template; no module consumes it yet |

## Pi agent settings

Pi has no include mechanism: merge the fragment into the live file by hand, preserving unrelated
personal fields (theme, models, packages). Pi reads settings at process start, so the merged values
reach the lead and every child Pi launched afterwards; restart running sessions to apply them.

In `packages`, replace **only** the npm Monitor entry with the pinned git entry in the template; do not replace the array. Fully restart existing CLI sessions and Durable hosts rather than hot-reloading old poll timers: a CLI `/reload` keeps the old runtime's poll timers, which run unfenced until restart. Never keep both Monitor entries: the CLI does not refuse the pair (Durable does). Durable resolves packages without installing, so run `pi install <the git entry>` once before restarting Durable hosts; until then Durable has no Monitor tool (it fails closed). The Durable allowlist checks the installed package by name and launch-policy capability, not a second source list.

Why these values:

- `retry` raises Pi's transient-error budget from 3 attempts (~14 s) to 8. Pi doubles the delay each
  attempt, so the schedule reaches 256 s and rides out roughly 8.5 minutes of provider or network
  outage. Attended child dispatches previously died after three connection errors.
- `retry.provider.*` stays at Pi defaults (0 SDK retries): per Pi's settings documentation,
  SDK-level retries can absorb usage-limit errors before Pi sees them and stall the agent.
