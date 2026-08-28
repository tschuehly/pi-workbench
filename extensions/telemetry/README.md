# Pi telemetry

This extension records Pi lifecycle, provider usage, and Workbench child lineage as machine-local JSONL. Each process owns one file under `~/.pi/agent/telemetry/events/`, so concurrent Pi processes never share a writer.

Normal package discovery loads the extension in TUI, RPC, JSON, and print modes. An isolated launch must load it explicitly:

```sh
pi --no-session --no-extensions -e /path/to/pi-workbench/extensions/telemetry/index.ts -p "prompt"
```

Create a report for one root session and all linked children:

```sh
pi-telemetry report --root-session <session-id>
pi-telemetry report --root-session <session-id> --concept <studio-concept>
```

Studio reports recognize Review Poll sentinels in idle Monitor messages, mid-turn steering, and fallback tool results. They deduplicate replay, then join the first agent delivery to the next byte-changed watchable draft for that concept. Pass `telemetryConcept` on concept-bound Subagent and Worker dispatches so creator/reviewer active time and provider usage stay attributable. Build intervals, draft SHA-256, Git HEAD, and Review Studio acceptance remain in the same report.

Set `PI_TELEMETRY_DIR` only for isolated tests or fixtures. Persisted sessions store prompt entry pointers; ephemeral `--no-session` runs store their redacted invocation and exact prompt locally. Reports group finalized usage by cognitive role, concept, provider, and model; unknown fields remain `null`.
