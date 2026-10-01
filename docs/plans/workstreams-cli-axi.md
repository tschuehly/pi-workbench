# Workstreams CLI: AXI redesign (proposal)

Status: accepted 2026-10-01 (owner defaults: text output with `--json`; automatic `expectedRevision` for checkpoints, explicit `--expect` for overview and close). Evidence comes from the 2026-10-01 session audit (`docs/research/reports/session-audit-2026-10-01.md`). It is also in the private `workstreams-failures.md`, which lists 12 failures verified in the raw logs. Design reference: [AXI, ten principles for agent-facing CLIs](https://axi.md/).

## Problem

Agents use `skills/workstreams/scripts/workstreams.mjs` as a raw JSON pipe to the store. It has these problems:

| Symptom (verified) | AXI principle |
| --- | --- |
| `append --help` and `create --help` fail with "Input is not valid JSON", so agents grep `index.d.ts` for record shapes (01a0c5a2, 01a0c7e2) | §10: per-command help |
| Agents get the record envelope wrong: a missing `payload.sessionId`, `link.target` instead of `reference`, stdin passed as `@-` (01a0e8d1, 01a0f26a, 01a0f24d) | §6: errors that fix themselves; §2: minimal input |
| Inline JSON breaks on quoting, so agents fall back to temp files in `/tmp` (01a05c21) | §6: plain flags, no JSON required |
| `list` returns 20 KB of JSON for 32 Workstreams, and `inspect` up to 85 KB, dominated by `sessions`. Agents write Python to dig out `next`, then crash on nulls and wrong keys (`id` vs `sessionId`, `latestCheckpoint`) (01a0f6eb, 01a0ec7c) | §2: minimal schemas; §3: truncation; §4: precomputed answers |
| `list` returns `id`, but `inspect` expects `workstreamId` | consistency |
| `$SKILL_DIR` is unset or wrong, giving `Cannot find module '/scripts/workstreams.mjs'` (01a0811c, 01a04c4a, 01a0c379) | §7/§10: a stable executable on PATH |
| Errors go to stderr as JSON with exit code 1 for everything, and say nothing about the next step | §6 |
| Running it with no arguments prints an error | §8: content first |

The store, its records, revisions and idempotency remain the authority. Only the CLI adapter and the skill text change.

## Proposal

1. **An executable on PATH.** Add `~/.pi/agent/bin/workstreams`, symlinked to the installed CLI the same way `pi-telemetry` is. This removes `SKILL_DIR`.
2. **A home view when run with no arguments.** Print the tool's path, a one-line description, and *this session's* Workstream if `PI_SESSION_ID` is associated (title, waitingOn, next). Then list open Workstreams compactly, followed by 2–3 `help:` next steps.
3. **Compact text output by default, `--json` for scripts.** `workstream-dashboard` already parses JSON, so it moves to `--json`.
   - **`list`:** one row per Workstream, with `id | title | group | waitingOn | updated`, plus `count: 32 open (17 closed)`. Add `--fields` for more columns.
   - **`show <id>`** (replaces `inspect`): overview; links; one line per session (`id | title | state | waitingOn | next`, truncated at about 300 characters); unresolved Human Tasks. `--full` gives the complete text.
4. **Verb commands for the common writes.** The CLI fills in the envelope: `producer=session` (or `--owner`), `sourceSessionId=$PI_SESSION_ID`, `expectedRevision` read just before the write, and an `idempotencyKey` derived from the content.
   - `workstreams checkpoint <id> --what "…" --remains "…" --next "…" --waiting owner|agent|external [--title "…"] [--ref PATH]…`
   - `workstreams overview <id> --goal "…" --done-when "…" --description "…" --history "…"…`
   - `workstreams link <id> --kind repository --ref "<repo>@<sha>" [--label "…"]` and `unlink <id> <linkId>`
   - `workstreams create <id> --title "…" --group "…"`, `title`, `group`, `resolve-task`, `associate`, `close`
   - Each accepts `--stdin` for long text fields. Raw `append` stays for rare records.
5. **Self-correcting errors, on stdout.** Each error states what went wrong, then a `help:` line showing the correct command. Unknown flags or fields are rejected and the valid ones listed (exit code 2). Field limits are checked before writing, e.g. `--what is 742/600 chars`.
6. **Idempotent no-ops.** Associating an already-associated session, or repeating an identical checkpoint, prints `(no-op)` and exits 0.
7. **Per-command `--help`.** Each lists its flags, limits and 2 examples. This is where the record shapes live, not in the skill.
8. **Shrink `SKILL.md`** from 178 lines to about 80. The skill keeps the judgment: when to checkpoint, how to write for Thomas, the shape of a status report, and how to retire a worktree. The mechanics move to `workstreams <cmd> --help`. Fix the wrong `index.d.ts` path and the instruction that makes a read-only status request write an overview.

## Trade-offs

- **Automatic `expectedRevision`** gives up the "reconcile what changed in between" check on common writes. That is acceptable for checkpoints, which belong to a single session. For `overview` and `close`, the CLI prints the intervening change and asks for a retry with `--expect <rev>`.
- **Text output** costs a `--json` flag for scripts. PI WEB uses the store package directly, not this CLI.
- **Not doing:** TOON or any new dependency (hand-rolled rows instead), and the session-start ambient hook (§7). The home view covers it without a per-session token cost.

## Done means

- Every one of the 12 failures in `workstreams-failures.md` becomes either impossible or one self-correcting error. Each has a regression test in `workstreams.test.mjs`.
- `workstreams` with no arguments, `list`, and `show` together cost under 3 KB for today's store.
- `tools/workstream-dashboard` still builds using `--json`.
