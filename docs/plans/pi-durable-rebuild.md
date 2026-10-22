# Rebuild Pi Workbench on Pi Durable

**Recommendation: replace Workbench’s coding-agent execution with Pi Durable 1.4.0, behind PI WEB’s existing session protocol, one opt-in Chat at a time. Keep live Durable hosts outside promotion’s stop set; use Durable recovery when a host or the Mac actually stops.** Prove recovery, Claude subscription access and secret redaction before moving daily work. Keep the old runtime available until history and daily-use behavior have passed their gates.

Status: **proposed for Thomas’s review, 2026-10-22; not approval to implement or promote.**

This follows Thomas’s request for the rebuild plan. Astra’s October 22 evaluation recommended the smaller option first; its compatibility and recovery findings remain constraints here, not a reason to substitute another goal. The retained evaluation is `pi-durable-evaluation-2026-10-22.md` in Workstream `ws-pi-workbench-ui-dogfooding-20260921`.

## Outcome and boundaries

The rebuilt Workbench preserves Chats, child assignments, admitted input, unanswered questions and execution evidence across promotions and orderly Mac shutdowns. Ordinary promotions leave the same admitted execution running. After an actual runtime loss, it resumes recorded work, identifies uncertain effects, and never silently repeats an unsafe operation.

Assumptions for scope and estimates:

- One owner, local macOS/launchd first; existing PI WEB authentication and workspace trust remain. Linux/systemd gets separate service-lifetime proof before the same survival claim.
- Local work stops while the Mac is off. Recovery starts when services run after boot/login; work progressing overnight requires a separately approved always-on machine with repositories and credentials there.
- Keep the current Workbench client, native wrapper, Workstream Store, model routing, Working Mode, Atelier Pages and tool names. Replace their runtime bindings, not their product meaning.
- Preserve Claude Code subscription use. Paid API keys are not an acceptable silent substitute. No general coding-agent `ExtensionAPI` emulator, new application shell, Run Controller, remote fleet or multi-user authority system is included.
- Recovery continues an already admitted bounded assignment, not new autonomous work. Explicit cancellation remains cancellation. Working Mode and Durable task ownership confer no new permission.
- Budget assumes one engineer familiar with both repositories, a reviewer available at gates, and no prolonged upstream/provider blocker. The phase estimates are planning ranges, not a quote.

**Finish line:** daily Workbench Chats and their Durable-native Subagents/Workers pass the survival table below; existing history remains inspectable and resumable through a verified migration; the legacy PI WEB execution backend can be removed without losing data. Standalone Pi terminal use may remain a separate supported fallback, not a hidden execution dependency of Durable Chats.

The [harness contract](../contracts/harness.md#installed-and-development-checkouts), [Working Mode](../foundation/working-mode.md), [Workstream contract](../contracts/workstreams.md), and [vocabulary](../foundation/vocabulary.md) remain the behavioral authorities. Their current “no execution survives session shutdown” wording needs a narrow, owner-approved distinction between **transport loss, recoverable runtime loss and explicit session end** when the implementation earns it. Some overview/native README statements lag shipped Chat behavior; do not use them to remove today’s features. The older [seamless-promotion proposal](seamless-promotion.md) supplies the independent-owner requirement; this plan adds genuine Durable recovery rather than wrapping `AgentSession.prompt()` in an opaque task.

## Target architecture

```text
Workbench browser / macOS WKWebView
  → PI WEB authenticated web/API + WebSocket proxy
    → sessiond: session catalog, runtime routing, global projects/plugins/status
      ├→ legacy PiSessionService                       [during migration]
      └→ versioned local session-host protocol
          → revision-pinned Durable host              [one Chat family]
              ├→ Harness → SQLite store → conversations, inboxes, tasks, documents
              ├→ Workbench Durable extensions + provider/auth adapter
              ├→ per-conversation execution environments
              └→ retained background-bash runners
    → terminal plugin → retained terminal owner         [PTYs, not Durable tasks]

Workstream Store remains separate; host tools call its existing typed operations.
```

A **Chat family** is one original Chat, its explicit forks, and their child conversations. Keeping a family in one store lets Durable fork history and commit child/report state without inventing cross-store transactions. Unrelated Chats get separate stores and hosts. This is a proposed process boundary, not a claim that it exists today.

### Ownership and files

| Owner | Persistent state and responsibility |
| --- | --- |
| `sessiond` | Existing PI WEB-managed catalog/project/archive state; a runtime locator per Chat: backend, store ID and loaded protocol/revision. The host owns the active conversation/branch mapping; catalog copies are projections, not a second authority. It never opens a live Durable database. Catalog registration and host creation use a stable launch ID and recoverable pending record. |
| One Durable host | Sole opener/writer of `$PI_WEB_DATA_DIR/durable/<store-id>/session.sqlite`, including its WAL/SHM files. Application documents hold Chat mappings, questions, Worker execution state and delivery receipts; do not put these in release directories. A family’s first Chat uses `root()`; additional conversations use `createConversation()` or `fork()`, never repeated `root()`. |
| Native service manager | Starts pinned host executables independently of web/sessiond; restarts crashed hosts subject to a crash budget. Host endpoint/instance nonce, process birth identity and store-ownership claim live in owner-only runtime metadata. A missing socket or reused PID never proves that a writer died. |
| Existing external stores | Workstreams stay in the Workstream Store; Atelier HTML/Event Logs stay beside their Pages; bash job records/logs stay in the existing runner registry. Durable records references and delivery receipts, not competing copies of authoritative state. |
| Terminal owner | Retains the existing terminal service outside sessiond’s plugin disposal lifetime. Terminal IDs/cwd and reconnectable buffers remain terminal state. The plugin becomes its transport adapter; no shell-history replay engine. |

Durable has **no cross-process locking**. Reuse the principles of PI WEB’s state/socket claims, but give each store its own fenced owner claim. A second owner, uncertain liveness, unknown schema or missing required security extension fails closed. Resolve executable, Node, dependencies, extensions and lazy-loaded resources to immutable build paths; retain those builds while any host references them, rather than following the mutable installed symlink mid-turn. File permissions are owner-only; browsers never receive database paths or credentials. Idle hosts may close only when no task, queued input, delivery or owned process needs them; status/history inspection must not resume work. [D1], [W1], [W2]

Use SQLite WAL with **`synchronous=FULL`**, verified on every open before accepting input. The shipped helper defaults to `NORMAL`; open the exported Node database facade, set the pragma, then pass it to `SqliteStorage.open()`. This uses public APIs, not a storage fork. Measure the latency cost in the pilot. FULL strengthens local commit durability; it is not disk-loss protection or proof against every hardware failure. Back up only through a consistent SQLite snapshot or while the owner is closed; retain the database and any required journal files as a consistent set. Never copy just a live `.sqlite` file and call it a backup. [D1], [D6]

### PI WEB protocol and client

Reuse `SessionRouteService`, the current HTTP/WebSocket proxy and existing browser Chat projections. Put Durable imports behind one runtime adapter; do not leak Chord operations, task internals or Durable numeric IDs into the public API. The adapter translates committed `watch()`/`watchEvents()` state into PI WEB messages, tool activity, inbox, question and status fields. “Coding-agent-style events” do not imply protocol compatibility. Normalize the remaining synchronous reads/acks (notably attention at `sessionRoutes.ts:253–263`) to awaitable service operations; keep their wire response shapes. [W2], [W3], [D1]

- Every mutating command carries a stable operation ID. Acknowledge prompt/steer/follow-up admission only after commit. Retrying the same ID returns its receipt; a changed payload under that ID is rejected by the adapter.
- Reconnect starts with a committed snapshot and an owner-instance/sequence watermark, then ordered updates. A new owner or gap replaces the snapshot. Slow clients cannot block execution or grow unbounded buffers.
- Preserve input order, queue edit/promote/clear behavior, attachment references, Stop returning queued text to the composer, paging, usage, model selection, tree actions, exports and child inspection. Add capability negotiation for operations not yet supported; never display a working control that silently does nothing.
- Queries must be read-only: Durable `submit()` and waits can enable scheduling. A paused migration, recovered unknown-effect case or history-only open must not accidentally run because the UI asks for status.
- Native readiness must distinguish an intentionally pinned compatible host from an unhealthy/stale web or broker. Today `PIWebReadiness.swift:26–47` rejects a mismatched checkout. Retain origin validation, window identity, drafts and notification behavior; do not make the wrapper a store owner. [W4]

### Chat, branch, Subagent and Worker identities

Every application document declares a schema version, history policy, fork policy and required `checkpointWhen` predicate. Mode/exposure state is rewindable as-of the branch point; live questions, Worker control, cancellation and delivery receipts are never cloned into a new Chat’s authority.

A public Chat keeps its machine/project/workspace/session identity. Its locator names a family store and active lead conversation. Durable’s “Session” means a store, and its “run” means an input-to-answer cycle; neither is a Workbench Run.

- **History navigation:** retain a Chat’s branch map. Navigating to an earlier entry selects a retained branch or creates a forked conversation; it does not erase later history. Explicit “fork Chat” creates a new public Chat identity in the same family store. Navigation is a quiescent operation with revision checks; live children and pending input cannot be silently moved to another branch. Changing cwd/tool configuration during unfinished work is likewise gated: Durable resolves the current environment on replay, not necessarily the original cwd. Preserve current question-restoration and Worker-ownership behavior in contract tests before enabling these controls.
- **Subagent:** one fresh, scoped child conversation per bounded assignment, with a stored execution ID, model/effort receipt, profile, cwd and tools. No inherited parent transcript. Apply an explicit profile tool/extension set, including telemetry and the Claude adapter; hiding tools from the model alone does not restrict nested calls. Use a durable anchor/reporter for background execution and stable submission IDs. Reuse the foreground ownership pattern only where the parent really waits. The upstream background example is a pattern, not Workbench’s collect protocol. [D3], [D4]
- **Worker:** one logical identity and child conversation lineage per scope, owned by its lead Chat. Each dispatch has a fresh binding and one terminal receipt. Store the Durable Worker’s identity, active-dispatch lock and collection state in the family’s documents so receipt settlement and result availability commit together. Reuse registry validation rules; do not make the legacy file registry a second writer. Machine-wide status aggregates both backends read-only during migration.
- Preserve one dispatch per Worker, independent review on fresh Subagents, lead → Worker → leaf depth, coordinator tool restrictions, explicit steer/cancel/collect and truthful truncated results. Worker settlement waits for leaves and their collection. A fork receives no control over the source Chat’s Workers.
- Preserve coalesced completion attention: commit the terminal receipt and terminal-uncollected state, then deliver a deduplicated wake; collection commits what was actually read. Do not copy the example’s full-answer follow-up behavior over Workbench’s bounded collection contract. Cancelling a Worker reaches its leaves; cancelling one leaf leaves the Worker alive. Persist cancellation/delivery epochs so a late reporter cannot revive explicitly cancelled work. [W5]

Before scheduling a reopened store, inspect unfinished intents and install the mutation-reconciliation guard. An uncertain unsafe effect blocks another attempt—including a fresh model-proposed call—until tool-specific evidence or Thomas resolves it. Read-only investigation and independent Chats can continue. Tool implementations must honor cancellation; a non-cooperative tool can delay `close()`, so bounded host shutdown may escalate to termination and truthful interrupted state, never successful completion.

### Questions, Working Mode, Workstreams and telemetry

**`ask_user` remains non-blocking.** Commit the question before publishing it; key posting/revision by tool operation, not a new random ID on replay. Persist answers, withdrawal, unanswered closures and answer-delivery receipt. A revision-checked answer commits before the UI hears “closed”; a reporter submits it once as the existing follow-up semantics. Open questions do not become Workstream Human Tasks. An explicit new-Chat fork does not inherit live questions from its source Chat; navigation inside the same Chat restores branch-appropriate questions through the existing rules. [W6]

**`request_attention` remains a separate non-question tool.** Persist the latest reason and ID, with compare-by-ID acknowledgement so viewing an old request cannot clear a newer one. Keep immediate return, no routine-progress alerts and no turn-end desktop notification. The new implementation adds restart persistence to today’s in-memory `attentionRequests` Map; it does not turn attention requests into approval or stop independent work. Notifications are downstream of committed attention state and deduplicated by request ID. [W6], [W7]

**Extension dialogs need a deliberate port.** Durable does not restore an in-memory `ctx.ui.confirm/select/input` Promise. For supported workflows, commit a dialog/answer record and make the task phase reattach by ID. Auth/login commands that require a live external callback may instead expire visibly and offer Retry. Do not label an expired login flow an unanswered `ask_user`.

**Working Mode stays recorded conversation guidance**, not a changing system-prompt section or tool permission. Port the current renderer and four axes. A rewindable document stores selected/applied/aligned state and sequence; committed entries record each delivered block. Preserve `/mode send`, next-prompt delivery, fork-as-of state, compaction reattachment and the AFK alignment rule. Tool groups may follow Orchestration as today, but Mode still does not filter skills or grant authority. [W8]

**Workstreams keep their Store and host-neutral coordinator.** Preserve pending-before-create, idempotent confirmation, one home, visiting checkpoints and persistent workspace validation before recording `session.pending`. Recovery reporters retry typed Store operations using their original operation IDs; they do not infer checkpoint truth from Chat activity. Update runtime identity environment variables used by the Workstreams CLI; do not invent a fake coding-agent JSONL file for Durable. [W9]

**Telemetry keeps Workbench lineage and analytics.** Translate Durable 1.4 submission/phase/checkpoint/replay spans into the existing recorder with Chat, conversation, task, execution, Worker and attempt IDs. Persist export/deduplication cursors, count replayed provider calls separately, and never double-count a nested tool’s usage through its parent. Record host restart versus explicit cancellation distinctly. Diagnostics may contain content even when nominal span attributes do not; redact before export. [D2], [W10]

### What survives

“Promotion” below means the new retain-and-reattach deployment, not today’s destructive `stop_all`. “Recovery” assumes intact storage, compatible pinned code and available authentication. No claim is made that local work executes while the Mac is off.

| Item | Routine web/sessiond/Workbench promotion | Host crash or orderly Mac shutdown → startup |
| --- | --- | --- |
| In-flight model generation | Same pinned host and provider stream continue; client reconnects. | Ordinary request is sent again; committed partial becomes an aborted entry. A committed provider-deferred handle may be polled instead where supported. Replays may cost another request. |
| Finished tool result | Remains committed; not executed again. | Same. |
| Running foreground tool | Same process continues while its host is retained. | Only stored **and** current safe policy permits rerun. Unsafe intent becomes interrupted with retained output; hold uncertain mutations for reconciliation. Arbitrary shell memory is lost. |
| Subagent/Worker/leaf | Same host’s conversations continue; reports can finish while broker is absent. | Durable-native conversations/tasks resume; one receipt/report/collection identity. Old RPC children gain no recovery merely because the parent moved. |
| Background bash | Existing detached runner continues, bounded by timeout/12-hour ceiling; completion reattaches. | Host-only loss may leave runner alive: reattach by verified process identity. Mac shutdown kills it; retain log and report interrupted/unknown exit, never automatically rerun arbitrary commands. |
| Terminal/PTY and its server | Retained terminal owner preserves process and buffer through broker promotion. Until that port ships, explicitly unprotected. | Local PTY/process dies. Show ended/interrupted terminal and reopen explicitly; saved metadata is not execution recovery. |
| Queued prompt, steer, follow-up, child report | Durable inbox/receipt survives; only committed admission is acknowledged. | Same IDs/order restored. Keep `afterFailedRun=keep` initially and show waiting items; failure is not permission to drain unrelated work. |
| Unanswered `ask_user`, answered-but-undelivered outcome | Question/outcome documents and reporter survive. | Same, with revision checks and one delivered answer; no Promise restoration. |
| `request_attention` and acknowledgement | Persisted latest request stays until the exact request is viewed/acknowledged. | Same; reconnect must not re-notify an acknowledged request. |
| Working Mode, tool groups, model binding | Loaded host keeps its revision; committed choices remain. | Restore recorded choices before scheduling. Missing definitions/models block visibly. |
| Workstreams/checkpoints/Human Tasks | Separate Store is unchanged. | Persisted records remain; recovery alone creates no checkpoint or Human Task. |
| Atelier Page and human input | Retained host keeps Page server alive; Event Log remains authority. | Page/Event Log survive; server reopens and reclaims receiver safely, delivering only unacknowledged events after undo deadlines. No change to Page access scope. |
| Telemetry/history/media | Persisted evidence survives; exporters reconnect. | Committed evidence and media references survive; uncommitted samples may be lost. Expose recovery attempts rather than inventing uninterrupted spans. |
| Unsaved composer draft / window placement | Existing client/native persistence remains; unrelated to Harness. | Only what the client/native layer saved returns; Durable cannot recover an unsent draft. |

Promotion never upgrades a running JavaScript stack. New families use the new build; old families remain visibly pinned. An explicit family upgrade requires quiescence including children, queues, reports, dialogs and owned services, a consistent backup and exclusive handover. If forced, it is a **recovery restart with interruption**, requiring owner direction—not “seamless.” `close()` preserves pending tasks; `abort()` cancels them. Actual Chat end must reach its background child anchors; transport loss must not. Preserve bash’s existing explicit-cancel/timeout lifetime rather than cancelling it on transport shutdown. A user-requested stop-all includes owned jobs; ordinary Stop and browser close must not silently acquire that meaning. [D1], [D5], [W11]

## Extension migration

None of the 15 Workbench extensions loads unchanged in Durable. **Port** reuses behavior/core logic with new bindings; **rewrite** replaces lifecycle/persistence integration; **drop** below means only an obsolete binding, never an unapproved feature removal. Keep old bindings for legacy Chats until their replacement passes parity. Sources are the named `extensions/<name>/index.ts` at the [Workbench inspection revision][wb-base].

| Extension | Disposition and Durable/host mapping | Acceptance focus / source lines |
| --- | --- | --- |
| `activity` | **Port.** Project committed live tools/tasks and child status documents into current activity UI; drop TUI widget plumbing from the Durable host. | Self-reported status stays distinct from inferred activity; `:4–24`. |
| `agent-audit` | **Rewrite integration.** Provider-boundary observer plus section/resource provenance and entry/task IDs; keep capture/export core and explicit opt-in. No equivalent `getSystemPromptOptions()` or exact SDK request hook. | Default off; supported transports and limitations explicit. Existing startup is TUI-only, not today’s PI WEB feature; `:129–237`. |
| `atelier` | **Port kernel/server; rewrite delivery.** Tool + durable delivery/receiver tasks and receipts; preserve Page file/Event Log authority, takeover and undo window. | Crash at event append/admission/ack, two receivers, late answers and page checks; `:28–159`. |
| `autonomous-grill` | **Port.** Existing skill/prompt builder, host slash command/editor, deduplicated input submission. No Durable command UI. | Same brief and delegation behavior; `:1–11`, `command.mjs:4–34`. |
| `background-bash` | **Port runner; rewrite admission/reporting.** Tools reference deterministic job-operation IDs; reporter tasks reattach and submit completion. Persist launch intent before spawn and make runner claim the ID before executing. | Crash between intent/spawn/result must never launch twice; retain timeout, foreground-wait cancellation and log limits; `:20–112`, `jobs.mjs:154–251`. |
| `context-checkpoint` | **Rewrite.** Tool, durable compaction/continuation task and next-phase document; serialize against human/child delivery. Use compaction task result plus placed-summary receipt, not “compaction started.” | Reject sibling tool batches; one continuation after actual placement; cancellation/failure stays visible; `:24–130`. |
| `lead-fallback` | **Rewrite.** Host observer/task for final failed submissions after native retries, committed one-attempt recovery decision; configure permitted fallback and submit once. `onYield` is not an error-settlement hook. | User cancellation stays stopped; no fallback loop, no unsafe-action replay; `:7–38`. |
| `pi-tmp` | **Port.** Per-conversation environment, `beforeTool` path guard, result warning, existing bounded sweeper. | No global environment cross-talk between children; no `TMPDIR=PI_TMP`; `:5–24`. |
| `quota-startup` | **Port to host UI command.** Reuse quota cache/check/repair core; no automatic interactive repair during recovery. | Missing telemetry is not authority; sign-in/Keychain repair needs attended confirmation; `:8–58`. |
| `secret-redaction` | **Security rewrite.** Reuse redactor; sanitize provider stream/final assistant text and tool streaming/final output **before Durable commits**, plus model-bound context. `afterTool` handles final output/details/structured output; `afterResponse` cannot replace a message. | Persisted partials, diagnostics, spill files and export must not introduce new plaintext leak paths. Preserve signed thinking/tool arguments rather than corrupting execution. A throwing redaction hook must fail closed, not be skipped; `:5–30`, [D7]. |
| `storage-guard` | **Port.** Host input preflight writes the existing lead-only notice; document last threshold to avoid repeat on restart. | Keep 50 GB/5 GB behavior, no forced cleanup turn, no Workstream scratch deletion; `:10–30`. |
| `subagent` | **Rewrite.** Native child conversations, anchor/dispatch/report tasks, Worker/roster/collection documents and preserved tools/routing rules. Reuse profile/resolver/validation logic; drop RPC pipe control for Durable children. | Full lifecycle, model/effort/independence receipts, one-level nesting, cancellation, collect and unknown-result handling; `:154–245,553–847,1138–1165`. |
| `telemetry` | **Port recorder; rewrite mapping.** Harness telemetry plus committed usage/lineage event projection and deduplicated export. | Replay attempts visible; aggregate usage unchanged for non-replayed work; `:19–138`. |
| `tool-groups` | **Port/rework.** `deferred`, `modelTools`, `control.addTools` plus enabled-group document. Drop synchronous branch/event-bus dependence. | No child allowlist widening, including nested-tool callers; resume/fork/compaction retain exposure; `:11–73`. |
| `working-mode` | **Port rules; rewrite state.** Host command, alignment tools, rewindable selection document and recorded guidance entries; **not** a changing system section. | Selected versus applied, AFK alignment, fork-as-of and compaction resend; `:127–254`. |
| `pi-claude-code-use` **2.2.1** | **Rewrite provider/tool adapter.** Payload transform at pi-ai `onPayload`, provenance-based alias registry, canonical incoming tool names before execution/persistence, display transform. Pin package behavior; do not pretend it is a Durable extension. | Claude subscription billing/auth, MCP/deferred aliases, prompt/tool cache behavior, compaction, children and model switching. Current `extensions/index.ts:1209–1258` relies on SDK hooks; [D8]. |

**Security/provider gate:** no daily-use pilot until assistant and tool sanitization demonstrably happen before Durable storage/display and the subscription path works. Do not rewrite only the final rendered transcript: Durable stores streaming partials and tool intent too. Preserve existing redaction scope deliberately; where a provider requires verbatim signed material or tool arguments, treat storage as sensitive and document the boundary. If supported stream boundaries cannot enforce the intended policy, request an upstream API addition or stop the rollout—do not patch SQLite afterward. Hooks generally report-and-skip errors except `beforeTool`, so a best-effort observer is not a security gate. [D1], [D7]

### Skills, AGENTS.md, MCP and auth

- **Reuse all eight bundled skills as content:** `atelier`, `autonomous-grill`, `define-goal`, `model-orchestration`, `orient`, `workstreams`, `analyze-source-for-workbench`, `customize-pi-web-presentation`. Keep the last manual-only as today. Port discovery, slash/inline expansion, relative-path resolution and runtime locators; do not rewrite their domain guidance. Inventory external packages/skills before daily-use qualification: web-access, phone tools, monitor, goal/relay and other user packages are not covered merely by this 16-row table.
- **Host AGENTS.md/resource loading explicitly.** Reuse the supported loader where possible without creating an `AgentSession`; otherwise port only discovery/trust behavior with parity fixtures. Stable base sections contain repository/global instructions, skill catalog and tool guidance. Record source revisions/hashes without copying credentials. Preserve project trust precedence and global-provider isolation. Run `node scripts/context-usage.mjs` before/after actual harness-input changes and report lead/child token deltas. [W12]
- **MCP is a host integration, not automatic extension compatibility.** Keep configuration, trust/approval and OAuth controls, reconnect actual MCP clients, and register their tools in Durable with schema validation and provenance. Default effects to unsafe; allow replay only for reviewed read/idempotent operations. Interrupted transport is not proof of failed execution. Deferred/nested tools must enforce the same allowlists. Reuse Durable code-mode/tool-search where required; preserve MCP approval/dialog recovery through recorded decisions, not lost Promises. PI WEB currently installs coding-agent MCP/code-mode/tool-search factories. [W12], [D1]
- **Credentials stay local and outside transcripts/documents.** Reuse Pi’s credential store/refresh synchronization and existing login surfaces through a pinned auth adapter, not a second credential file format. Prove simultaneous old/new hosts cannot race OAuth refresh; a retained host must resolve credentials without a live broker request on every turn. Auth changes propagate explicitly; revoked or unavailable access parks affected work and never switches billing silently. Retaining a supported coding-agent auth/resource library is acceptable during migration; executing an opaque coding-agent turn is not Durable recovery.
- Keep telemetry and the Claude adapter active for every Durable lead and child. Any remaining direct/nested Pi CLI process still loads the existing telemetry extension and `pi-claude-code-use` package. Do not claim coverage for arbitrary third-party `ctx.ui` extensions; show incompatibility before Chat creation and retain the legacy route until each required capability is ported or Thomas explicitly retires it.

## Phases and verification

Each phase lands separately behind a flag or explicit backend selection. All development uses owned linked worktrees; trials use isolated data, sockets, ports, credentials/profile directories and service labels. No phase promotes the installed checkouts without Thomas’s go-ahead. Documentation/design work does not authorize the tests that reboot or interrupt his machine.

### Phase A — pinned pilot and failure proof, no user-facing switch

**Ship:** a headless test host on **`@earendil-works/pi-durable@1.4.0`**, exact matching `pi-ai`, `chord`, `pi-telemetry` and `pi-codemode` 1.4.0 dependencies/lock; Node satisfies the package’s `>=22.19.0` floor. Use its faux provider and real files/processes. The pilot exercises minimal child/question/admission implementations, not a full Workbench port; repeat those same fixtures against production bindings in later phases. Include a narrow Claude/redaction feasibility spike, not the whole extension port. [D2], [D9]

**Finish line:** the following crash matrix is runnable and passes against the published package. Every interruption uses explicit barriers, not timing sleeps. Run graceful `close`, hard host kill and reopen separately; repeat each fault window enough to catch nondeterministic delivery races (initial gate: 20 iterations). Record exact versions, request/effect counts, task IDs, database integrity and cleanup. Tests in upstream source were read for this plan, **not executed**.

| Case | Required observation |
| --- | --- |
| Generation before/after partial commit | One admitted input; ordinary request resent after host death; committed partial visibly aborted; final answer completes. Distinguish provider-deferred recovery if enabled. |
| Safe tool, unsafe tool | Stored/current safe-safe reruns; safe-unsafe and unsafe-safe do not. Kill after an external effect but before result: effect count remains one or visibly unknown, never assumed undone. Also have the model propose the same unsafe action anew; host guard must require reconciliation. |
| Child launch/report | Kill before child admission, after child result, before parent delivery and after delivery before receipt. One child assignment and one logical report; collection neither lost nor falsely marked read. Include parent cancellation and Worker leaf settlement. |
| Queued input | Kill before commit and after commit before HTTP acknowledgement; retry stable ID. Preserve steer/follow-up order, edits/withdrawal and failed-run policy; reject changed payload under reused ID. |
| Unanswered question | Kill before/after question commit, after answer commit before delivery, and after delivery before acknowledgement. Restore one question or one answer outcome; stale answer rejected. Repeat attention viewed/newer-request race. |
| Schema upgrade/rollback | On disposable 1.3 data, back up closed store, open a copy with 1.4 (SQLite v2), verify recovery, prove old binary refuses upgraded copy, restore untouched backup and reopen under 1.3. Separately test our document/task version upgrade, missing definition and failed migration. |
| Ownership/storage/security | Reject competing owner and stale endpoint; disk full/failed commit yields no success acknowledgement. Crash-loop parking is visible. Redaction survives split streaming chunks and sanitizer errors; no duplicate provider refresh or alias misrouting. |

The background subagent example itself uses `close()`/reopen, not a hard-kill test; its helper still returns `content` while 1.4 tools expect `output`. Compile and adapt the pattern against the pinned types rather than copying it as verified code. [D4]

**Reverse:** remove/disable pilot; no production data exists. **Estimate: 5–8 engineer-days.** Stop at day 8 for review if subscription or pre-persistence redaction lacks a credible supported route; do not hide the blocker in Phase B.

### Phase B — one new Durable Chat beside legacy Chats

**Ship:** runtime locator/router at `SessionRouteService`, independent pinned host/store, provider/security essentials, core coding tools, resource/skill loader, Working Mode, telemetry, durable queue, `ask_user` and `request_attention`. Explicitly opt in per **new** Chat; legacy stays the default. No automatic transcript conversion and no replay of a real Chat into both runtimes.

**First installation is not seamless for already-running legacy sessions.** Their JavaScript state cannot be extracted from today’s sessiond. Trial side by side in an isolated instance first; install the production router only in an owner-approved quiescent window after legacy turns, children, queues, dialogs and affected terminals settle. Never run two full daemons against one data directory. If Thomas cannot allow that window, pause production adoption and cost a legacy-owner routing bridge separately rather than silently interrupting work.

**Finish line:** one scoped daily-use Chat works end to end without regression to a neighboring legacy Chat. Verify proxy/API contract, authentication/trust, snapshot/sequence convergence, queue/Stop, media, model changes, commands and question persistence; no lost acknowledged input. Required unsupported capabilities block opt-in with a reason. Backend cannot be toggled mid-turn. Run browser/WebKit tests and native readiness/window-restoration checks, then an attended trial. Promote only this isolated slice after Phase A passes.

**Reverse:** disable new Durable Chat creation; existing Durable Chats remain on their known-good host or paused/readable. Continue a task in a new legacy Chat via an explicit handoff if necessary; do not claim lossless reverse conversion. **Estimate: 8–12 days.**

### Phase C — Workbench parity and promotion survival

**Ship:** remaining matrix ports, native Subagents/Workers, retained bash completion, Atelier delivery, dialogs, history actions and retained terminal owner. Turn the existing promotion script into a compatibility preflight plus broker/web replacement, preserving host service labels and referenced builds. Existing legacy Chats remain marked unprotected; never weaken their current restart refusal.

**Finish line:** two full broker promotions and a failed-health rollback while a lead streams, a Worker/leaf and Subagent run, bash writes output, a PTY server runs and a question waits. Assert the same provider request and process identities continue, one terminal receipt/report per child, no missing queue/answer, and automatic client convergence. Test explicit cancel/end separately. A fork must not acquire source Workers/questions. Every extension row gets a focused parity check; test failure paths at their owning boundary rather than duplicating a full browser suite per extension.

Also prove actual launchd ownership and a controlled orderly reboot/startup on a test machine or approved maintenance window. On boot, restore only eligible admitted work after trust/auth/workspace checks; uncertain mutations stay blocked. Memory/CPU/reconnect/commit latency are measured at Thomas’s observed active-Chat count and twice that count. Freeze a tolerable baseline before implementation; proposed initial budgets are no more than 2× legacy idle memory at that count and local reconnect within five seconds after broker health. These are acceptance proposals, not measurements.

**Reverse:** keep old versions of hosts and router; disable expanded opt-in. Never abort live hosts as a rollback shortcut. A family upgrade that fails before candidate scheduling or admission restores its closed-store backup; after either occurs, retain the new store and repair forward or preserve it read-only with explicit handoff. **Estimate: 15–25 days**, including parity review. If a required external extension enters scope, re-estimate before widening this phase.

### Phase D — migrate existing transcripts and Worker continuity

**Ship:** an offline, restartable importer plus preview/report; conversion is per quiescent Chat family, never in place. Coding-agent JSONL is **not** Durable JSONL. Retain immutable original files and a checksum manifest. Build a temporary destination, validate it, then atomically publish the runtime locator; incomplete imports remain invisible. Import operation IDs make retries harmless.

- Preserve messages, thinking/tool pairs, custom entries, branch edges, compaction summaries, timestamps, model/usage metadata, media references and source entry IDs. Unknown custom entries stay inspectable, not silently discarded or interpreted as tasks.
- Historical input is appended as history, **never submitted to execute**. Import no live task from transcript guesses. Incomplete legacy calls become explicit interrupted/unknown history. Pending asks/outcomes and Working Mode restore through their typed rules.
- Preserve public Chat IDs and Workstream links. Maintain source-entry → Durable-entry mapping for navigation/quotes/exports. Show an import provenance marker and any unsupported history behavior before accepting conversion.
- Move owned Worker identity/lineage only with no active legacy dispatch and an exclusive migration marker that prevents old-runtime mutation. Import its persisted child history or leave that Worker explicitly legacy/unavailable; never claim continuity from a summary alone. Validate foreign/fork ownership rejection.
- Compare full-history/tree/export counts and hashes of content, media resolution, latest model context/compaction boundary, question state and routing metadata. Test malformed/truncated input, interrupted import, duplicate import, disk full and a representative multi-branch corpus, then one owner-selected Chat.

**Finish line:** Thomas can inspect old branches and continue a converted Chat/Worker correctly; every loss or unsupported entry is reported before migration approval. Keep old readers and original files regardless of execution cutover.

**Reverse:** before any Durable scheduling, answer delivery or input, return the locator and Worker ownership marker to untouched legacy data. After either history advances, freeze both histories and use explicit export/handoff or a verified reverse importer; **do not switch back to a stale legacy transcript**. **Estimate: 7–12 days.**

### Phase E — default, observe, then remove legacy execution

**Ship:** Durable becomes the default for new Chats after Thomas accepts parity. Observe for at least two working weeks, three full promotions and two approved shutdown/startup cycles. Retire legacy PI WEB execution only when every active Chat is migrated or deliberately archived; an exception keeps the legacy backend in place and blocks its removal; no live legacy Worker lock or queued delivery may remain.

**Finish line:** crash/promotion/import/upgrade gates stay green; no unexplained duplicate effects, lost inputs or question outcomes; auth costs and resource use accepted; fallback and backup restoration rehearsed. Remove obsolete SDK session wiring/RPC launch paths from the Workbench web runtime, not the history reader or original transcripts. Update current contracts, installation/promotion instructions, session-log tooling and compatibility notices. Archive the old executable/lockfile for the agreed rollback window (proposed 30 days). A separately installed Pi CLI may remain; it must not open Durable stores.

**Reverse:** restore compatible router/build and disable new admission. Stores that have advanced remain on their compatible host or read-only; binary downgrade alone is not data rollback. Removing old code is reversible by revision, not by erasing new history. **Estimate: 3–5 days**, plus the observation window.

**Total: 38–62 engineer-days (roughly 8–13 weeks), plus owner observation and external waits.** This is wider than a chat demonstration: retained runtime/PTY ownership, subscription parity, migration and safe rollback are included. Reserve a further 20–30% planning contingency until Phase A resolves provider/security risks. Do not authorize all phases as one indivisible project.

## Upstream and release policy

### Keep PI WEB mergeable

Keep PI WEB’s authentication, web/API proxy, workspace/catalog services, plugin transport and ordinary client leaf modules close to `jmfederico/pi-web`. Keep Workbench Working Mode, Worker routing, Workstream semantics and Durable extension bundles in Workbench-owned modules. Add a runtime implementation behind the existing route contract rather than replacing `piSessionService.ts` wholesale or scattering Durable conditionals across routes/components. A second real backend justifies this seam; a universal agent framework does not. [W2], [W3]

Propose upstream, as separate optional changes:

- A backend-neutral session service registration/capability seam with the coding-agent backend still the default.
- Stable input/command IDs, committed-admission receipts and reconnect snapshot/epoch behavior.
- Separation of session/plugin execution lifetime from transport disposal, plus observable loaded revision/protocol.
- Generic attention persistence and test fixtures where upstream wants them—not Workbench-specific policy or a mandatory Durable dependency.

No upstream acceptance is assumed. Keep a small documented fork patch set and a contract-test fixture usable against both backends. The in-flight path B branch already uses a selected-Pi import facade (`src/piSdk.ts`/`src/piRuntime.ts`); do not accidentally let that selection upgrade the **separately pinned Durable dependency closure**. [W13]

### Absorb Durable breaking releases deliberately

The pin is **1.4.0, not `^1.4.0`, `latest` or main**. Its README says experimental; 1.4 auto-migrates SQLite to schema v2, which 1.3 cannot open. Patch releases have also broken APIs. The evaluation records further changes on October 22 main; do not attribute them to the pinned release. [D1], [D2]

Keep one adapter for Durable API/events, one Workbench document/task schema version set, and a pinned dependency lock. Each host records all three plus its executable/resource revisions. Before any upgrade:

- Read the actual release diff/changelog; compile the adapter and all extensions against the candidate.
- Run the crash matrix, package/provider/redaction parity and stored-history corpus; test pending tasks/questions, missing definitions and document fork/compaction behavior, not just fresh databases.
- Upgrade a **copy** of representative stores first. Produce and restore a consistent pre-upgrade backup under the old binary. Test task/document migrations as well as SQLite migration.
- Canary one quiescent family; retain other families on old hosts. Change default only after observation. No old binary opens an upgraded live store. Never resume a copied production graph against real effectful tools. If the candidate has resumed pending work or admitted new work, preserve its advanced store and repair forward; rollback must not discard it or repeat its external effects.

Do not resurrect Earendil’s removed experimental client/server as a supported compatibility layer. Its removal’s motivation remains unverified; Durable itself continues to ship. The [compatibility request][adapter-issue] is an upstream user request for an adapter, not a maintainer commitment.

## In-flight work: keep, fold in, drop

| Work | Disposition | Required handoff |
| --- | --- | --- |
| **Path B upstream merge**, branch `merge/upstream-chat-upstream` | **Keep and finish independently.** Establish the merged client/protocol baseline before Phase B edits; Phase A can run in parallel. Do not mix the merge and Durable replacement into one review. | Inspection found a clean branch at [the recorded review snapshot][path-b], which follows the upstream merge with a browser-fixture/focus fix and incorporates newer upstream main as well as the v1.202610.6 work. It is not proof of completed verification or owner acceptance. Recheck its head when implementation starts. |
| **Today’s `request_attention`** | **Keep behavior; fold persistence into Durable documents/reporters.** | [The feature change][attention-change] adds explicit attention requests and removes turn-end desktop alerts. It is in `pi-workbench` but was **not an ancestor of inspected path B**. Preserve its tool, status, API acknowledgement and native/client notification checks when reconciling that merge. |
| **Today’s solo-window bar** | **Keep unchanged.** Backend-neutral client behavior, no runtime rewrite needed. | [The feature change][solo-change] shows one Chat as a slim bar, becoming a Grid at the second Chat. It is also absent from path B’s inspected ancestry. Preserve `workbenchWindows`/`WorkbenchWindowTabs` tests and native restored identity. |
| **Smaller option: independent RPC-child owner + safe lead recovery** | **Keep as fallback; fold its boundary/tests into this plan; defer a parallel full implementation.** Existing detached bash and partial promotion remain useful now. | Reuse any already completed independent runner, admission journal or effect-reconciliation work; do not throw it away. No completed implementation of the whole smaller option was verified. Drop the need for an RPC-child owner only for fully Durable-native children; legacy Chats/CLI still need their own honest limits. |
| **Broader seamless-promotion proposal** | **Fold in retained ownership and revision pinning**, not its SDK-specific implementation as a second permanent host runtime. | Keep the stronger same-execution promotion tests separate from Durable crash/reboot recovery tests. Neither is a substitute for the other. |

Until Phase C ships, use existing `switch-web`/`switch-workbench` when their preconditions hold; full `switch` still needs owner approval and interrupts legacy sessions. This plan authorizes no restart. [W11]

## Risks, mitigations and kill criteria

“Kill” means stop the affected Durable rollout, retain all data and known-good hosts, and return to Thomas with the smaller option’s explicit scope. It does not authorize a silent goal change or automatic downgrade.

| Risk | Mitigation | Stop/fall-back criterion |
| --- | --- | --- |
| Claude subscription or alias behavior differs | Phase A feasibility test using authorized local credentials; Phase B real lead/child/MCP/compaction parity, quota and billing evidence. | Cannot establish the same subscription path without changing billing/provider terms or maintaining invasive private patches: no daily-use switch. |
| Secrets enter new partial/task/output storage | Pre-commit stream/tool boundaries, explicit sensitive-field policy, split-chunk/error tests, owner-only storage and redacted telemetry. | Any known new plaintext leak path or skipped required sanitizer: stop admission until fixed; no “display-only” waiver. |
| Unsafe tool repeats or wrong owner resumes | Conservative replay defaults, operation IDs, external-effect reconciliation and fenced single owner; explicit Stop semantics. | Any duplicate external effect, simultaneous store writer or mutation after durable cancellation: block rollout immediately. |
| Schema/task migration loses accepted work | Immutable originals, consistent backups, versioned definitions, copy-first migration and pinned hosts. | Rollback requires silently losing accepted input/results or repeats an external effect; importer cannot preserve required context/branch semantics. |
| Host/PTY ownership makes promotion destructive | Real launchd tests, own service labels, no wildcard cleanup, exact loaded revisions/build retention. | Cannot retain same execution through ordinary promotion: do not call Phase C complete. Thomas must choose a narrower recovery-only contract or fallback. |
| Experimental API/upstream churn dominates | Exact pins and a narrow adapter; no immediate upgrade merely because a release exists. | Two candidate upgrades each consume more than one engineer-week of repair, or required fixes force a broad Durable fork: pause and review maintenance cost. |
| Memory/I/O or replay cost defeats local use | Per-family isolation, idle unloading, FULL/commit measurements at real concurrency; usage distinguishes retries. | Miss agreed Phase C budgets after one bounded tuning pass, or model/subscription costs exceed Thomas’s accepted limit: stop default rollout and resize architecture/scope. |
| Scope expands through external packages | Inventory before opt-in; unsupported features visible; no general compatibility shim. | A daily-use requirement remains unsupported without owner-approved deferral, or total estimate exceeds 62 days before contingency: re-plan before the next phase. |
| Recovery is mistaken for authority | Restore only admitted work; preserve trust/mode/stop and independent state boundaries. | A new permission, overnight execution host, publication path or managed Run becomes necessary: obtain Thomas’s direction first. |

## Open decisions for Thomas

**Thomas decided on 2026-10-22:** (1) independent family hosts; (2) after a shutdown, restore work **paused** until he resumes it (not automatic recovery); (3) existing history stays read-only on the legacy runtime and new Chats start on Durable, so **Phase D's transcript import is dropped** (about 7–12 days less; total roughly 31–50 engineer-days); (4) compatibility floor: all Workbench behaviors plus Claude subscription, MCP and his inventoried daily-use external tools. Phase A approved and passed (branch pilot/pi-durable-phase-a-20261022, packages/durable-pilot/RESULTS.md). Decision 5: SQLite WAL with `synchronous=FULL` **plus `PRAGMA fullfsync=ON`** (power-cut safe on macOS, about 4 ms per commit); budget released gate by gate. Next: independent review of Phase A, then Phase B.

The recommendations below are proposed defaults, not approval inferred from the request for a plan.

1. **Promotion guarantee and ownership.** Options: embed one Harness/store in sessiond and accept replay on full promotion; retain independent family hosts; or retain one shared all-Chat host. **Recommend independent family hosts**: preserves the earlier same-execution promotion goal and isolates upgrades/crashes. Cost is extra processes and service/protocol work. Also approve a one-time quiescent installation window, or request a separately estimated legacy-owner bridge. Decide before Phase B.
2. **After nightly shutdown.** Options: resume eligible admitted work automatically when local services start; restore paused until Thomas resumes; or move execution to an always-on host. **Recommend local automatic recovery for already admitted work, with unknown-effect/trust/auth holds**; no work while powered off. Confirm this narrow recovery change before its first owner trial; remote hosting is separate scope.
3. **History and rollback policy.** Options: convert all history at once; convert selected quiescent families while preserving originals; or keep legacy history read-only and start fresh. **Recommend selected-family conversion**, full-history reader and a 30-day executable/backup rollback window after cutover. Never delete original transcripts as part of removal. Decide before Phase D.
4. **Required compatibility floor.** Options: all current packages before any opt-in; a named daily-use set; or broad feature cuts. **Recommend the 15 Workbench behaviors plus Claude subscription, MCP and the owner’s inventoried daily-use external tools**, with TUI-only surfaces remaining on standalone Pi until requested. No silent API-key switch or feature retirement. Confirm the external package list before Phase B.
5. **Storage and delivery budget.** Options: default SQLite NORMAL; FULL with measured cost; or JSONL fsync. Options for funding: approve all phases or release effort gate by gate. **Recommend SQLite FULL and approve only Phase A’s 5–8 days first**, with the 38–62-day total and contingency visible. Phase A returns evidence and a revised estimate, not a user-facing runtime switch.

## Evidence and verification of this plan

Inspected on 2026-10-22: the retained evaluation; Durable release README/changelog, published npm metadata, foreground/background examples, generation/tool recovery tests and SQLite/type boundaries; the two supplied articles; Workbench foundation/contracts, promotion script, extension bindings/skills and native readiness; PI WEB integration session/proxy/client boundaries and path B’s recorded ancestry. Local references use [Workbench’s inspected revision][wb-base] and [PI WEB’s inspected revision][web-base]; path B is separately anchored below.

This is source-level planning and author self-review. No packages were installed in the repositories, no code changed, no services restarted, and no crash/model/reboot/browser tests were run. Relative-file and Git-target checks cover the document only, together with `git diff --check`. One direct HTTP HEAD link probe returned 403 for the Flavio article; its full text was successfully retrieved through the web fetch tool. No source required unavailable credentials. Context-usage checks do not apply: this plan changes no loaded prompt, tool or skill. Independent reader review was unavailable in this runtime; it remains a review gap, not a passing check.

Unverified: real Claude subscription/billing parity on Durable; pre-persistence redaction implementation; actual retained-host/PTY survival under launchd/systemd; production Mac power-loss durability; complete external-package inventory; importer fidelity on Thomas’s real transcripts; resource/cost estimates; path B’s test/owner-acceptance status; and any upstream willingness to adopt the proposed seams. The gates above exist to answer these before removal.

**Next decision: Thomas reviews the five choices and, if he wants to proceed, authorizes only the pinned pilot.**

### Source anchors

- **[D1]** [Durable 1.4.0 README](https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/README.md): concepts, close/resume, tools, forks, documents, watch/backpressure, storage and hook errors.
- **[D2]** [Durable changelog at 1.4.0](https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/CHANGELOG.md): SQLite v2, required document checkpoints, crash-loop parking, failed-run policy, telemetry and breaking patch releases.
- **[D3]** [Foreground subagent example](https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/test/examples/22-subagent-foreground.ts): child ownership and stable admission identity.
- **[D4]** [Background subagent example](https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/test/examples/23-subagent-background.ts): anchors/reporters, cancellation boundary, `content` helper and close/reopen demonstration.
- **[D5]** [Generation recovery tests](https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/test/harness-generation-recovery.test.ts#L125-L163) and [tool recovery tests](https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/test/harness-tools-recovery.test.ts#L109-L209): aborted partial, replay-policy intersection, current cwd on replay; real bash interruption at lines 338–364.
- **[D6]** [Durable Node SQLite facade](https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/src/storage/sqlite/node.ts) and [Chord SQLite connection](https://github.com/earendil-works/pi/blob/v1.4.0/packages/chord/src/sqlite/node.ts#L174-L201): public facade, default WAL/NORMAL and explicit close checkpoint.
- **[D7]** [Durable hook types](https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/src/harness/types.ts#L852-L906): `afterResponse` observes, `afterTool` can replace results; no coding-agent message-replacement contract.
- **[D8]** [Claude Code use package source](https://github.com/ben-vargas/pi-packages/tree/main/packages/pi-claude-code-use) (installed 2.2.1 inspected) and [pi-ai payload hook](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/types.ts#L170-L185). Package source main is discovery, not a reproducible version pin; capture 2.2.1 package integrity in the pilot lock.
- **[D9]** [npm 1.4.0 metadata](https://registry.npmjs.org/@earendil-works/pi-durable/1.4.0) and [release manifest](https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/package.json): exact dependency family and Node floor.
- **[D10]** [Earendil announcement](https://earendil.com/posts/pi-durable/) and [Flavio Copes tutorial](https://flaviocopes.com/pi-durable/): framework versus coding agent; reissued model calls, unsafe effects, single owner and power-loss qualification. Release types take precedence over evolving article snippets.
- **[W1]** PI WEB `src/server/sessiond.ts:156–174,296–334,397–425`; [`sessiondStateOwnership.ts`](https://github.com/tschuehly/pi-web/blob/176ccb08bc993ea6705cb8288676bd24bfe87817/src/server/sessiond/sessiondStateOwnership.ts): current single daemon state owner and teardown.
- **[W2]** PI WEB [`src/server/sessions/sessionService.ts:43–125`](https://github.com/tschuehly/pi-web/blob/176ccb08bc993ea6705cb8288676bd24bfe87817/src/server/sessions/sessionService.ts#L43-L125); `piSessionService.ts:1033–1104,1501–1547`: route seam, in-process SDK construction/disposal.
- **[W3]** PI WEB [`src/server/sessiond/sessionProxyRoutes.ts`](https://github.com/tschuehly/pi-web/blob/176ccb08bc993ea6705cb8288676bd24bfe87817/src/server/sessiond/sessionProxyRoutes.ts), `src/sessiond/sessionDaemonClient.ts:43–92`, `src/server/realtime/sessionEventHub.ts:24–75`, `src/client/src/sessionSocket.ts:178`: proxy and snapshot/sequence boundaries.
- **[W4]** Workbench [`apps/pi-web-macos/Sources/PIWebMac/PIWebReadiness.swift`](../../apps/pi-web-macos/Sources/PIWebMac/PIWebReadiness.swift), [`apps/pi-web-macos/README.md`](../../apps/pi-web-macos/README.md); PI WEB `pi-web-plugins/terminal/server/server-plugin.ts:80–84`, `terminalService.ts:278–282,382–387`: native readiness and current PTY disposal.
- **[W5]** Workbench [`extensions/subagent/index.ts`](../../extensions/subagent/index.ts), [`packages/worker-registry/src/registry.js`](../../packages/worker-registry/src/registry.js), [`docs/plans/level-1-durable-workers.md`](level-1-durable-workers.md): current identity, locking, collection and shutdown behavior.
- **[W6]** PI WEB `src/server/sessions/askUserTool.ts:122–173`, `piSessionService.ts:2030–2094,4680–4695`; [`openAsksFromTranscript.ts`](https://github.com/tschuehly/pi-web/blob/176ccb08bc993ea6705cb8288676bd24bfe87817/src/server/sessions/openAsksFromTranscript.ts): non-blocking question and restored outcome semantics.
- **[W7]** PI WEB [`src/server/sessions/requestAttentionTool.ts`](https://github.com/tschuehly/pi-web/blob/176ccb08bc993ea6705cb8288676bd24bfe87817/src/server/sessions/requestAttentionTool.ts), `piSessionService.ts:1236–1237,1980–2000`: current in-memory request and exact-ID acknowledgement.
- **[W8]** Workbench [`extensions/working-mode/index.ts`](../../extensions/working-mode/index.ts), [`extensions/tool-groups/index.ts`](../../extensions/tool-groups/index.ts), [Working Mode contract](../foundation/working-mode.md).
- **[W9]** Workbench [`packages/workstream-session-coordination/`](../../packages/workstream-session-coordination/), [`skills/workstreams/SKILL.md`](../../skills/workstreams/SKILL.md), [Workstream contract](../contracts/workstreams.md#session-association).
- **[W10]** Workbench [`extensions/telemetry/index.ts:19–138`](../../extensions/telemetry/index.ts), [`extensions/secret-redaction/index.ts`](../../extensions/secret-redaction/index.ts).
- **[W11]** Workbench [`scripts/promote-installed:53–72,90–153,175–234`](../../scripts/promote-installed), [`extensions/background-bash/jobs.mjs:154–251`](../../extensions/background-bash/jobs.mjs): current partial promotion and detached runner, not proof of the target.
- **[W12]** PI WEB `src/server/sessions/builtinExtensionFactories.ts:1–14`, `piSessionService.ts:974–1104,2883–2952`, `globalProviderPolicy.ts:253–278`; Workbench [`skills/`](../../skills/): current built-ins, trust, resource expansion and provider isolation.
- **[W13]** Path B [`src/piSdk.ts`](https://github.com/tschuehly/pi-web/blob/1d41990933a8f30f81c49b40eb443ac4874aea48/src/piSdk.ts), [`src/piRuntime.ts`](https://github.com/tschuehly/pi-web/blob/1d41990933a8f30f81c49b40eb443ac4874aea48/src/piRuntime.ts) and [upstream’s session service](https://github.com/jmfederico/pi-web/blob/4c31ebc8ee78e8e1ca5eadd4ab24967dcb5a95ba/src/server/sessions/piSessionService.ts): coding-agent remains upstream’s backend.

[wb-base]: https://github.com/tschuehly/pi-workbench/tree/f7f8f54b32f5215e921bc8686471d814c678abb9
[web-base]: https://github.com/tschuehly/pi-web/tree/176ccb08bc993ea6705cb8288676bd24bfe87817
[path-b]: https://github.com/tschuehly/pi-web/commit/1d41990933a8f30f81c49b40eb443ac4874aea48
[attention-change]: https://github.com/tschuehly/pi-web/commit/8e27a9b842c2067e08730d5bbacc373fb16d35bb
[solo-change]: https://github.com/tschuehly/pi-web/commit/04a79e013e28a7c828491298ab73d77ef9e56d05
[adapter-issue]: https://github.com/earendil-works/pi/issues/10386
