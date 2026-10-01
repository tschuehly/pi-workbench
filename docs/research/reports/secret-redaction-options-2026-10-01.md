# Secret redaction for Pi tool output: options (2026-10-01)

Question: which package should redact secrets from Pi tool output before the output reaches the model and the session log? Context: agents printed GitHub/Copilot OAuth tokens from `~/.pi/agent/auth.json` and an environment secret into session logs.

Redaction is defense in depth. It is not a guarantee. It cannot catch encoded, split, or transformed secrets. Keep the AGENTS.md rule "never print secret values" (see `docs/research/reports/session-audit-2026-10-01.md`, row 10, and `docs/plans/credential-broker.md`).

## Recommendation

Build a small Workbench-owned extension, `extensions/secret-redaction/`, with **no new dependency**.

1. **Primary layer: known-value redaction.** Collect every string leaf in `~/.pi/agent/auth.json`; re-read the file when its mtime changes, because OAuth access tokens rotate. Add the value of every `process.env` variable whose name matches `TOKEN|SECRET|KEY|PASSWORD|PASSWD|AUTH|CREDENTIAL|COOKIE` and whose value is at least 8 characters. Combine all values into one escaped alternation regex, longest first, and replace each match with `[REDACTED:<source>]`.
2. **Secondary layer: a short high-precision prefix list.** Cover `gh[pousr]_…`, `github_pat_…`, `sk-ant-…`, `sk-…`, JWT `eyJ….….…`, PEM private-key blocks, and the Copilot `tid=…;exp=…;…` shape. This catches secrets that never passed through the local credential stores. Do not add a generic 40-character or entropy rule, because git SHAs would match it.
3. **Hooks:** see "Plug-in points" below. Do not adopt an existing package as-is (see the table).

## Why known values beat patterns here (question c)

| Leaked credential (synthetic value with the real shape) | secretlint preset-recommend 13.0.6 | @spences10/pi-redact 0.0.15 | @arvoretech/pi-secret-firewall 0.4.0 | @kiranpg/pi-sentry 0.1.2 | Known-value |
|---|---|---|---|---|---|
| Copilot refresh `ghu_…` | hit | hit | hit | hit | hit |
| **Copilot access token `tid=…;exp=…;proxy-ep=…;8kp=1:<hex>`** | **MISS** | **MISS** | **MISS** | **MISS** | hit |
| Anthropic OAuth `sk-ant-oat01-…` | **MISS** (`sk-ant-api03` only) | hit | hit | hit | hit |
| Codex access token (JWT) | MISS | hit | hit | hit | hit |
| False-positive lines in 844 lines of git SHAs and blob hashes (`pi-workbench`) | 0 | 0 | **844, every SHA** | 0 | 0 |
| Time for about 40–50 KB | 0.4 ms | not measured | not measured | not measured | 0.03 ms |

The `auth.json` shape check is metadata only; no values were printed:

- `github-copilot.access` matches only the `tid=` prefix.
- `github-copilot.refresh` matches `gh[pousr]_`.
- `anthropic.*` matches `sk-ant-`.
- `openai-codex.access` is a JWT.
- `openai-codex.refresh` and `accountId` match none of the six prefixes I checked.

The token that leaked, Copilot `access`, has no public vendor pattern. Only known-value redaction catches it deterministically.

Known-value redaction also covers arbitrary env secrets whose names follow conventions, with zero pattern false positives. Its blind spots are secrets Pi never holds and secrets stored under innocuous names. The prefix layer covers part of that gap.

Measurements come from a scratch harness that has since been deleted. It used synthetic tokens of the real shapes and ran in-process against each package's exported redact function. secretlint ran through `lintSource`.

## (a) Existing Pi packages

Candidates come from `docs/research/generated/pi-packages-index.md` and `npm view`. I inspected the tarballs.

| Package | Hooks | Detection | Deps / license / last publish | Verdict |
|---|---|---|---|---|
| [@spences10/pi-redact](https://www.npmjs.com/package/@spences10/pi-redact) | `tool_result` (text content), `context` (only for `bashExecution`) | About 25 regexes, nopeek-derived; no known values | none (peers `*`) / MIT / 2026-08-23 | Best pattern-only option, with 0 FP on the corpus. Misses Copilot `tid=`. Does not redact `details`, assistant text, or custom messages. |
| [@arvoretech/pi-secret-firewall](https://www.npmjs.com/package/@arvoretech/pi-secret-firewall) | `tool_result`, `context`, `input`, `before_agent_start` | Known values from env and `.env`, plus 7 patterns | none / MIT / 2026-07-22 | Right design, but disqualified: its `AWS_SECRET` rule (any 40-character base64 string) rewrites every git SHA. Does not read `auth.json`. |
| [@kiranpg/pi-sentry](https://www.npmjs.com/package/@kiranpg/pi-sentry) | `tool_result`, `message_end`, `tool_call`, `input`, `user_bash` | Key-name heuristics plus provider patterns, also in `details` | none / MIT / 2026-08-24 | Broadest hook coverage. Its peer range `>=0.78 <0.79` excludes the installed Pi 0.87.1. Misses Copilot `tid=`. No known values. |
| [@normful/pi-stop-secrets-leaks](https://www.npmjs.com/package/@normful/pi-stop-secrets-leaks) | `tool_result`, `before_agent_start` | Spawns the external [betterleaks](https://github.com/betterleaks/betterleaks) binary (MIT, by the Gitleaks author) | needs a separately installed Go binary / MIT / 2026-10-01 | Biggest rule set, but spawns a process per tool result. Not tested, because betterleaks is not installed here. Unconfirmed whether its generic rule catches `tid=`. |
| [pi-pass-secrets](https://github.com/okiess/pi-pass-secrets) | `tool_result` | Known values from GNU `pass` | none / MIT | Pattern to copy: known-value `[REDACTED]`. Wrong source store. |
| pi-sensitive-guard, pi-heimdall, pi-secrets-guard, pi-secret-guard, pi-mono-sentinel, pi-safe-tools | mostly `tool_call` blocking | — | — | Block reads or writes rather than redact output. Not inspected further. |
| @codingcoffee/pi-privacy-filter | — | Local ML model (`@huggingface/transformers`) | heavy | Out of scope: PII, and too heavy. |

## (b) JS/Node secret-detection libraries

| Library | Coverage | False positives | Speed | Weight | License | Maintenance |
|---|---|---|---|---|---|---|
| [@secretlint/core](https://www.npmjs.com/package/@secretlint/core) + preset-recommend 13.0.6 | About 20 vendor rules (AWS, GCP, GitHub, OpenAI, Anthropic API, Slack, npm, Stripe, private keys, basic auth, DB URLs…) | 0 on the corpus | 0.4 ms for about 40 KB, async API | 1.4 MB, 5 packages | MIT | Active; 13.0.6 published 2026-09-25 (azu) |
| [betterleaks](https://github.com/betterleaks/betterleaks) / gitleaks rules | Largest rule set, with entropy and filters | Low (allowlists) | Go binary, spawn per call | External binary; no npm port | MIT | Active (2026); unconfirmed here |
| `detect-secrets` (npm 1.0.6) | Wrapper around the Python tool | — | Spawn | Requires Python | Apache-2.0 | Wrapper last published 2025-10 |
| `redact-secrets`, `redact-pii`, `@redactpii/node` | Key-name or PII oriented | — | — | `redact-pii` pulls Google DLP | MIT | `redact-secrets` stale (2022) |

Conclusion: secretlint is the only maintained in-process JS rule library. On the leaked credential types it adds nothing over a 6-line prefix list, and it misses the two OAuth shapes that matter. Add it as a third layer only if broad vendor coverage for project files becomes a goal.

## Plug-in points (verified in the installed Pi 0.87.1 `dist/core/agent-session.js`)

- **`tool_result`** runs in `afterToolCall`, before the toolResult message is persisted. It applies to every tool, including custom ones. Return `{ content, details }`, and redact strings inside `details` too: bash `details` can carry output, and other tools put text there. Handlers compose (`docs/extensions.md`, "Events and concurrency").
- **`message_end`** is called before `sessionManager.appendMessage`. Use it to redact assistant `text`/`thinking` blocks, where the model may echo a secret, and custom messages delivered during a turn. Leave `toolCall` arguments alone, because the message is replaced in place and rewriting arguments would change the command that runs.
- **Background bash completions bypass `tool_result`.** `extensions/background-bash/jobs.mjs` `deliver()` uses `pi.sendMessage`. When the session is idle and `triggerTurn` is false (a cancelled job), `sendCustomMessage` → `_appendCustomMessage` persists before emitting, so no extension hook runs. Call the shared `redact()` inside `deliver()`.
- **`context`** is a backstop that redacts the model-bound copy of every message, including `bashExecution` from user `!` commands. It does not change the log. `recordBashResult` persists `!` output with no hook.

## Residual exposure the extension will not close

- Live `tool_execution_update` partial output in the TUI or PI WEB (display only, not persisted).
- Full-output spill files (`fullOutputPath`, background-bash logs under `PI_TMP`).
- Keychain or broker secrets that Pi never holds.
- Encoded or split values.
- Tool-call arguments the model writes.

## Checks still open

- The real shape of `openai-codex.refresh` is unconfirmed. Known-value redaction covers it either way.
- Unconfirmed whether betterleaks' generic rule flags the Copilot `tid=` token. The binary is not installed.
- The name of the leaked env secret is unknown. Confirm that it matches the name filter, or add an explicit allowlist of names.
