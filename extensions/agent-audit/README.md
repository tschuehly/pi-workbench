# Agent input audit

The agent-input audit is loaded with the Workbench package but **captures nothing by default**. It is a local diagnostic for one attended Pi terminal session in this checkout.

## Capture

1. Run `/agent-audit start` and confirm the sensitive-data warning.
2. Send the lead-session prompt you want to inspect.
3. Run `/agent-audit stop` when the relevant turns finish. Reload, session replacement, and shutdown also stop and restore the observers.

Exact request bodies, logical hook evidence, source snapshots, and output references are written with owner-only permissions under ignored `.review/agent-audit/`. Prompt text can contain credentials or other secrets. Nothing is redacted, uploaded, or automatically deleted; use the cleanup command below when the evidence is no longer needed.

Supported transport observations for installed Pi 0.84.3 are:

- Anthropic Messages through the SDK's HTTP `fetch` path;
- OpenAI Codex Responses through HTTP/SSE fallback, including exact compressed bytes and local zstd interpretation; and
- OpenAI Codex Responses through Node's `WebSocket.prototype.send`, including cached-context delta messages on sockets opened before capture started.

Other provider APIs, custom transports, Bun's separate WebSocket wrapper, response body bytes, TLS packets, and server-side instructions are unsupported. Sends outside the supported main-agent `before_provider_request` interval—including tool traffic and other processes—are excluded. A local send observation does not prove provider receipt. Observer errors are shown in the terminal and mark evidence incomplete without changing or aborting provider traffic. Stop waits only a bounded time for diagnostic callbacks; a pending provider request continues normally while late audit callbacks are detached.

## Agent-readable JSON

These commands do not run a model or start a browser:

```sh
node extensions/agent-audit/cli.mjs list
node extensions/agent-audit/cli.mjs inspect <capture-id>
node extensions/agent-audit/cli.mjs export <capture-id>
node extensions/agent-audit/cli.mjs previews [preview-set-id]
node extensions/agent-audit/cli.mjs atelier <capture-id>
node extensions/agent-audit/cli.mjs atelier-preview <preview-set-id>
node extensions/agent-audit/cli.mjs cleanup <capture-id|all>
node extensions/agent-audit/cli.mjs cleanup-preview <preview-set-id>
node extensions/agent-audit/cli.mjs cleanup-export <capture-id|preview-UUID>
```

`export` materializes referenced native session JSONL entries as evidence snapshots. They remain native persisted, postprocessed entries—not raw provider response bytes. One logical request can have retries or fallback sends, so outputs are linked to observable turn/attempt groups and may be marked shared, missing, or unfinished.

For a preview-only Atelier without a model request, run `/agent-audit start`, then `/agent-audit stop` without sending a prompt. Copy the preview-set identity from `list` and run `atelier-preview`. Repeating the same preparation reopens the frozen export and preserves its Atelier comments; missing generated Surface assets are repaired without deleting valid frozen evidence or comments. A corrupt or mismatched export names the explicit `cleanup-export` command required before replacement. Preparation prints the token-gated server, poller, preflight, and human URL commands but starts nothing.

Preview sets include data-driven `dialDefinitions`; every preview carries its exact saved `dials` combination while retaining the legacy `alignment` and `checking` fields.

The versioned JSON separates:

- the exact transport bytes and decoded interpretation;
- the official logical `before_provider_request` observation at this extension's load order;
- Pi's structured base-prompt inputs and source snapshots;
- advertised skill catalog evidence, installed explicit skill commands, exact `/skill` wrappers, and partial read-tool evidence tied to known skill paths and text actually present in the request;
- active tool definitions; and
- native session entry references and materialized output evidence.

An empty loaded-skill detection list is not evidence that no skill body was loaded. Read results retain the exact returned text and truncation markers; current disk content is never substituted for request evidence.

Saved captures and preview sets are immutable files. Lists report unreadable records individually; strict inspection still rejects them, while targeted cleanup remains available. Disk-at-capture source content is retained separately from content Pi had already loaded. Captures separately record the Pi installation nearest the running `process.argv[1]`, the extension-resolved installation, their comparison, and disk-at-module-load hashes for the audit producer and Working Mode renderer. Preview evidence states whether `buildSystemPrompt` came from the running Pi installation, a same-version extension-resolved fallback, or an injected test harness. Exact saved prompts and request bytes remain the primary evidence.
