# Pi Durable Phase A — pilot results

**Every matrix row passes on the published `@earendil-works/pi-durable@1.4.0`, under the approved storage default (WAL + `synchronous=FULL` + `fullfsync=ON`), including queued-item edit and concurrent credential refresh, built after Thomas's decision.** **Neither kill criterion fired:** Claude subscription access and pre-persistence redaction both work through public seams, with no fork or private patch, within the open boundaries listed under spike (b).

An independent review (openai-codex/gpt-6.1-sol) found four blockers in the first version of this pilot. All four are fixed test-first; see [Review fixes](#review-fixes). The whole matrix and the latency spike were rerun afterwards. The two remaining rows were then built test-first; see [Completing Phase A](#completing-phase-a).

Open for the owner before Phase B:

1. **Queued-item edit has known limits** (see [Queued input](#queued-input)): it rebuilds the queue tail, refuses when a queued write follows the item, and cannot reorder an item a run already placed.
2. **Credential refresh is proven offline only**, against a fake OAuth endpoint, with the installed Pi's credential-store code as the stand-in. No real refresh was sent.
3. **Open redaction boundaries:** bash spill files, leading fragments of env-only credentials, and unsafe nested tool calls (see spike b and Further findings). **Closed in Phase B slice 2** (`test/redaction-boundaries.test.ts`, each with a positive control; red before the fix in `results/red-before-slice2.txt`).

Scope: Phase A of [the rebuild plan](../../docs/plans/pi-durable-rebuild.md), approved 2026-10-22. This is a headless pilot only. No Workbench, PI WEB, installed checkout or service changed.

## Rerun

```bash
cd packages/durable-pilot
npm run setup                 # exact pins from both lockfiles (pilot 1.4.0, disposable legacy 1.3.0)
npm run typecheck             # compiles the pilot against the pinned 1.4.0 types
npm run test:matrix           # crash matrix: 20 iterations per fault window, each in kill and close mode (~3.5 min)
npm run test:spikes           # redaction spike and offline Claude-adapter tests
npm run latency               # NORMAL vs FULL vs the default FULL+fullfsync → results/latency.json
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

- **One owned store.** It uses SQLite WAL with `synchronous=FULL` and `fullfsync=ON` (plus `checkpoint_fullfsync=ON`) through the public `NodeSqliteDatabase` facade. That is the default for every host. Every pragma is verified on open, before Durable reads, and a mismatch refuses the store. Only the latency script opts out, for comparison rows.
- **Owner-only files.** The family directory is created 0700 before anything else; the database is created 0600 before SQLite opens it, so `-wal` and `-shm` inherit 0600; the host sets umask 077 so work and spill files are owner-only too.
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
| Queued input | `queue.mid-commit`, `queue.after-commit`, `queue.changed-payload`, `queue.order`, `queue.failed-run` | **pass** (5 × 40/40) | See [Queued input](#queued-input). |
| Queued input — item edit | `queue.edit-receipt`, `queue.edit-withdrawn`, `queue.edit-readmitted` | **pass** (3 × 40/40) | Withdraw + re-admit under stable IDs; see [Queued input](#queued-input). |
| Unanswered question | `question.before-commit`, `question.after-commit`, `question.answer-undelivered`, `question.delivered-unacked`, `question.attention-race` | **pass** (5 × 40/40) | See [Questions and attention](#questions-and-attention). |
| Schema upgrade/rollback | `schema.upgrade-rollback` (20/20); `schema.task-doc-upgrade`, `-missing`, `-failed` (3 × 40/40) | **pass** | See [Schema](#schema). |
| Ownership/storage/security | `ownership.competing-owner` (20/20), `ownership.disk-full` (40/40), `ownership.crash-loop-parking` (20/20), `ownership.store-files` (1/1), `ownership.default-pragmas` (1/1); redaction in spike (b); alias misrouting in `test/claude.test.ts` | **pass**, with the open redaction boundaries of spike (b) | See [Ownership and storage](#ownership-and-storage). |
| Ownership — concurrent credential refresh | `ownership.concurrent-refresh` (20/20), control `ownership.concurrent-refresh-control` (1/1) | **pass** | Pi's auth.json lock protocol; see [Ownership and storage](#ownership-and-storage). |

All 1,160 evidence lines that report the verify host's pragmas show `synchronous` 2, `fullfsync` 1 and `checkpoint_fullfsync` 1. The other 203 lines (schema, competing-owner, parking, the two store tests and the credential race) do not record pragmas; their hosts open with the same default.

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
- **Edit** (`editQueued` in `src/host.ts`). Durable has no edit and places queued inputs in ID order, so an edit works like this:
  1. One commit records a receipt under the edit ID: the item and every input queued after it, with their new operation IDs `<editId>#<n>`.
  2. The items are withdrawn in queue order, the edited one first. If it was already placed, the edit fails with `EditTooLate` and nothing else is touched.
  3. The items are re-admitted in order through `admit()`, the edited one with its new text, and the receipt is marked done.
  4. The caller acknowledges only after that. A retry under the same edit ID is a no-op or finishes the edit; `resume()` finishes an interrupted edit before scheduling.
- **Edit crash windows**, each 20 × kill and 20 × close, with steer-1, follow-1, follow-2 and follow-3 queued behind a held tool and follow-2 edited: after the receipt (before the withdraw commit), after the withdraw (before re-admission), and after re-admission (before the acknowledgement).
  - `resume()` had finished the edit before the client retried, in all 120 iterations.
  - The transcript and the model requests read `call:wait_tool, steer-1, follow-1, follow-2 edited, follow-3`: the edited message once, the original never, the order kept.
  - The original operation ends `unanswered/aborted`; the edited and moved items answer.
- **Edit limits:** an edit moves every input queued behind the item to new operation IDs (returned as `moved`). It refuses when a queued write follows the item. A later item a run places during the edit stays ahead of the edited one. Mapping queue entries back to operation IDs scans the conversation's admissions, which needs an index at scale.

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

**Store files and pragmas:**

- A new family under umask 022, inside a 0755 ancestor, comes out with the directory and `work/` at 0700 and the database, WAL, `owner.json` and a spill-style work file at 0600 (`ownership.store-files`). No `-shm` exists: with EXCLUSIVE locking, SQLite keeps the WAL index in heap memory. The test checks `-shm` too whenever it is present.
- A host opened with no options runs `journal_mode=wal`, `synchronous=2`, `fullfsync=1`, `checkpoint_fullfsync=1` on its live connection (`ownership.default-pragmas`).

**Security:** redaction is covered by spike (b), with its open boundaries.

- **Alias misrouting:** fixed. Colliding names get distinct, reversible aliases (see spike a).
- **Concurrent credential refresh:** pass (`test/credentials.test.ts`).
  - **Lock protocol:** the installed Pi (pi-coding-agent 1.0.4) exposes no public credential-store API, so `PiAuthStore` (`src/claude.ts`) ports its `FileAuthStorageBackend.withLockAsync` exactly. That means proper-lockfile 4.1.2 on `auth.json` itself, with `realpath: false`, `stale` 30 s, `retries` 0 and the same jittered backoff. It reads, changes and writes in place under the lock, using mode 0600 on creation. pi-ai re-checks expiry inside `modify`, so a process that gets the lock after a refresh just uses the new token.
  - **Race:** each iteration has two pilot host processes, each running a real Durable turn through `PiAuthStore`, and a stand-in for the installed Pi. The stand-in is Pi's own `AuthStorage`, loaded from the installed package's `dist/core/auth-storage.js` behind pi-ai `Models`. All three start on one signal against an expired login. A fake OAuth endpoint rotates refresh tokens and rejects a reused one, and every other network call is blocked.
  - **20/20 iterations:**
    - exactly 1 refresh request and 0 rejected
    - all three processes end with the issued access token, and both hosts' blocked Messages requests carried it
    - auth.json holds the rotated refresh token, keeps the other provider's entry, stays 0600, and no lock is left behind
    - a concurrent reader using the same lock saw 0 torn reads
  - **Positive control:** the same race without the lock sent 3 refresh requests; 2 were rejected for the reused refresh token.
  - **A failed refresh** (endpoint 500) ends the turn `unanswered` with no model request and auth.json byte-identical (`test/claude.test.ts`).
  - **Tokens:** they never leave auth.json; evidence holds only sha256 prefixes of fake tokens.

## Spikes

### (a) Claude subscription on Durable — **feasible**

The adapter (`src/claude.ts`) works as follows:

- pi-ai 1.4.0 already handles Anthropic OAuth tokens: Claude Code identity headers and the system block.
- The pi-claude-code-use 2.2.1 payload rules are re-expressed at pi-ai's public `onPayload` hook: flat custom tool names become `mcp__pilot__<name>`, along with tool_choice, history and the prompt phrases.
- The provider wrapper maps alias calls back to canonical names before Durable executes or stores them.
- Aliases never collide. As in 2.2.1's `reserveAliasName`, a name whose sanitized alias is already taken (`review-deploy` vs `review_deploy`, case, truncation) gets a `_2`, `_3`… suffix. A tool registered under a name already handed out as an alias fails the request.
- Credentials live in Pi's `auth.json` and are refreshed under Pi's own lock protocol (see [Ownership and storage](#ownership-and-storage)). The one live request ran earlier with the read-only store and needed no refresh.

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
- a real refresh against Anthropic's endpoint (coordination with the installed Pi is shown offline)

All of these are Phase B parity items.

### (b) Secret redaction before Durable storage — **feasible, with documented boundaries**

**Mechanism** (`src/redact.ts`):

- **Model output:** a pi-ai Provider wrapper that sanitizes every streamed partial before Durable copies it into `pi.live`. It withholds a trailing token or an unterminated private-key block that could still become a secret, and sanitizes the final and error messages.
- **Tool output:** a tool wrapper whose API proxy sanitizes output chunks (with the same holdback), details and diagnostics (masking secret-shaped trailing fragments), the returned result and thrown error text.
- **Holdback:** a trailing token, an unterminated private-key block, and an opening PEM header still being written (it contains spaces) are held until they can no longer grow.
- **`retainedOutput()`** never flushes the held tail. The tool sees the committed text plus the tail masked (`[REDACTED:partial]`); nothing is committed early.
- **Text that will not grow** (the final model message, the last tool flush, the result) has any unterminated private-key block masked to its end.
- It reuses the Workbench redactor (`extensions/secret-redaction/redact.mjs`).

**Evidence** (`test/redaction.test.ts`, `results/redaction.json`): a byte scan of every store and work-directory file, which was checked against a control that does find plaintext.

- **Model:** many committed partials while a key and an env credential stream in 1–3-character tokens; a close mid-stream plus reopen; and completion. No partial and no file holds a fragment.
- **Tool:** a key split across 4 output chunks plus details and a diagnostic, and a real bash process printing a key in two writes 200 ms apart. A spy shows that only sanitized text reached Durable, and the store is clean.
- **Split PEM header and mid-token `retainedOutput()`:** a tool streams a key whose opening header is split at a space (then a second key cut off before END); another reads its retained output between two token fragments. Unwrapped (positive control) both secrets appear in committed LiveDoc output and in `session.sqlite`; wrapped, neither does, and the retained output it read is masked.
- **Sanitizer errors fail closed:** the model response is withheld (`unanswered/model_error`) and the tool call returns a fixed error; nothing raw is stored.
- **Why not hooks:** a throwing `afterTool` hook is reported and skipped by Durable, and the raw result was committed, as demonstrated in the test.

**Boundaries:**

- **Stored verbatim, as with the current extension (shown by test):** tool-call arguments.
- **Stored verbatim, not separately tested:** user input and provider-signed thinking.
- **Bash spill files** were written by the execution environment itself. *Slice 2:* `redactingTool` gives tools an environment that runs without the raw spill and writes the sanitized stream to its own owner-only spill file.
- **Unsafe nested tool calls** were not recorded as uncertain. *Slice 2:* `reconcileOnOpen` records nested calls in their execute phase; the guard blocks a fresh call.
- **Leading fragment of a non-patterned env credential** in a details value. *Slice 2:* details and diagnostics mask a trailing leading-fragment (6+ characters) of any known value from `redact.mjs` `knownValues()`.
- **Event deltas:** stream event deltas are blanked; consumers must read sanitized partials.

### (c) FULL vs NORMAL commit latency — **measured** (`results/latency.json`)

Rerun after the review fixes. Measured on an Apple M4 Pro, macOS 26.5.2, internal SSD; 3 interleaved rounds of 300 commits and 60 faux turns each. Values are p50 / p95 in ms. The default row opens the host with no storage options, as every host does; its recorded pragmas show `fullfsync` 1.

| Config | One Durable commit | One scripted turn |
| --- | --- | --- |
| NORMAL (comparison) | 0.044 / 0.104 | 0.96 / 1.95 |
| FULL (comparison) | 0.133 / 0.232 | 1.44 / 2.49 |
| FULL + `fullfsync` (**default**) | 4.88 / 5.96 | 27.0 / 34.0 |

- **FULL is nearly free on macOS** because plain `fsync` does not flush the drive cache. Only FULL + `fullfsync` (F_FULLFSYNC) actually reaches stable storage.
- **The fullfsync cost is small for real use.** Partials commit at most every 100 ms, so about 5 ms per commit is about 5% of that interval. About 27 ms per turn is negligible beside model latency.
- **Decision 5 (Thomas):** FULL + fullfsync. It is now the default for every host and verified on open; the crash matrix above ran under it.

## Review fixes

The review reproduced four blockers. Each now has a test that failed on `b1773c1` (red output in `results/red-before-fix.txt`) and passes after the fix.

| Blocker | Fix | Test | Red on `b1773c1` |
| --- | --- | --- | --- |
| 1. Streamed tool output reached storage unredacted | `src/redact.ts`: hold back a partial PEM header; `retainedOutput()` no longer flushes; seal unterminated keys | `test/redaction.test.ts` "split PEM headers and retained-output reads" | PEM body, PEM tail and key-tail fragments in committed LiveDoc output |
| 2. Claude aliases could run the wrong tool | `src/claude.ts`: collision-free, reversible aliases (`_2` suffix) | `test/claude.test.ts` "colliding tool names get distinct, reversible aliases" | the `review-deploy` alias ran `review_deploy` |
| 3. Store files not owner-only | `src/host.ts`, `src/store.ts`: 0700 family dir first, 0600 database before SQLite opens it, umask 077 | `test/ownership-storage.test.ts` "a new family under umask 022" | family 755, WAL 644, `work/` 755 |
| 4. Approved storage config not the default | `src/store.ts`: FULL + `fullfsync` + `checkpoint_fullfsync` by default, verified on open | `test/ownership-storage.test.ts` "every host opens with WAL + synchronous=FULL + fullfsync=ON" | `fullfsync` 0, `checkpoint_fullfsync` 0 |

After the fixes, `npm run setup && npm test` passed: 63/63 matrix tests and 11/11 spike tests. `results/summary.md` was generated from the working tree just before the fix commit, so its header names the parent commit.

## Completing Phase A

Thomas then decided to build the two missing checks. Both tests were written first and failed on `55bb26a`, because the features did not exist (`results/red-before-5-6.txt`). Afterwards `npm run setup && npm test` passed: 71/71 matrix tests and 11/11 spike tests.

| Check | Implementation | Tests | Evidence |
| --- | --- | --- | --- |
| 5. Queued-message edit across a crash | `editQueued`, receipt document `pilot.edits`, roll-forward in `resume()` (`src/host.ts`) | `queue.edit-*` windows in `test/children-queue-questions.test.ts` | `results/evidence/queue.edit-*.jsonl`, 6 × 20/20 |
| 6. Concurrent Claude credential refresh | `PiAuthStore` on Pi's auth.json lock protocol (`src/claude.ts`; adds `proper-lockfile` 4.1.2, the version Pi pins) | `test/credentials.test.ts`, `test/refresher.ts`; failed-refresh case in `test/claude.test.ts` | `results/evidence/ownership.concurrent-refresh*.jsonl`, 20/20 plus control |

`host.resume()` is now async, because it rolls interrupted edits forward before scheduling.

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
| B | 7–11 days (was 8–12) | Admission receipts, paused restore, reconciliation, question/attention and child-reporter fixtures exist and are crash-tested. New Phase B work: wiring the queued-item edit and the locked credential store into Workbench, nested-tool reconciliation, and the open redaction boundaries. |
| C | 15–25 days | Unchanged. |
| D | Dropped | Owner decision 3. |
| E | 3–5 days | Unchanged. |

- **Total for B–E:** about 25–41 engineer-days (was 26–42; the plan's 31–50 included Phase A).
- **Contingency:** about 15% (was 20–30%), since the provider and security risks are now spike-proven rather than open. The review's four blockers were fixed within Phase A; the open redaction boundaries remain Phase B work.
- **Remaining unknowns that could move it:**
  - live parity of MCP, deferred and compaction aliases
  - retained-host and PTY ownership under launchd
  - the external-package inventory

## Phase B slice 3 group B: context and tools

Test-first in `test/context-tools.test.ts` (part of `npm run test:chat`); red runs in `results/red-s3b-*.txt`.

- **Compaction** (`chat-session.ts` `compact`, `chat.ts` `DEFAULT_COMPACTION`): `/compact [instructions]` runs Durable's manual compaction. Automatic compaction uses Pi's settings from PI WEB (`configure` `compaction`), with Durable's background compaction off (Pi has none). The summary shows as Pi's `Compacted history` row, and the full history stays visible after reopen. `isCompacting` comes from `pi.live`. The Working Mode block is attached again after compaction. A kill while summarizing reruns that summary once. The summary is redacted by the provider wrapper. The `/compact` instructions are redacted before they become task input.
- **`compact_and_continue`** (`checkpoint.ts`): the tool rejects sibling batches. It schedules a background checkpoint task that waits for idle, creates the compaction in the same commit as its phase change, waits until the summary is placed, and then submits one continuation under a stable request ID, with the Working Mode block. A failed compaction continues once with its diagnostic. Esc during compaction records a visible cancellation and starts nothing. Kill rows: after the tool result, while summarizing, and after the continuation.
- **Tool groups** (`tool-groups.ts`): group tools are Durable `deferred`. `tools_enable` loads them with `control.addTools`. An enabled-group document records the choice, and Orchestration Workers shows the workers group. Exposure survives restart and compaction. Nested calls to a group tool that is not enabled are blocked. A child's allowlist is never widened. Goal tools wait for pi-goal (slice 5).
- **grep/find/ls** (`search-tools.ts`): Pi's own tool definitions (`@earendil-works/pi-coding-agent@1.4.0`), bound to Durable. They are deferred for the lead, as in legacy, and available to allowlisted children. Output is identical to Pi's and redacted before commit.
- **Capabilities:** `ready.capabilities` = `compact`, `compact-and-continue`, `tool-groups`.
- **MCP:** dropped by the owner's scope trim. PI WEB refuses MCP sign-in for Durable Chats visibly.

## Phase B slice 4: OpenAI and Copilot providers (P016, P137)

Durable Chats offer the model catalog of a legacy Chat: every provider with a stored login in Pi's `auth.json` (Claude, ChatGPT via `openai-codex`, GitHub Copilot), with Pi's refreshed catalog (`models-store.json`, read-only) merged as pi-ai merges it. On the s4o trial against the real agent profile, the Durable catalog equals the legacy catalog (49 models: anthropic 17, openai-codex 9, github-copilot 23) plus the trial-only `faux/faux-1`.

- **Credentials:** the same `PiAuthStore` (Pi's lock on `auth.json`, `realpath: false`); no login flow, no second format. `COPILOT_GITHUB_TOKEN` is removed like `ANTHROPIC_*`, so only stored logins count. A provider without one is not listed, and `setModel` refuses it visibly.
- **Switching:** across providers mid-Chat, with the whole conversation; the Chat's thinking level is clamped to the new model (pi-ai `clampThinkingLevel`, as Pi's `setModel`), and each provider maps it on the wire (Codex `minimal` → `low`).
- **pi-openai-fast-mode 0.5.0:** ported (`src/providers.ts`): `/fast [on|off|toggle]` writes the package's own config file (workspace file first, else the user file); `service_tier: "priority"` only for the package's targets; status `pi-openai-fast-mode: fast`. The `--fast` CLI flag has no PI WEB equivalent.
- **Redaction:** both providers sit behind `wrapProvider`; positive control red before wiring (`results/red-before-s4-openai.txt`).
- **Concurrent refresh:** `test/refresh-race.ts` (shared with `credentials.test.ts`) races two hosts and the installed Pi on an expired ChatGPT login: one refresh request; the unlocked control sends more than one.
- **Live:** one ChatGPT request (`gpt-6-astra`, Fast Mode on via the trial workspace's config), answered and stored with usage; no Claude request.
- **Not here:** the enabled-model scope (P017) and the thinking-level setter (P019) are slice 3; the Durable catalog marks every model enabled.

## Phase B slice 4 group A: Subagents and Workers (P089–P099)

Native child conversations (`src/delegation.ts`), test-first in `test/delegation.test.ts` (part of `npm run test:chat`, 21 tests). Red evidence and negative controls are kept in Workstream scratch `s4a-evidence/`.

- **Rules are the legacy extension's:** profiles, allowlists, Cognitive Roles, bounded collection (`extensions/subagent/core.mjs`, now shared by both runtimes) and routing (`resolve-runtime-binding.mjs`, with the host's own catalog: the models with a stored login). Independence, `excludeFamilies`, `modelOverride` and effort floors behave as in legacy; the receipt names the model, effort and selected family.
- **One assignment = one child conversation** owned by a background anchor task; a background reporter admits the assignment (`assignment:<id>`), records the one result (bounded at 8,000 characters with the remainder disclosed), and wakes the lead (`wake:<n>`, coalesced while a wake is queued). Children get exactly their profile's tools (`tools` and `modelTools`), their own `PI_SESSION_ID`/`PI_TMP` (`<chat>:<conversation>`), telemetry (`execution.launched`/`settled`, child usage) and the provider adapters.
- **Workers:** a session document owned by the lead conversation; each dispatch is a fresh binding in a child conversation forked from the previous one (continuity); lock, result and receipt commit together; a coordinator settles only after its leaves end and are collected; lead → Worker → leaf.
- **Cancel:** a cancellation epoch commits before anything is aborted; Worker cancel reaches its leaves; a leaf cancel leaves the Worker running; termination not confirmed within 15 s is `outcome_unknown`. Cancellations a restart interrupted finish on resume.
- **Checkpoint barrier:** a completion during `compact_and_continue` waits for the checkpoint and queues behind its continuation.
- **Kill rows:** before admission, after the child's result, before and after delivery, after collection, after a cancellation's epoch: one assignment, one model request, one wake, one collection; status reads send nothing. After a SIGKILL a credential read of the dead host may hold Pi's `auth.json` lock for up to its 30 s stale period.
- **Fork rule:** delegation records are `fork: initial`; Worker control is by owning conversation, so a fork controls none of the source's Workers.
- **Tests and trials only:** `--scripted-providers` (or `PI_DURABLE_SCRIPTED_PROVIDERS=1`) answers the Claude, ChatGPT and Copilot models with the scripted model; `PI_DURABLE_HOLD` names reporter barriers.
- **Deferred:** `spawn_session`/`spawn_subsession`, the background shortcut, and re-sending a wake a Stop withdrew (the roster keeps showing the result as "To collect").
