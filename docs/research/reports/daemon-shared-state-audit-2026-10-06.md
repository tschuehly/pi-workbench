# Daemon shared-state and lost-wake audit — 2026-10-06

## Needs, changes, result

- **Needs from lead:** none. No live-daemon operation was needed or performed.
- **Changed:** this report only; no runtime code, tests, installed checkout, configuration, or Git history changed. Isolated scratch fixtures were removed.
- **Result:** six blocking findings below. All six mechanisms are confirmed by code and isolated checks; their occurrence in the owner's running daemon is **not verified**. Remediation and production verification remain pending.
- **Target:** `fix/per-session-checkpoint-barrier`, revision [6b694bc](https://github.com/tschuehly/pi-workbench/commit/6b694bc3dc6f6d7abd8072a0d0dd3259e26e0b50) (the per-session checkpoint barrier fix), in the assigned checkpoint-barrier worktree.
- **Scope:** runtime in `extensions/*`, `packages/pi-execution-adapter`, `packages/worker-registry`, `packages/workstream-session-coordination`, and `packages/pi-web-integration`. Tests, acceptance fixtures, and historical evidence were not audited as runtime.

## Ranked blocking findings / issue ledger

| Rank | Priority | Location | Mechanism | Status |
| --- | --- | --- | --- | --- |
| 1 | P1 | `extensions/subagent/completion-wakeup.mjs:55` | Terminal attention is marked handled before delivery; a dropped last wake is never replayed. | Confirmed; fix pending |
| 2 | P1 | `extensions/background-bash/jobs.mjs:90` | Durable `delivered` marker acknowledges queue insertion, not delivery. | Confirmed; fix pending |
| 3 | P1 | `extensions/background-bash/jobs.mjs:94` | Bash completion bypasses the session checkpoint barrier and starts work during compaction. | Confirmed; fix pending |
| 4 | P1 | `packages/pi-execution-adapter/src/index.js:298` | A settled child with a final provider error is reported as success, losing the limit/error diagnostic. | Confirmed; fix pending |
| 5 | P1 | `packages/pi-execution-adapter/src/index.js:280` | Final `get_state` has no deadline; one lost reply strands result settlement and its wake indefinitely. | Confirmed; fix pending |
| 6 | P1 | `packages/worker-registry/src/adapters.js:98` | A crashed lock owner leaves the shared registry permanently busy for every session. | Confirmed; fix pending |

### 1. Dropping the last child-completion message loses attention permanently

**Locations:** `extensions/subagent/completion-wakeup.mjs:45-69`, especially `:55`, and `:24-25`; receipt failures have the same premature dedupe at `:51-52`. Integration re-arms at `extensions/subagent/index.ts:194-199`.

**Why wrong / mechanism:** `notify()` puts each normal completion in `handled` before calling `sendMessage`, including children coalesced behind an existing signal. `rearm()` only clears `queued`; it neither makes undelivered executions eligible again nor emits attention for their outstanding terminal results. Thus the settled-agent backstop prevents *later* children from being muted, but cannot recover the only/last signal. Receipt-failure dedupe similarly survives a dropped send, with no delivery acknowledgement.

**Concrete failure:** while a lead is running a long tool, all its background children finish and their custom steer is queued. A separate owner follow-up is also queued. Promoting that owner follow-up rebuilds the native queue: PI WEB calls `session.clearQueue()` and requeues only the tracked owner messages. The hidden child-completion signal is discarded. On settlement the extension re-arms, but every finished execution is already handled and no new child remains to trigger another wake. Terminal results remain collectable, but automatic attention has stopped.

This is not merely an owner explicitly deleting completion attention: promotion of an unrelated owner message also takes this path.

**Runtime evidence:** installed `dist/server/sessions/piSessionService.js:2524-2539` calls queue replacement for promotion; `:3443-3454` clears the queue and rebuilds it from tracked prompts. Pi `dist/core/agent-session.js:1581-1587` calls `agent.clearAllQueues()`, which includes custom steer/follow-up messages. Custom completion messages are placed directly into the agent queues by `:1494-1500`, rather than recorded in the user-message queue arrays.

**How to show it fails:** create a completion wakeup with a recording sender; notify execution A; discard that recorded signal; call `rearm()`; notify A again. It returns false and emits nothing. A newly finished B can emit, proving the distinction between re-arming future completions and recovering the lost last one. This isolated check passed. The installed queue-clear/promotion call chain was verified by source inspection, not by clicking the live UI.

**Confidence:** confirmed by code and isolated reproduction; live occurrence pending.

**Minimal fix:** retain undelivered terminal attention until `message_start` or explicit collection acknowledges it, and reconcile/reissue pending attention at a safe settlement/resume boundary instead of only resetting `queued`.

### 2. Background bash persists “delivered” before Pi has delivered anything

**Locations:** `extensions/background-bash/jobs.mjs:88-103`; terminal jobs are excluded from ongoing delivery checks at `:107`; reattach attempts delivery at `:173-174` but hits the same marker.

**Why wrong / mechanism:** `deliver()` creates the durable marker before `pi.sendMessage()`. When the lead is streaming, that call only inserts a custom follow-up into an in-memory queue. If the queue is rebuilt/cleared, or the daemon dies before consuming it, the durable job record falsely says delivery happened. Subsequent attaches suppress the only completion notification forever. Synchronous send failure removes the marker, but asynchronous runtime failure cannot be caught here because the extension API returns void.

**Concrete failure:** a long build finishes while the lead runs another tool; its completion is queued and marked delivered. Queue promotion discards the custom follow-up, or sessiond is killed before consuming it. After the same session reopens, its detached job is complete, but `attach()` cannot redeliver the completion. An overnight check or server-expiry result can consequently disappear from the lead's attention even though the log survives.

**Runtime evidence:** Pi `dist/core/extensions/loader.js:280-283` delegates `sendMessage()` without returning a promise. `dist/core/agent-session.js:2397-2404` catches asynchronous send failures and emits a runtime extension error; it does **not** tell the producer to remove its marker. These failures are not completely unlogged, but there is no delivery acknowledgement or recovery. Native queue insertion/clearing is as in finding 1.

**How to show it fails:** under an isolated `$PI_TMP` directory, create one synthetic completed job record and log. Attach a job manager whose sender delegates to the installed Pi `sendCustomMessage()` method with a fake streaming agent. Observe one queued message and an existing `delivered` file. Invoke installed Pi `clearQueue()`, shut down the manager, and attach a new manager to the same session ID. Assert no message is queued and the sender call count remains one. This check passed; no shell job or daemon was launched.

**Confidence:** confirmed by code and isolated reproduction; live occurrence pending.

**Minimal fix:** persist `delivered` only when `message_start` acknowledges this job ID; leave queued/failed sends pending for retry on attach or a safe idle boundary.

### 3. Background bash still breaks checkpoint atomicity

**Locations:** `extensions/background-bash/jobs.mjs:94-99`; compare the checkpoint-aware child path at `extensions/subagent/index.ts:1049-1059`.

**Why wrong / mechanism:** bash completion sends a turn-triggering message directly, without consulting `checkpointBarrier(sessionId)`. The new barrier therefore protects Subagent/Worker completion only. This is a same-session wake race, not another process-global barrier. Pi's custom-message path does not enforce the manual-compaction guard that its user-prompt path enforces.

**Concrete failure:** the lead schedules `compact_and_continue` while a background build is still running. The build completes after the checkpoint is accepted, or while its summary request is in flight. Its follow-up can run before the requested next-phase message; during compaction it can start another model/tool run against the pre-checkpoint context. The claimed phase boundary is no longer atomic, and work can be extended or changed before compaction has finished.

**Runtime evidence:** Pi `dist/core/agent-session.js:1481-1507` routes an idle custom `triggerTurn` straight to `_runAgentPrompt`, with no `isCompacting` check. The normal prompt guard is at `:1226-1227`. Manual compaction keeps its controller active while preparing/summarizing and then replaces finalized context at `:1865-1935`. The `agent_settled` deferral only covers emission of that event, not the subsequent asynchronous summary interval.

**How to show it fails:** open the assigned session's barrier, then attach a synthetic completed bash job. The sender is invoked and the barrier's queued count stays zero. Independently invoke installed `AgentSession.prototype.sendCustomMessage` on a fake idle-but-compacting session: `_runAgentPrompt` is invoked immediately. Both checks passed. Full provider/history corruption was not simulated; the premature turn itself is confirmed.

**Confidence:** confirmed by code and isolated reproduction; production effects beyond premature turn ordering are plausible, not measured.

**Minimal fix:** route bash turn-triggering completion through the existing per-session barrier, keyed by job ID, using the same pattern as `createCheckpointAwareWakeup`.

### 4. Exhausted/quota-failed children are silently converted to successful results

**Locations:** `packages/pi-execution-adapter/src/index.js:225-230`, `:273-299`, especially `:298`.

**Why wrong / mechanism:** the adapter extracts assistant text but drops `stopReason` and `errorMessage`. Any `agent_settled` that answers the binding check is finalized with outcome `success`, including a post-retry assistant with `stopReason: "error"` and an empty body. Settlement is being mistaken for successful execution. The parent does receive a wake, but receives the wrong outcome and loses the provider-limit diagnostic.

**Concrete failure:** an overnight child exhausts provider quota or finishes Pi's retries after a network/API error. Its final assistant message contains the actual error in `errorMessage`, with no useful text. The adapter returns `success` with empty text and no diagnostic; collection renders “Child completed without a text result.” A Worker can also persist a success receipt for this failed assignment.

**Runtime evidence:** installed `@earendil-works/pi-agent-core/dist/agent.js:357-376` creates assistant error/aborted messages with `stopReason` and `errorMessage`. Pi `dist/core/agent-session.js:1116-1135` ends unsuccessful retry sequences without making settlement itself an execution success. `extensions/lead-fallback/fallback.mjs:7` deliberately excludes children from lead fallback when parent-session lineage is present, so that extension does not rescue the child case.

**How to show it fails:** inject an in-memory fake RPC child that answers startup/binding state normally, acknowledges the prompt, emits a final assistant `{stopReason: "error", errorMessage: "synthetic usage limit 429", content: []}`, emits `agent_settled`, and answers final `get_state`. Assert the adapter result is currently `success`, text is empty, and diagnostic is absent. This check passed without spawning Pi or contacting a provider.

**Confidence:** confirmed by code and isolated reproduction; live occurrence pending.

**Minimal fix:** retain the final assistant's terminal stop reason and error diagnostic, and map error/aborted settlement to failure/cancellation rather than unconditional success.

### 5. One missing final RPC response strands a finished child forever

**Locations:** `packages/pi-execution-adapter/src/index.js:254-280`, especially `:280`; unbounded command promise at `:335-368`.

**Why wrong / mechanism:** both settlement paths set `state.completing = true` and await `get_state` without a command deadline. Startup's timeout has already been cleared. The normal settled path also clears the fallback probe timer before awaiting. If the child remains alive but its reply is missing, `result()` never resolves, future settled events are ignored because `completing` is true, and no completion wake reaches the parent.

**Concrete failure:** the child's final output/settled event arrives, but its RPC state reply is lost, malformed, or never produced by a wedged process. It remains in the parent's running roster all night, despite already producing its final answer. A Worker's receipt and heartbeat cleanup remain pending too. There is no need to impose a task-runtime limit to fix this control-message wait.

**Runtime evidence:** installed Pi RPC `dist/modes/rpc/rpc-mode.js:347-365` implements `get_state` as a response-producing control command; no adapter-side retry/deadline is supplied by that runtime. Pi processes keep running until shutdown at `:654-655`. Native process liveness therefore does not bound this adapter promise.

**How to show it fails:** use the same fake RPC child as finding 4 but drop only the post-terminal `get_state` response and keep its streams alive. With a 50 ms startup timeout and 5 ms settlement probe interval, wait 150 ms. Assert result is unresolved, status still says running, `completing` is true, one command remains pending, and there is no settlement timer. This check passed; explicit synthetic cancellation was then used for cleanup. The code has no later deadline, so waiting overnight does not change the state.

**Confidence:** confirmed by code and isolated reproduction; actual missing reply in production is plausible, not observed here.

**Minimal fix:** give settlement `get_state` a bounded control-request deadline with retry/diagnostic, then resolve a safe failure/unknown outcome and notify rather than leaving `completing` latched forever.

### 6. An orphaned registry lock blocks every session indefinitely

**Locations:** `packages/worker-registry/src/adapters.js:54-62`, `:94-104`, especially `:98`.

**Why wrong / cross-session mechanism:** every registry adapter uses the same user-local `.workers.lock` directory. Acquisition records no owner identity or lease, and recovery consists only of waiting five seconds and throwing `STORE_BUSY`. Removal occurs solely in the owning transaction's `finally`. SIGKILL, machine failure, or daemon death after acquisition leaves the directory behind. Every session's new adapter then times out forever, even after restart. This store lock is distinct from `WorkerRegistry.#reclaimDeadLock`, which recovers *dispatch locks inside the database* and cannot acquire this orphaned outer lock to run.

**Concrete failure:** sessiond dies during a Worker heartbeat or completion transaction. On restart, all sessions' `worker_create`, dispatch, inspection, and receipt transactions fail on the same stale directory. Other sessions are blocked by one dead process's leftover shared state; neither retries nor ordinary session reopening repairs it.

**How to show it fails:** create an isolated workers directory containing an orphan `.workers.lock`. Construct two independent `FileWorkerAdapter` instances with a 25 ms lock timeout. Attempt transactions through A, B, and then A again: all reject with `STORE_BUSY`, and the lock remains. This check passed. The fixture represented the post-crash state; no real process was killed.

**Confidence:** confirmed by code and isolated reproduction; live occurrence pending.

**Minimal fix:** record verifiable lock-owner identity and reclaim demonstrably dead owners, or use a native advisory lock that is released on process death; never reclaim merely because a live owner's transaction is slow.

## Runtime verification: what is actually shared

Installed source used: `/Users/tschuehly/.pi-workbench/installed/pi-web-d82b92e8bec7/`; Pi coding-agent **0.87.1**, jiti **2.7.0**.

- `dist/server/sessiond.js:261` constructs one `PiSessionService`. Its `dist/server/sessions/piSessionService.js:528` creates the service's multi-session `active` map. Sessions are in-process SDK runtimes, not one daemon process per lead.
- `piSessionService.js:451-491` creates a fresh event bus/services/runtime for each session; `:3142` binds extensions in **rpc** mode. The event bus is not process-global session communication.
- Pi `dist/core/resource-loader.js:412-441` uses `loadExtensionsCached`. `dist/core/extensions/loader.js:385-419` caches the factory by extension path/current cwd and imports through jiti with `moduleCache: false`. `:444-459` nevertheless invokes the factory again with a new extension API, so **factory-local** `let`/Maps are isolated.
- `moduleCache: false` does **not** isolate native ESM helper modules. Two fresh installed-jiti loaders with `fsCache: false` imported the assigned `checkpoint-barrier.mjs`; the same session ID returned the identical barrier object, and distinct IDs returned distinct objects. This was an isolated memory-only check. Cwd/factory-cache invalidation is not a native ESM state-reset guarantee.
- Pi `dist/core/extensions/runner.js:441-450` invalidates a runner; context getters in `:553-619` subsequently throw via `assertActive()`. Pi `dist/core/agent-session-runtime.js:102-112` runs shutdown handlers before disposal/invalidation. That sequencing matters when evaluating captured timer contexts.
- A custom `pi.sendMessage(..., {triggerTurn: true})` is a void producer API, **not** an acknowledgement of persistence, queue consumption, or a successful model turn. Async failures are emitted to the runtime's error listener; PI WEB publishes them at `piSessionService.js:3143-3147`. Findings above distinguish logged errors from silent queue loss.

## Suspicious items cleared or bounded out

These are not additional blocking findings for the configured daemon.

| Item | What is shared / consequence, and why not a daemon blocker here |
| --- | --- |
| `extensions/agent-audit/audit.mjs:192-236`, `index.ts:50` | **`current()` does not isolate sessions.** It returns the auditing factory's currently open logical request; fetch/WebSocket wrappers match provider URL, not caller identity. A memory-only fake-fetch check attributed caller B's body to A. However `index.ts:135` permits activation only in `tui` inside the checkout, and the daemon binds `rpc`; no daemon session can install these wrappers through the supported command. Cleared for this daemon configuration only, not globally safe. Enabling RPC capture would require request-scoped correlation before removing that guard. |
| Agent-audit wrapper lifecycle/drain | Wrapper restoration marks retained delegates inert and reports conflicts (`audit.mjs:228-239`). Drain is bounded and abandoned tasks are reported (`:242-257`, `index.ts:174-179`, `:274-281`). This is not an unreported overnight wait. Native `.mjs` sharing does not turn factory-local observer state into a single observer. |
| `extensions/pi-tmp/index.ts:10` | The process-environment write is limited to a child-process execution kind; ordinary daemon leads do not write `process.env.PI_TMP`. `extensions/background-bash/index.ts:60` constructs a per-command environment with session-specific `PI_TMP`. Native child bash inherits the environment of its separate child Pi process. `pitmp.mjs:9` caches project keys by cwd, not one current session directory. |
| `extensions/secret-redaction/redact.mjs:41-69` | Auth/known-regex caches really are native-module shared, but contain process credential/environment-derived data, not session context. Auth key includes path/mtime/size; regex key is recomputed from source values. Reads/replacements are synchronous, with no async interleaving around mutable regex state. No credential bodies or values were printed. This is not a claim about separate custom per-session credential directories supplied outside the process environment. |
| `extensions/background-bash` job ownership/timer contexts | Job map/timer/status closures are created inside each factory/manager; registry attachment filters on session ID (`jobs.mjs:163`). Commands clone environment rather than changing daemon environment. The captured RPC status context is disposed through `jobs.shutdown()` at extension shutdown (`index.ts:107`, `jobs.mjs:215-219`) before runner invalidation. No confirmed stale-context timer failure found in that normal lifecycle. Delivery and checkpoint exceptions are findings 2–3. |
| Background bash 12-hour default | It is explicitly documented in `index.ts:44-49`; an explicit command timeout can select a different expiry (`jobs.mjs:137`). `runner.mjs:27-30` writes an error exit record **before** killing the group. Attached watchers turn that record into a failed completion wake, and unattached sessions reattach later. The limit itself is not a silent death; a dropped delivery is covered by finding 2. No 12-hour real-time run was performed. |
| `extensions/working-mode/index.ts:127-133` | Selected/applied/aligned/queued state is factory-local; cached factory invocation does not share it. Its queued state is cleared at `agent_end:180`. Mode data reaches its own event bus/UI. No second process-wide Working Mode selection found. This clearance is about cross-session state, not proof of every queue-clear timing case. |
| `extensions/tool-groups/index.ts:11-16` | Enabled groups, Workers mode and snippet are factory-local. `pi.get/setActiveTools` uses that session's runtime; the Working Mode subscription is on that session's event bus. Shared `groups.mjs` exports are definitions, not a current-session singleton. |
| `extensions/telemetry/index.ts:15-17`, `telemetry.mjs:10-33` | Current ID/delivery dedupe are factory-local, marker keys also include session ID, and each factory creates its own recorder/file UUID/descriptor. Closing A's recorder does not close B's. The execution bus is per session. Reporting maps are function-local. |
| `extensions/activity/index.ts:5`, `activity.mjs:23-26` | Surface, item map and UI attachment are created per factory; activity events use the session event bus. A's dispose does not clear B's activity. Shared kind/icon definitions are not mutable session state. |
| `extensions/lead-fallback/index.ts:7` | `lastAssistant` is factory-local, not one process-wide final assistant. Model/effort changes route through the session runtime. Children deliberately defer routing fallback to their own execution path; that does not fix finding 4. |
| `extensions/quota-startup/index.ts:12-14` | Automatic startup repair is TUI-only; RPC daemon sessions do not park on its confirmation. Explicit quota command requires UI and owner confirmation; subprocesses have 30 s/180 s deadlines. Its shared module constants describe paths/arguments, not one session's pending request. |
| `extensions/context-checkpoint/checkpoint-barrier.mjs:74-81` | The fixed native-module map is explicitly keyed by session ID; the isolated jiti check confirmed A and B no longer share a barrier. `dispose()` returns it to idle rather than leaving a permanent disposed latch. The process-lifetime idle entries are retention overhead, not a wake collision. |
| Subagent timers, shutdown, collection | Adapter/launch/collection maps and completion wakeup are per factory. Shutdown first mutes wakes, cancels children and awaits completion handlers (`index.ts:201-206`); foreground progress timers are cleared on settlement/detach (`:904-919`). The normal attention rearm for *new* children works; finding 1 concerns undelivered existing children. |
| Worker identity/dispatch locks | Registry records enforce owner session ID (`registry.js:169-174`) and use per-dispatch UUID tokens. A live daemon PID is not used as session identity. A receipt failure emits separate unknown-outcome attention and collection preserves the failure. None of that recovers the file-level crash lock in finding 6. |
| `packages/workstream-session-coordination/src/index.js:4` | The process-global in-flight set is keyed by producer/operation token, not a single queued flag; `launch():44-54` releases in `finally`. Durable association operation tokens are intentionally consumed identities, with unknown launches retained for reconciliation rather than blindly retried. Ordinary distinct sessions/operations do not collide. Host-operation deadline behavior was not exhaustively verified. |
| PI WEB integration server singleton | `workstream-service.js:3-5` intentionally shares the user-local authoritative Workstream Store across sessions; requests name Workstreams and use store revision/idempotency semantics. There is no current-session pointer in that singleton. The separate Store's internals were not audited beyond checks needed to interpret coordination. |
| `packages/pi-web-integration/pi-web-plugin.js:10-15` | Projection/inventory caches, conflict/start sets, client and connected element are browser-realm state, not daemon extension-module globals. Workstream inventory is intentionally shared within the owner's one shell; conflict/start sets are operation/Workstream keyed. This does not certify every browser cache key, multi-activation or multi-element case; see exclusions. |
| `globalThis`, prototype and process-handler scan | The transport observer is the substantive fetch/prototype mutation in scoped daemon-extension code. View-model prototype calls are read-only inspections. No scoped runtime `process.on`/`process.once` session handler was found; signal handlers in acceptance scripts were excluded. Command environment changes in adapter/background bash are child-env copies, not writes to daemon `process.env`. |

## Checks executed and limits

### Executed locally, without the daemon

1. Inspected the fixed revision's diff and clean starting tree; searched the complete scoped runtime inventory for module-level mutable collections, globals/prototype patches, environment writes, process handlers, timers, send paths, dedupe, and queue flags.
2. Read the implicated runtime implementations and callers end to end, plus installed Pi/PI WEB loader, factory/event-bus, queue, compaction, runner invalidation, RPC response and error-publication paths.
3. Imported the barrier through two fresh installed-jiti loaders with caching disabled: native helper sharing and session-ID separation confirmed.
4. Used fake transport globals entirely inside a short-lived Node process: audit caller misattribution confirmed, then globals restored; no network was used.
5. Exercised installed Pi custom-message and queue-clear methods with in-memory fake sessions: premature compaction turn and loss of queued custom messages confirmed.
6. Used isolated completed-job fixtures and two independent Worker adapters under `$PI_TMP`: durable lost delivery and orphan lock confirmed; fixtures deleted.
7. Used fake RPC streams, not real child processes: final provider error reported as success and unbounded post-terminal control wait confirmed; fake execution cancelled for cleanup.

### Not checked / no guarantees claimed

- No calls against the live daemon, session socket, production sessions, real job registry, provider accounts or UI; no live process was started, restarted, signalled or killed.
- No production incident-log attribution, full provider/model loop, browser promotion click-through, overnight soak, daemon crash injection or real 12-hour expiry run.
- External packages such as `pi-goal`, `pi-process-monitor`, `pi-mcp-adapter`, and `pi-claude-code-use` were not audited. Their independent watchers/timeouts/global state remain outside this assignment; presence of lazy group definitions is not verification of those packages.
- No full repository test suite, test-source review, graphical/visual inspection, or exhaustive review of all rendering/DOM/preferences paths in the large browser integration module. Browser multi-activation, cache-key completeness and pending host-request cancellation were not certified.
- No exhaustive security/authentication/redaction review, separate-agent-dir multi-tenant SDK configuration, PID reuse recovery analysis, or filesystem adversary/crash-consistency campaign.
- No fresh-reader review of the written report: a reviewer/delegation tool was unavailable. The report received author self-review against the source anchors.
- No fixes applied. The ranked issue ledger records diagnosis/isolated confirmation only; remediation, regression tests and live verification remain pending.
