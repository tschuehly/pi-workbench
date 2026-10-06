# Seamless promotion

**Recommendation: preserve live agent runtimes in independent, revision-pinned session-host processes; restart only their replaceable sessiond connection.** Pi Durable is real and useful for crash recovery, but it does not preserve an ordinary in-flight model stream or arbitrary tool process. Adopting it is a harness migration, not a promotion fix.

Status: proposed design, 2026-10-06. No implementation or runtime acceptance test performed.
Owner goal: “I want to be able to promote without stopping all sessions and stopping all workers and subagents. They should seamlessly continue.”

## Meaning and assumptions

For this design, “seamless” means an admitted lead turn and its Subagents and Workers keep executing through promotion: no cancellation, replayed side effect, duplicate dispatch, lost completion, or manual resume. The browser may reconnect and reconstruct its current view. This is stronger than “the transcript survived” or “the interrupted assignment eventually resumed.” The owner did not explicitly require the same provider connection; the proof below uses that stronger test to demonstrate uninterrupted execution. Automatic recovery remains an option, not an equivalent guarantee.

- Promotion may leave existing sessions on their original revision; new sessions use the promoted revision. Replacing code inside an already executing JavaScript stack is not promised. Expose both revisions rather than reporting every session as upgraded.
- Preserve current attended ownership and explicit cancellation. A transport restart is not a session shutdown. This introduces no Run Controller authority or permission for unrelated unattended work.
- Target the owner's macOS/launchd deployment first. Linux/systemd needs separate lifecycle proof: a new process group does not escape a service cgroup. Host reboot, runtime crash and provider failure are separate recovery problems.
- Existing native SDK JSONL and Workbench extension behavior remain supported. Pi Durable's “Session,” “run” and “task” are library terms, not Workbench Runs or Dispatch authority.

## What ends today, and why

Analysis uses the Workbench [base revision][wb-base] and PI WEB fork [base revision][web-base], not a claim about every currently loaded session. The SDK in the requested installed [PI WEB build `5b4810a1`][installed-build] was inspected read-only: it contains `pi-agent-core`, `pi-ai`, `pi-coding-agent`, and `pi-telemetry` at 1.0.0, **not `pi-durable` or `chord`**. PI WEB's lock also selects coding-agent 1.0.0. The integration checkout's `node_modules` was older (0.87.1), so SDK mechanics below were checked against the published 1.0.0 package and the requested installed copy, not inferred from that stale dependency tree. The installed agent-session file has local differences; its persistence and shutdown paths were checked separately.

### Promotion and runtime ownership

1. Full promotion calls `stop_all`: bootout `web` and `sessiond`, then TERM remaining listeners on the PI WEB ports/socket. It repoints links and runs `pi-web install`; rollback uses the same destructive stop path. See [`scripts/promote-installed:175–234`][w-switch].
2. sessiond handles SIGTERM/SIGINT by quiescing ingress, cancelling plugin lifetimes, stopping plugins, disposing sessions and closing the server. It does **not** wait for ordinary turns to finish: [`sessiond.ts:134–146,397–425`][p-sessiond] and [`sessionDaemonShutdown.ts:27–45`][p-shutdown].
3. **Lead agents run in-process**, not one Pi child per Chat. `createAgentSessionRuntime` and `createAgentSessionFromServices` construct SDK objects inside `PiSessionService`; `active` holds them in a Map. Binding `mode: "rpc"` supplies extension semantics, not process isolation: [`piSessionService.ts:773–780,1046–1090,1191,4161–4182`][p-sessions]. PI WEB's own subsessions also route through this service; distinguish them from Workbench's subprocess Subagents.
4. Disposal clears live queues, asks, notifications and subsession tracking, calls `session.abort()`, then `runtime.dispose()` for every active runtime: [`piSessionService.ts:1479–1524,3791–3810`][p-sessions]. SDK runtime disposal emits `session_shutdown` before disposing the agent: [`dist/core/agent-session-runtime.js:296–303`][sdk-runtime].

| Work or state | Restart outcome and evidence |
| --- | --- |
| Lead model stream; compaction and branch-summary request | Aborted by session teardown; network connection and JavaScript continuation do not survive. SDK `abort()` cancels retry/compaction/summary and the agent; disposal also cancels shell work. [`agent-session.js:977–995,1873–1884`][sdk-session] (published 1.0.0 line numbers). |
| Native tool calls and user-shell commands | In-process calls lose their runtime; completed external effects are **not undone**. Native bash attaches an abort listener that kills its process tree, even though its shell is itself spawned detached. [`tools/bash.js:47–121`][sdk-bash]. A request may have changed a file or remote service before its result was persisted. |
| Workbench Subagents and Worker dispatches | Explicitly cancelled by `session_shutdown → adapter.cancelAll()`, then RPC abort, TERM and KILL escalation, with process-group signalling for top-level children. [`extensions/subagent/index.ts:154–220`][w-subagent]; [`pi-execution-adapter/src/index.js:335–352,417–429`][w-adapter]. |
| Child process isolation | **Already** `detached: state.ownsGroup` plus `unref()`, but stdin/stdout/stderr remain parent-owned pipes and adapter state stays in memory. Worker leaves share the Worker's group. Removing cancellation alone is insufficient: losing stdin requests RPC shutdown. [`index.js:31–36,159–223`][w-adapter]; [`rpc-mode.js:578–594,639–642`][sdk-rpc]. |
| Worker identity and receipts | Registry identity and recorded session lineage survive, execution does not. The dispatch lock belongs to the lead's `process.pid`, not the child. Graceful completion may settle a cancellation receipt; abrupt death leaves a lock whose reclaim records `outcome_unknown` and requires inspection. [`subagent/index.ts:600–606,677–723`][w-subagent]; [`registry.js:73–100,113–143,184–208`][w-registry]. |
| Parent roster and completion wakeups | Live maps/wakeups disappear. Persisted child records restore terminal results; a previously running child becomes `interrupted`, never automatically resumed or relaunched. [`subagent/index.ts:170–188,1003–1035`][w-subagent]. |
| Background bash | Detached runner with ignored parent stdio owns command output, exit record and timeout. Parent shutdown only stops observing; same session ID reattaches and acknowledges completion. [`jobs.mjs:95–122,150–202,242–249`][w-jobs]; [`runner.mjs:19–30`][w-runner]. **Caveat:** while `foreground: true` is still in its initial wait, abort cancels the job (`jobs.mjs:209–230`); “all detached bash survives” is too broad. Children use native bash, not this extension (`index.ts:10–11`). |
| Terminal plugin and commands/servers launched there | Plugin disposal closes all terminals and calls `pty.kill()`: [`server-plugin.ts:80–84`][p-terminal-plugin], [`terminalService.ts:278–282,382–387`][p-terminal]. Native command trees and service-managed descendants have no survival contract. Deliberately disowned/external processes may survive: Unix parent death alone does not universally kill descendants. |
| Session transcript | JSONL entries survive. SDK persists messages at `message_end`, not each streaming delta, and appends entries to disk. Graceful abort may record an aborted message; hard death can lose an unfinished message/result. Reopening builds a new runtime on demand, not a saved execution stack. [`agent-session.js:738–752`][sdk-session], [`session-manager.js:794–819`][sdk-storage], [`piSessionService.ts:3872–3918`][p-sessions]. |
| Browser reconnect state | Existing join snapshots read partial output and a sequence watermark from the **live** runtime. Sequence counters, media index and subscribers are in memory. Useful for reattachment, not restart persistence: [`piSessionService.ts:2590–2606`][p-sessions], [`sessionEventHub.ts:14–17,55–77`][p-events]. |

`switch-web` already preserves all session-owned work by restarting only web/API when the daemon import closure and lock match. `switch-workbench` repoints only the package link; loaded sessions keep old code until reload. Neither covers a changed sessiond. `check-idle` is a process-list heuristic, **not** an idle-turn barrier: in-process streaming has no separate child PID, and launches can race its checks. Do not weaken it to claim seamlessness. See [`promote-installed:53–72,90–153`][w-partial].

## Options

Effort is relative change surface, not a delivery estimate. “Survives” below means the same execution, unless explicitly described as recovery.

| Option | Lead stream / tools / children | Effort and main risk | Repository and upstream fit | Smallest useful slice |
| --- | --- | --- | --- | --- |
| Keep using partial promotion | All survive, but only when daemon code/dependencies are unchanged | Small; incomplete coverage and static import-scan limits | Workbench script; no PI WEB architecture change | Automatically explain the safe existing command; do not call it full seamless promotion |
| **1. Independent session hosts; sessiond reattaches** | Same model stream and local tool calls; Workbench children and receipts remain owned by the same live parent. Host-dependent plugin calls need the bridge described below | Large: split session-local ownership from global services, version protocol and pin resources | PI WEB fork owns host/protocol/service lifecycle; Workbench owns promotion integration. Extends upstream's existing web/runtime separation without replacing Pi SDK | One opt-in hosted Chat with its real Subagent and Worker continues while the broker restarts |
| 2. Independent child runner/reattach | Lead stream and parent tools stop; child stream/tools survive **only** with an independent RPC pipe owner, retained result and receipt settlement | Medium–large: launch/result crash gaps, worker-lock ownership and cancellation semantics | Mostly Workbench adapter/extension/registry; little PI WEB fork delta except restart intent. Not upstream functionality | Preserve one background Subagent, then Worker; label parent continuation as recovery, not seamless |
| 3. Drain, persist, restart, resume | Finished turns survive as history, not execution. Idle lead may still own busy children; must drain them too or combine with option 2. Forced cutoff interrupts tools | Medium for bounded drain; high for safe auto-resume. Continuous work can defer promotion indefinitely; replay risks duplicate effects | Both repos; compatible with upstream shutdown style but fails the immediate-continuation goal | Quiesce admission and wait for genuinely settled work; reduces accidental losses, not a solution alone |
| 4. Blue/green sessiond | Old generation can retain streams/tools/children; a real live per-session handoff cannot serialize stacks or connections. Idle handoff can reopen history | Very large if two complete daemons: routing, global stores, plugins and rollback | PI WEB fork plus Workbench. The [data-directory ownership guard][p-ownership] explicitly rejects two daemons; never bypass it | Route old sessions to old daemon, new sessions to new hosts, with one global-state owner; no forced migration |
| **5. Pi Durable-backed sessions** | Reopens durable tasks/queues; ordinary stream is reissued, safe tools rerun, unsafe tools become interrupted. Durable-native child conversations recover; current Workbench RPC children do not | Very large migration; experimental API, replay policy, storage and extension parity | PI WEB session implementation plus Workbench tools/telemetry migration. Greatest divergence from upstream's AgentSession/SessionManager integration | Isolated disposable Harness recovery proof; no production session conversion |
| Shared revision-pinned runtime host | Like option 1, but many sessions share one surviving generation | Fewer processes/extractions initially; one crash affects all its sessions and old generations can linger | PI WEB fork; possible staging shape for option 1 | Keep the current runtime owner outside promotion's stop set, while retaining old code; not hot reload |

Upstream comparison is against locally available [jmfederico/pi-web upstream revision][upstream-base] and its [runtime guidance][upstream-guide], not a maintainer commitment. The guidance already separates the restartable UI from long-lived sessions. A generic reconnectable session-host protocol is a narrower upstream proposal than converting to a different agent harness. Keep Workbench Worker semantics out of PI WEB core.

## Pi Durable: useful recovery, not invisible continuation

Primary sources are Thomas’s [Pi repository `packages/durable` link][durable-main], its [README][durable-readme], [normative specification][durable-spec], and generation/tool implementation—not the third-party app descriptions.

- **Current:** [repository main inspected][durable-main-ref] declares 1.0.4. Its README, generation source and tool source exactly match published 1.0.4. [npm metadata][npm-durable] reports publication on 2026-10-05; package integrity was verified. Detailed source anchors use npm's `gitHead`.
- **Shipped versus installed:** the [changelog][durable-changes] records the first separate `@earendil-works/pi-durable@1.0.0` release on 2026-10-01, in the Pi 1.0 release line. Installed PI WEB uses **coding-agent 1.0.0**, which does not include or enable Durable. Current Durable also introduces Chord and pi-ai `^1.0.4` dependencies.
- **Maturity:** the README explicitly says **experimental; API changes without notice**. The 1.0.3 and 1.0.4 changelogs contain breaking changes. Third-party adoption establishes interest, not stronger guarantees.

### What it actually guarantees

- `Harness.open(storage, …)` reopens committed conversations/tasks/documents. `resume()` enables scheduling; submission and wait operations can also enable it. Closing leaves unfinished task checkpoints pending, rather than durably cancelling the task. `requestId` deduplicates submission admission in one conversation; it does not make arbitrary effects exactly-once. [Specification §§2.2, 5.1–5.2, 6][durable-spec].
- Progress becomes visible only after storage commit. Partial/output commit intervals default to 100 ms; uncommitted progress can be lost, and output commits are also adaptively throttled. This is not preservation of the live network stream. On ordinary generation recovery the prior committed partial becomes an aborted assistant entry and the pinned request is sent again. Provider-supported deferred work is different: a **committed deferred handle** can be polled after reopen. [Generation implementation `184–231,352–360`][durable-generation]; specification §8.3.
- A tool intent records arguments and replay policy before execution. An interrupted call executes again only if **both stored and current policy** say `safe`; otherwise it yields an `interrupted` error with retained output. Safe means the implementer makes repeat execution safe, not that Durable transactionally controls a shell or remote API. [`tool.ts:79–110`][durable-tool]. A model can still react to an interruption by proposing another call; safety policy must cover that too.
- Durable-owned child conversations can resume with their parent. The documented foreground pattern finds the same child by owning task ID and submits with a stable request ID. Its background example uses anchor/reporter tasks and deduplicated child input and parent follow-up. This **replaces** subprocess lifecycle with durable conversation/task lifecycle; it does not adopt existing `pi --mode rpc` processes. [README “Abort and Subagents”][durable-children]; specification §7.3.
- Storage is single-owner: **no cross-process locking**. SQLite defaults to WAL/`synchronous=NORMAL`; JSONL has an optional fsync mode and a different multi-file commit format from coding-agent JSONL. Neither makes two session daemons safe writers. Close joins running invocations; non-cooperative code can block it. [README “Storage”][durable-storage]; specification §§2.2, 7.5, 11–12.

### Could sessiond use it?

**Yes, through a new session backend, without changing Pi SDK itself. No, not by wrapping `createAgentSessionFromServices()` in a durable task.** A wrapper persists that it called the SDK, not the SDK's agent loop, extension closures or child pipe ownership. After a crash it would either rerun that opaque call or mark it interrupted.

A real integration would replace AgentSession execution with `Harness` conversations, install Durable extensions on every start, use Durable storage, reacquire handles, and call `resume()`. PI WEB must adapt commands, dialogs, tree/fork behavior, authentication/model setup, custom tools, stream/status projection and session discovery. `watchEvents()` offers coding-agent-*style* events but is experimental and not the current event contract. Existing `.pi` package/skill discovery and `ExtensionAPI` hooks are not the Durable registry API. Existing SessionManager JSONL cannot simply be passed to Durable's JSONL backend.

For Workbench, choose either to port delegation into Durable-owned conversations/reporters **and** map Worker identity, locks, lineage, routing receipts and completion barriers, or retain RPC children behind option 2's independent runner and expose idempotent durable handles. Marking today's `subagent` or `worker_dispatch` tool `replay: "safe"` would risk a second launch; it is not a fix. Telemetry, secret redaction, tool admission, session ownership and the Claude Code usage package must retain their behavior through any migration.

**Judgment:** do not put this five-day-old, different harness on the critical path for seamless promotion. Use its task/checkpoint and deduplicated reporter design if crash recovery later becomes an explicit goal; prefer evaluating the real package over writing a home-grown durable scheduler. A bounded future spike should crash a disposable Harness during a generation, a replay-safe effect, an unsafe effect and a Durable child report, then verify the documented distinctions. Passing that test would prove recovery, not the uninterrupted-execution target above. Durable plus independent session hosts could eventually provide both; neither a host reboot nor a forced process kill preserves arbitrary local execution.

## Recommended design boundary

```text
browser → replaceable web/API → replaceable sessiond broker
                                      │ reconnectable local socket
                                      └→ session host (one live SDK runtime; pinned revision)
                                           ├→ existing Workbench Subagent / Worker RPC children
                                           └→ tool processes and existing background-bash runners
```

Use the existing SDK factories inside the host. Do not serialize SDK object graphs or expose arbitrary object-method RPC. Reuse PI WEB's session-route service vocabulary and snapshot/watermark flow at an explicit process boundary. The split is substantial: the current service mixes session state, dialogs, shared model runtime, global projections and plugin callbacks.

Required properties:

1. **Runtime owns lifetime.** Broker disconnect/restart detaches subscribers only: no agent abort, extension `session_shutdown`, pipe close or worker-lock transfer. Actual close/cancel remains explicit. The persistent lead PID already owns worker receipts/heartbeats, so option 1 avoids building a second child execution system.
2. **Single writer and reconnect identity.** Record session ID, canonical session file, host endpoint, process birth identity, random instance nonce, protocol version and loaded revisions in owner-only local storage. Validate a live handshake; never treat PID alone or a lost socket as permission to reopen the JSONL. Fence competing brokers/control attachments and deduplicate mutating command IDs in the surviving host. Same-user socket access is a trust boundary, not a sandbox.
3. **Convergent delivery.** Subscribe and capture a snapshot atomically in the host, tagged with host identity and monotonic sequence. Reconnect from transcript plus partial/queue/tool/dialog/roster state; use a bounded replay window or fresh snapshot on a gap. A disconnected browser must not backpressure agent execution. “Completion sent” is not “completion accepted”: retain stable delivery IDs until acknowledgment, and reconcile against persisted receipt/message identity after reconnect.
4. **Keep dependencies alive too.** Runtime-local extension contexts, provider/model resources, pending asks, UI requests and tool continuations belong with the host. Broker-dependent operations need stable request IDs and reconnectable waits, not rejected promises or blind replay. Global project/archive/unread mutation stays with one authoritative broker; publish reconstructible status from hosts. Plugin lifetimes currently abort work on shutdown: separate admitted execution from transport teardown. Terminal PTYs need their own persistent owner or an equivalent retained host before claiming terminal/server survival.
5. **Revision pinning and cleanup.** Launch from resolved immutable paths; retain exact Node/SDK/extension resources needed by live hosts, not just today's installed symlink. New work inside an old session must not accidentally load half a new package. Retain old builds until their last host releases them; report and reclaim genuine orphans without killing a PID-reused process. Explicit session end still cancels children; browser loss does not. Permanent host failure remains interrupted/unknown, not automatic side-effect replay.
6. **Promotion/rollback compatibility.** Validate that the new broker can attach every live host protocol before repointing. Stop only broker/web service labels, never host labels or a wildcard port/socket sweep. Rollback also reattaches rather than stopping hosts. Reject incompatible promotions before disruption; use a backward-compatible protocol bridge or retain the old broker endpoint, never silently fall back to destructive `--force`.

On macOS, prove independent host lifetime under actual launchd bootout, not merely `kill(parentPid)`. On systemd, give hosts independently managed scopes/units outside the broker's kill domain. Do not add a global “abandon every child” service flag: it creates uncontrolled orphan lifetime without reattachment or cancellation.

## Phased delivery

### 1. One protected Chat — first useful slice

In a PI WEB development instance, put one opt-in Chat's SDK runtime **and its session-local control/delivery state** in an independent host. Keep its existing Workbench extension and adapter unchanged. Add reconnect, snapshot, explicit close and single-writer checks. Demonstrate a broker restart while that Chat streams and both a Subagent and Worker run. This delivers the exact benefit for migrated Chats without first rebuilding Worker durability. Other Chats remain explicitly unprotected; keep the promotion refusal for them.

No live JavaScript stack can be extracted from today's already-running sessiond. Initial adoption therefore needs a compatibility transition: retain the legacy daemon as the sole owner of its existing sessions/global state behind a routing bridge; start migrated hosts separately, and relinquish old sessions only when truly quiescent (including children and queued work). Do not start a second full daemon against its data directory. If that bridge is not implemented, the first installation needs an explicitly disclosed restart window; it is not yet seamless for pre-existing Chats. Never require everyone to stop silently as part of the rollout.

### 2. Cover normal session behavior

Move remaining session-local operations across the boundary: PI WEB subsessions, commands, extension dialogs/asks, queues, compaction, media and completion projections. Preserve plugin-admitted work and terminal PTYs with independent ownership. Test cancellation, host crashes, absent brokers, competing attaches, corrupt records, bounded buffers and cleanup. Make explicit close versus transport loss mechanically distinct; update the V1 shutdown wording only with implementation evidence.

### 3. Make promotion use reattachment

In Workbench, replace full-switch's indiscriminate stop path for protected hosts, including rollback. Preflight reports live revision/protocol coverage; new sessions load the promoted revisions, old sessions continue on theirs. Retain partial promotion commands. Run isolated native-service proof and only then schedule owner-approved adoption. Keep incompatible protocol or unprotected legacy sessions visible rather than treating them as idle.

### 4. Consider recovery separately

After uninterrupted promotion works, evaluate Pi Durable only for a requested recovery outcome. Do not add automatic replay, cross-machine handoff, a custom scheduler or hot migration of busy runtimes to this delivery. SDK `waitForIdle()` is useful for voluntary per-session upgrades, but an idle lead is not sufficient while its children or services still run.

## Proof of “seamless”

**Future acceptance test, not run in this assignment.** Use isolated data/config/agent/session directories, socket, ports and native service labels; no production services or installed links. Keep fixtures under the test-owned scratch root, install the real required extensions, and clean up all owned processes afterward. Use a deterministic streaming provider and real processes/sockets for reproducibility; repeat once with an actual provider to exercise its connection.

1. Open a lead Chat on revision A. Launch a real Workbench background Subagent and a real Worker dispatch. Each holds a native tool process behind an explicit test barrier, records its PID/start identity, writes an exclusive side-effect marker once and then continues. Have the Worker also own a leaf. Start a background bash job and a terminal-hosted server as additional coverage.
2. Start a lead model response with numbered deltas; hold it after a known delta. Record provider request count/identity, lead host and child process identities, session/execution/worker IDs, worker lock token and heartbeat. Prove all three activities overlap; sleeps alone are not evidence.
3. Promote A→B with a **sessiond-code change**, using the test-instance equivalent of full promotion and real launchd bootout/bootstrap of broker/web. `switch-web` alone is not this test. Continue deltas and release child barriers while the browser/broker is disconnected, including a child that finishes before reconnection.
4. Reconnect automatically. Assert **the same provider request continues**; no new prompt/retry or aborted lead message; every side-effect marker appears once; child/host PIDs and birth identities persist; same worker lock remains valid until its one terminal receipt; no dead-owner reclaim, duplicate dispatch or lost result. The lead receives/collects each completion once, including nested work, and the browser's final transcript/partial/status agrees with the host.
5. Create a new Chat and verify revision B; the existing Chat still reports A. Repeat with two promotions and a failed-health rollback. Repeat at launch acknowledgment, result persistence, receipt settlement and completion acknowledgment boundaries; inject disconnects there rather than relying on timing luck.
6. Check explicit child cancel and actual session close still terminate the intended process trees. Reject a second writer, forged/stale endpoint and incompatible host protocol without disruption. Verify detached bash/terminal server output remains available, old builds are retained while referenced, and a genuine host death reports unknown/interrupted instead of replaying a mutation.

Acceptance: no manual resume, no reissued in-flight lead request, no cancelled child/tool from promotion, exactly one observed execution effect and terminal receipt per test operation, no missing completion, and automatic UI convergence. Record reconnect latency; an initial local target is under five seconds after broker health, not a claim of gap-free browser transport. Runtime-crash and Durable recovery tests use different expected outcomes and must not be counted as this proof.

## Verification of this note

Source tracing and package inspection only; no daemon restarts, installation changes, agent-execution tests or production mutations. npm package integrity and the relevant SDK lifecycle paths were checked; the package's own guarantees were compared with its generation/tool implementation. The unauthenticated GitHub API was rate-limited, so Durable source anchors use npm's published `gitHead`. No delegated-review tool is available in this runtime; review is the author's self-review. Runtime behavior, protocol feasibility and performance remain pending the proof above. No Pi SDK change is required for the recommended process boundary.

[npm-durable]: https://registry.npmjs.org/@earendil-works/pi-durable/1.0.4
[durable-main]: https://github.com/earendil-works/pi/tree/main/packages/durable
[durable-main-ref]: https://github.com/earendil-works/pi/tree/428a12bc775145afa342530a9eaa652efb3e4422/packages/durable
[installed-build]: https://github.com/tschuehly/pi-web/commit/5b4810a10460b821bfcfc3c7f8c0af59a10d782a
[p-ownership]: https://github.com/tschuehly/pi-web/blob/29f1760dfc921dafd93bfbe7857c81750eb9168f/src/server/sessiond/sessiondStateOwnership.ts#L1-L29
[wb-base]: https://github.com/tschuehly/pi-workbench/commit/cf230107a26f5ecab39101c467d569e138c6de24
[web-base]: https://github.com/tschuehly/pi-web/commit/29f1760dfc921dafd93bfbe7857c81750eb9168f
[upstream-base]: https://github.com/jmfederico/pi-web/commit/9c231cdcc3e26d0d334247e01d142b12e7881acd
[upstream-guide]: https://github.com/jmfederico/pi-web/blob/9c231cdcc3e26d0d334247e01d142b12e7881acd/AGENTS.md#agent-notes
[w-switch]: https://github.com/tschuehly/pi-workbench/blob/cf230107a26f5ecab39101c467d569e138c6de24/scripts/promote-installed#L175-L234
[w-partial]: https://github.com/tschuehly/pi-workbench/blob/cf230107a26f5ecab39101c467d569e138c6de24/scripts/promote-installed#L53-L153
[w-subagent]: https://github.com/tschuehly/pi-workbench/blob/cf230107a26f5ecab39101c467d569e138c6de24/extensions/subagent/index.ts
[w-adapter]: https://github.com/tschuehly/pi-workbench/blob/cf230107a26f5ecab39101c467d569e138c6de24/packages/pi-execution-adapter/src/index.js
[w-registry]: https://github.com/tschuehly/pi-workbench/blob/cf230107a26f5ecab39101c467d569e138c6de24/packages/worker-registry/src/registry.js
[w-jobs]: https://github.com/tschuehly/pi-workbench/blob/cf230107a26f5ecab39101c467d569e138c6de24/extensions/background-bash/jobs.mjs
[w-runner]: https://github.com/tschuehly/pi-workbench/blob/cf230107a26f5ecab39101c467d569e138c6de24/extensions/background-bash/runner.mjs
[p-sessiond]: https://github.com/tschuehly/pi-web/blob/29f1760dfc921dafd93bfbe7857c81750eb9168f/src/server/sessiond.ts
[p-shutdown]: https://github.com/tschuehly/pi-web/blob/29f1760dfc921dafd93bfbe7857c81750eb9168f/src/server/sessiond/sessionDaemonShutdown.ts#L27-L45
[p-sessions]: https://github.com/tschuehly/pi-web/blob/29f1760dfc921dafd93bfbe7857c81750eb9168f/src/server/sessions/piSessionService.ts
[p-events]: https://github.com/tschuehly/pi-web/blob/29f1760dfc921dafd93bfbe7857c81750eb9168f/src/server/realtime/sessionEventHub.ts
[p-terminal-plugin]: https://github.com/tschuehly/pi-web/blob/29f1760dfc921dafd93bfbe7857c81750eb9168f/pi-web-plugins/terminal/server/server-plugin.ts#L80-L84
[p-terminal]: https://github.com/tschuehly/pi-web/blob/29f1760dfc921dafd93bfbe7857c81750eb9168f/pi-web-plugins/terminal/server/terminalService.ts
[sdk-runtime]: https://unpkg.com/@earendil-works/pi-coding-agent@1.0.0/dist/core/agent-session-runtime.js
[sdk-session]: https://unpkg.com/@earendil-works/pi-coding-agent@1.0.0/dist/core/agent-session.js
[sdk-rpc]: https://unpkg.com/@earendil-works/pi-coding-agent@1.0.0/dist/modes/rpc/rpc-mode.js
[sdk-bash]: https://unpkg.com/@earendil-works/pi-coding-agent@1.0.0/dist/core/tools/bash.js
[sdk-storage]: https://unpkg.com/@earendil-works/pi-coding-agent@1.0.0/dist/core/session-manager.js
[durable-readme]: https://github.com/earendil-works/pi/blob/7c10bd4337495ee613f2224843ecdf349b80d1df/packages/durable/README.md
[durable-spec]: https://github.com/earendil-works/pi/blob/7c10bd4337495ee613f2224843ecdf349b80d1df/packages/durable/docs/spec.md
[durable-generation]: https://github.com/earendil-works/pi/blob/7c10bd4337495ee613f2224843ecdf349b80d1df/packages/durable/src/harness/generation.ts#L184-L231
[durable-tool]: https://github.com/earendil-works/pi/blob/7c10bd4337495ee613f2224843ecdf349b80d1df/packages/durable/src/harness/tool.ts#L79-L110
[durable-children]: https://github.com/earendil-works/pi/blob/7c10bd4337495ee613f2224843ecdf349b80d1df/packages/durable/README.md#abort-and-subagents
[durable-storage]: https://github.com/earendil-works/pi/blob/7c10bd4337495ee613f2224843ecdf349b80d1df/packages/durable/README.md#storage
[durable-changes]: https://github.com/earendil-works/pi/blob/7c10bd4337495ee613f2224843ecdf349b80d1df/packages/durable/CHANGELOG.md
