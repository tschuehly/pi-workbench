# Pi Durable Phase A — pilot results

**Every matrix row and all three spikes pass on the published `@earendil-works/pi-durable@1.4.0`. Neither kill criterion fired:** Claude subscription access and pre-persistence redaction both work through public seams, with no fork or private patch.

Two findings need owner decisions before Phase B:

1. **`synchronous=FULL` alone does not protect against power loss on macOS.** Plain `fsync` there does not flush the drive cache. The plan's storage intent needs FULL + `PRAGMA fullfsync=ON`. That costs about 4 ms per commit and about 23 ms per scripted turn (spike c below; open decision 5).
2. **The pilot never refreshes Claude credentials.** A Durable host that refreshes OAuth tokens must use Pi's file-locked credential store. Otherwise it races the installed Pi.

Scope: Phase A of [the rebuild plan](../../docs/plans/pi-durable-rebuild.md), approved 2026-10-22. This is a headless pilot only. No Workbench, PI WEB, installed checkout or service changed.

## Rerun

```bash
cd packages/durable-pilot
npm run setup                 # exact pins from both lockfiles (pilot 1.4.0, disposable legacy 1.3.0)
npm run typecheck             # compiles the pilot against the pinned 1.4.0 types
npm run test:matrix           # crash matrix: 20 iterations per fault window, each in kill and close mode (~3.5 min)
npm run test:spikes           # redaction spike and offline Claude-adapter tests
npm run latency               # NORMAL vs FULL vs FULL+fullfsync → results/latency.json
npm run summary               # results/summary.md and results/versions.json from results/evidence/
npm run baseline:queue-order  # optional: no-crash placement order the queue.order window must reproduce
npm run spike:claude:live     # sends ONE real request with the local Claude login: run only with owner authorization
```

Environment knobs:

| Variable | Default | Effect |
| --- | --- | --- |
| `PILOT_ITERATIONS` | 20 | Iterations per fault window |
| `PILOT_CONCURRENCY` | 6 | Iterations run in parallel |
| `PILOT_TIMEOUT_MS` | 60000 | Timeout for each host phase |
| `PILOT_TMP` | `$PI_TMP`, then `.runs/` | Where scratch stores live |

Failing iterations keep their store and record its directory in the evidence line.

## How the matrix runs

Each fault window runs in two steps:

1. **Crash process:** a real host process (`test/proc.ts`) opens a store and starts work. At an armed point it sends an explicit IPC barrier, always after the relevant state is committed.
2. **Recovery:** the runner (`test/runner.ts`) either SIGKILLs the process (**kill**) or asks it to close the Harness gracefully (**close**). A fresh process then reopens the store and collects evidence.

No barrier depends on a timer. The runner then runs `PRAGMA integrity_check`. Each iteration's evidence goes to `results/evidence/<window>.<mode>.jsonl`:

- request and effect counts
- task IDs
- transcript summary
- owner epoch
- integrity result
- reports

The aggregate table is in `results/summary.md`; `results/versions.json` records versions. The run used Node v26.7.0, SQLite 3.53.4, pi-durable/pi-ai/chord/pi-telemetry/pi-codemode 1.4.0, and the legacy fixture at 1.3.0.

**The host under test** is `src/host.ts`, `src/store.ts` and `src/pilot.ts`. It has:

- **One owned store.** It uses SQLite WAL with `synchronous=FULL` through the public `NodeSqliteDatabase` facade. Every pragma is verified on open, before Durable reads.
- **Single-owner claim.** SQLite `EXCLUSIVE` locking mode gives a kernel file lock, so a dead owner leaves no stale lock and PIDs are never trusted. Each new owner gets a fencing epoch and nonce in `owner.json`.
- **Paused restore.** After reopen, nothing runs until an explicit `resume()`.
- **Reconciliation before scheduling.** Uncertain unsafe tool intents are recorded first. A `beforeTool` guard then blocks that tool in that conversation until the owner resolves it.
- **Stable-ID admission.** A receipt carrying the payload hash commits before submission.
- **Minimal fixtures** for background children with reporters, foreground leaves, non-blocking questions and attention.
- **Redaction** of every provider and tool through the spike (b) wrappers.

## Crash matrix

"40/40" means 20 SIGKILL iterations plus 20 graceful-close iterations, all passing.

| Plan row | Windows (evidence files) | Result | What the evidence shows |
| --- | --- | --- | --- |
| Generation before/after partial commit | `generation.before-partial`, `generation.after-partial`, `generation.deferred` | **pass** (3 × 40/40) | See [Generation](#generation). |
| Safe tool, unsafe tool | `tools.safe-safe`, `tools.safe-unsafe`, `tools.unsafe-safe`, `tools.unsafe-effect-reproposed` | **pass** (4 × 40/40) | See [Tools](#tools). |
| Child launch/report | `child.before-admission`, `child.after-result`, `child.before-delivery`, `child.after-delivery`, `child.cancel-parent`, `child.worker-leaf`, `child.cancel-worker`, `child.cancel-leaf` | **pass** (8 × 40/40) | See [Children](#children). |
| Queued input | `queue.mid-commit`, `queue.after-commit`, `queue.changed-payload`, `queue.order`, `queue.failed-run` | **pass** (5 × 40/40); **edits not built** | See [Queued input](#queued-input). |
| Unanswered question | `question.before-commit`, `question.after-commit`, `question.answer-undelivered`, `question.delivered-unacked`, `question.attention-race` | **pass** (5 × 40/40) | See [Questions and attention](#questions-and-attention). |
| Schema upgrade/rollback | `schema.upgrade-rollback` (20/20); `schema.task-doc-upgrade`, `-missing`, `-failed` (3 × 40/40) | **pass** | See [Schema](#schema). |
| Ownership/storage/security | `ownership.competing-owner` (20/20), `ownership.disk-full` (40/40), `ownership.crash-loop-parking` (20/20); redaction in spike (b) | **pass**; **partial** for refresh race and alias misrouting | See [Ownership and storage](#ownership-and-storage). |

### Generation

- **Exactly one admitted input** in every window.
- **Before any partial:** the ordinary request is sent again, for 2 provider requests in total, and there is no aborted entry.
- **After a committed partial:** the partial becomes a visible `aborted` assistant entry. It begins with the text observers saw before the crash, and then the final answer completes.
- **Provider-deferred:** the work is polled, not re-requested: 1 submit and 1 fetch.
- **Paused restore:** the reopened host reports `scheduling: "paused"`, and status reads send no request.
- The deferred job uses a file-backed provider test double, because faux deferred jobs are process-local.

### Tools

- **Safe stored and safe current:** the tool reruns, for 2 executions.
- **Safe→unsafe and unsafe→safe:** no rerun. The tool gets an "interrupted and may have partially run" error, and the host records the intent as uncertain before scheduling.
- **Kill after an external effect:** `effects.log` holds exactly one `deploy`.
- **The model re-proposes the same unsafe action:** the guard blocks it with "Needs reconciliation"; the effect count stays 1 and the record remains unresolved.

### Children

- **All four kill points:**
  - one child conversation
  - the child admitted once
  - one child model request
  - one report to the parent
  - one result, uncollected after recovery, then collected exactly once (a second collect returns 0)
  - reporter `completed`
  - no live tasks
- **Parent Esc** stops at the background boundary, so the child keeps running.
- **Ending the Chat** (`abort({background:true})`) stops the child, aborts its reporter, and no late report or new child request appears after reopen.
- **Worker settlement** waits for the leaf; the leaf is admitted once.
- **Cancelling the worker** reaches the leaf, and the receipt reads `aborted`.
- **Cancelling only the leaf** leaves the worker alive, and it answers.

### Queued input

- **Kill or close inside the uncommitted submit transaction** (held before COMMIT), and **after commit but before acknowledgement:** a retry with the same operation ID returns the same submission ID and places the input once.
- **Changed payload under a reused ID:** rejected with `PayloadMismatch`.
- **Steer/follow-up order:** reproduces the no-crash baseline `[P0, steer-1, follow-1, steer-2, follow-2]`.
- **Withdrawal:** a withdrawn follow-up ends `unanswered/aborted` and is never placed.
- **Failed run (`afterFailedRun: keep`):** the queued follow-up stays queued and is not drained; the next input places it first.
- **Not built:** edits. Durable has no queued-item edit; the adapter would withdraw and re-admit, which is untested.

### Questions and attention

- **Every kill point** — before or after the question commit, after the answer commit but before delivery, and after delivery but before the receipt — yields:
  - one question, keyed by the tool task, so a rerun finds it
  - one delivered answer input
  - `delivered: true`
  - a stale (old-revision) answer rejected
- **Attention race:** acknowledging the old request ID returns `stale` and leaves the newer request in place. Reopen does not re-notify. Acknowledging the exact ID clears it.

### Schema

The upgrade test uses disposable data:

1. Durable 1.3.0 creates a store with pending work and is SIGKILLed.
2. The closed store set (db, WAL and SHM) is copied as a backup and as a working copy.
3. 1.4 opens the copy, migrates the schema from v1 to v2, stays paused, and then recovers the pending 1.3 input.
4. 1.3 refuses the upgraded copy with "schema version 2 is newer than supported version 1".
5. The untouched backup reopens under 1.3 and completes.

Our own task and document versions:

- A v1→v2 task migration resumes with migrated input, and the document migrates.
- A missing definition shows `blocked/missing_task`, is not counted active, and runs once the definition is installed.
- A throwing migration shows `blocked/migration_failed`, emits a `migration_failed` report, and never runs.

### Ownership and storage

**Competing owner and stale endpoint:**

- A second live opener gets `StoreOwnedElsewhere`.
- The dead owner's endpoint is unreachable.
- The next owner's epoch is the previous epoch + 1.
- A client holding the old owner's nonce gets `stale` from the new endpoint.

**Disk full:**

- A real `SQLITE_FULL` comes from capping `max_page_count` at the current size, then admitting a 400 kB input.
- The admission rejects with no acknowledgement; Durable reports `session_failed` and closes.
- After reopen, the input is absent; a same-ID retry admits it exactly once. Integrity stays `ok`.

**Crash-loop parking** (`restartLimit` 3):

- A tool that SIGKILLs its own host ran exactly 3 times and was parked on the 4th open.
- The host sees `blocked/restart_limit`, `wake().active=false` and one `task_parked` report.

**Security:** redaction is covered by spike (b). Partial items:

- **Alias misrouting:** covered offline and in the one live request (see spike a).
- **Duplicate provider refresh:** only half covered. The pilot never refreshes; a refresh attempt is refused with no request sent and the credential file untouched (`test/claude.test.ts`). The real race between an old and a new host refreshing the same login is **not built**; it needs Pi's locked credential store (Phase B).

## Spikes

### (a) Claude subscription on Durable — **feasible**

The adapter (`src/claude.ts`) works as follows:

- pi-ai 1.4.0 already handles Anthropic OAuth tokens: Claude Code identity headers and the system block.
- The pi-claude-code-use 2.2.1 payload rules are re-expressed at pi-ai's public `onPayload` hook: flat custom tool names become `mcp__pilot__<name>`, along with tool_choice, history and the prompt phrases.
- The provider wrapper maps alias calls back to canonical names before Durable executes or stores them.
- Credentials are read-only from Pi's `auth.json`; `modify` (the refresh path) refuses.

**One live request** (`results/claude-spike.json`, `claude-sonnet-5-5`):

- No `ANTHROPIC_*` environment credentials were present or used.
- Exactly 1 request.
- The wire carried the Claude Code identity and the tool alias `mcp__pilot__pilot_echo`.
- HTTP 200 with the `anthropic-ratelimit-unified-*` subscription headers, unified status `allowed`.
- The call was stored and executed as `pilot_echo`, once.
- The run ended through tool `terminate`, with no second request.
- Usage was recorded (613 tokens).
- Neither the access token nor the alias appears in the store.

**Caveat:** that live request sent Pi's reserved `__pi_deferred_placeholder__` tool aliased. 2.2.1 keeps it unaliased as a cache-prefix anchor. This was fixed afterwards and covered offline; it was not re-sent live, because only one request was authorized.

**Not yet shown:**

- MCP and deferred-tool aliases on live traffic
- compaction
- child conversations
- model switching
- display-side prose un-aliasing
- quota and billing reconciliation over time
- refresh coordination with the installed Pi

All of these are Phase B parity items.

### (b) Secret redaction before Durable storage — **feasible, with documented boundaries**

**Mechanism** (`src/redact.ts`):

- **Model output:** a pi-ai Provider wrapper that sanitizes every streamed partial before Durable copies it into `pi.live`. It withholds a trailing token or an unterminated private-key block that could still become a secret, and sanitizes the final and error messages.
- **Tool output:** a tool wrapper whose API proxy sanitizes output chunks (with the same holdback), details and diagnostics (masking secret-shaped trailing fragments), the returned result and thrown error text.
- It reuses the Workbench redactor (`extensions/secret-redaction/redact.mjs`).

**Evidence** (`test/redaction.test.ts`, `results/redaction.json`): a byte scan of every store and work-directory file, which was checked against a control that does find plaintext.

- **Model:** many committed partials while a key and an env credential stream in 1–3-character tokens; a close mid-stream plus reopen; and completion. No partial and no file holds a fragment.
- **Tool:** a key split across 4 output chunks plus details and a diagnostic, and a real bash process printing a key in two writes 200 ms apart. A spy shows that only sanitized text reached Durable, and the store is clean.
- **Sanitizer errors fail closed:** the model response is withheld (`unanswered/model_error`) and the tool call returns a fixed error; nothing raw is stored.
- **Why not hooks:** a throwing `afterTool` hook is reported and skipped by Durable, and the raw result was committed, as demonstrated in the test.

**Boundaries:**

- **Stored verbatim, as with the current extension (shown by test):** tool-call arguments.
- **Stored verbatim, not separately tested:** user input and provider-signed thinking.
- **Bash spill files** are written by the execution environment itself, so a large output can put plaintext on disk outside Durable. This is not exercised; it needs an environment-level wrapper.
- **Leading fragment of a non-patterned env credential:** a details value ending in the first characters of a credential known only from the environment can store that fragment. Secret-shaped prefixes are masked. The production port should take the known-value list from `redact.mjs`.
- **Event deltas:** stream event deltas are blanked; consumers must read sanitized partials.

### (c) FULL vs NORMAL commit latency — **measured** (`results/latency.json`)

Measured on an Apple M4 Pro, macOS 26.5.2, internal SSD; 3 interleaved rounds of 300 commits and 60 faux turns each. Values are p50 / p95 in ms.

| Config | One Durable commit | One scripted turn |
| --- | --- | --- |
| NORMAL | 0.035 / 0.059 | 0.73 / 1.70 |
| FULL | 0.111 / 0.137 | 1.07 / 1.49 |
| FULL + `fullfsync` | 3.99 / 4.93 | 22.95 / 28.08 |

- **FULL is nearly free on macOS** because plain `fsync` does not flush the drive cache. Only FULL + `fullfsync` (F_FULLFSYNC) actually reaches stable storage.
- **The fullfsync cost is small for real use.** Partials commit at most every 100 ms, so 4 ms per commit is about 4% of that interval. About 23 ms per turn is negligible beside model latency.
- **Recommendation for decision 5:** FULL + fullfsync on macOS. `openStore({ fullfsync: true })` is implemented and verified.
- **Pilot default:** the pilot stays at FULL only, as the plan specified, until Thomas decides.

## Further findings

- **SQLITE_FULL surfaces as an AggregateError.** Through chord's Node facade the message is "SQLite transaction failed and rollback failed", wrapping "database or disk is full" and "cannot rollback — no transaction is active". Durable still fails closed, which is correct, but hosts should unwrap `errors` for diagnostics. This could be an upstream note.
- **Any submit or wait resumes the whole store**, as the plan warns. The host must gate every mutating command while restore is paused; a status query is safe.
- **Reconciliation covers model-issued tool calls only.** Unsafe nested calls (`executeTool`) are abandoned by Durable when their caller is not replay-safe, and the pilot does not yet record them as uncertain. The guard blocks per tool name per conversation, which is deliberately conservative.
- **Background subagent example (upstream example 23):** the pattern was compiled against the pinned types, using `output` rather than `content`, and adapted to stable request IDs and a collection document.
- **Not exercised:**
  - power loss or OS crash; a hard kill here is SIGKILL of the host process
  - a genuinely full volume; `SQLITE_FULL` is induced by `max_page_count`
  - upstream Durable's own test suite
  - Linux/systemd

## Revised estimate for Phases B–E

The evidence removes the two Phase A kill risks and **does not raise** any estimate:

| Phase | Estimate | Reason |
| --- | --- | --- |
| B | 7–11 days (was 8–12) | Admission receipts, paused restore, reconciliation, question/attention and child-reporter fixtures exist and are crash-tested. New Phase B work: Pi-locked credential refresh, the fullfsync decision, and nested-tool reconciliation. |
| C | 15–25 days | Unchanged. |
| D | Dropped | Owner decision 3. |
| E | 3–5 days | Unchanged. |

- **Total for B–E:** about 25–41 engineer-days (was 26–42; the plan's 31–50 included Phase A).
- **Contingency:** about 15% (was 20–30%), since the provider and security risks are now spike-proven rather than open.
- **Remaining unknowns that could move it:**
  - live parity of MCP, deferred and compaction aliases
  - retained-host and PTY ownership under launchd
  - the external-package inventory
