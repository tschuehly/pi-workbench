# Pi telemetry

This extension records Pi lifecycle, provider usage, and Workbench child lineage as machine-local JSONL. Each process owns one file under `~/.pi/agent/telemetry/events/`, so concurrent Pi processes never share a writer.

Normal package discovery loads the extension in TUI, RPC, JSON, and print modes. An isolated launch must load it explicitly:

```sh
pi --no-session --no-extensions -e /path/to/pi-workbench/extensions/telemetry/index.ts -p "prompt"
```

Create a report for one root session and all linked children:

```sh
pi-telemetry report --root-session <session-id>
```

Set `PI_TELEMETRY_DIR` only for isolated tests or fixtures. Persisted sessions store prompt entry pointers; ephemeral `--no-session` runs store their redacted invocation and exact prompt locally. Unknown cost remains `null`.
