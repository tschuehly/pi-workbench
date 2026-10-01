# Secret redaction

Replaces credential values in Pi tool output, assistant text, and model context with `[REDACTED:<source>]` before they reach the model or the session log.

This is defense in depth, not a guarantee. It cannot catch encoded, split, or transformed secrets. The rule "never print secret values" still applies. Design and package comparison: `docs/research/reports/secret-redaction-options-2026-10-01.md`.

## What it redacts

1. **Known values** (`auth.json`): every string leaf of at least 12 characters in the credential entries of `auth.json` in the Pi agent directory (`PI_CODING_AGENT_DIR` or `~/.pi/agent`). Arrays such as `availableModelIds` are skipped. The file is re-read when its mtime or size changes, because OAuth access tokens rotate.
2. **Known values** (`env:<NAME>`): the value of every environment variable whose name contains `TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `PASSWD`, `AUTH` (not `AUTHOR`), `CREDENTIAL`, or `COOKIE`. The value must be at least 12 characters and not obviously non-secret: no whitespace, paths, booleans, numbers, URLs without credentials, or e-mail addresses.
3. **Prefixes** for secrets Pi never held: `gh[opsur]_…`, `github_pat_…`, `sk-ant-…`, `sk-…`, JWTs, PEM private-key blocks, and Copilot `tid=…;exp=…` tokens. There is no generic length or entropy rule, so git SHAs and blob hashes survive.

## Where

- `tool_result`: `content`, `details`, and `structuredContent` of every tool, before the result is persisted.
- `message_end`: assistant `text` blocks only. Tool-call arguments are left alone because they are the command that runs. Thinking blocks are left alone because providers sign them.
- `context`: a backstop for the model-bound copy of every message, including `!` `bashExecution` output and custom messages. It does not change the log.
- `extensions/background-bash/jobs.mjs` `deliver()` calls `redact()` itself. An idle, non-triggering completion is persisted before any extension hook runs.

## Known gaps

- Live `tool_execution_update` partial output in the TUI or PI WEB (display only, not persisted).
- Full-output spill files (`fullOutputPath`, background-bash `output.log` files).
- `!` user-shell output in the session log: `recordBashResult` persists it without a hook. Only the model copy is redacted.
- Keychain or broker secrets that Pi never holds, and secrets stored under innocuous env names.
- Encoded, split, or transformed values.
- Tool-call arguments and thinking blocks the model writes.
- Known values shorter than 12 characters.

Test: `npm run test:secret-redaction-extension`.
