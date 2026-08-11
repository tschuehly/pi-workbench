# Subagent/worker monitoring and communication: external extensions and the installed Pi SDK

## Verdict

None of the three reviewed packages should be adopted wholesale in V1. Each brings a complete
orchestration or messaging product with transport and lifecycle assumptions that exceed the current
hub-and-spoke, no-peer-mailbox boundary in Decision 50 and the no-running-child-messages boundary in
Decision 80. But each demonstrates a narrow mechanism Workbench's `extensions/subagent/`,
`packages/pi-execution-adapter/`, and `packages/worker-registry/` do not yet have, and one of them
(edxeth's `pi-subagents`) is a different, unrelated package from the same-named `pi-subagents`
already reviewed in [`subagent-implementations.md`](subagent-implementations.md) (that review covered
`nicobailon/pi-subagents` at `abf07371`; this one covers `edxeth/pi-subagents` at `4c4545da`, a much
larger fork of `HazAT/pi-interactive-subagents`). Do not conflate the two in future citations.

The single most load-bearing finding is a correction, not a new feature: **Pi's own installed
`edit`/`write` tools serialize file mutations only within one process's environment, keyed by
canonical path.** Two separate Pi processes — a lead and a child, or two sibling children — editing
the same file have no cross-process lock, no optimistic conflict check, and no ACID guarantee. This
is verified directly from the installed `@earendil-works/pi-agent-core` 0.84.1 source (below), and
none of the three reviewed packages closes this gap either.

The clearest adoptable mechanisms, in source-faithful order of fit, are: (1) Pi's
`ModelRuntime.completeSimple()` path for one out-of-process inference without an AgentSession;
direct in-session `ModelRegistry.complete()` remains deferred because it lacks the simple path's
Model Effort mapping; (2) `pi-subagents`' deterministic, non-LLM tool-batch classifier and quiet-window
provider-error recovery ladder (wait → model nudge → kill) as a template for deterministic recovery
decisions after eligible errors; (3) its direct parsing of a child's own session JSONL to derive
message/tool/token counts without a model call, as a template for richer `subagent_status` output;
and (4) `pi-peer`'s and `pi-intercom`'s `InboundGuard`/broker
rate-and-backlog limits as a template if Workbench ever adds any child-initiated wake channel. Direct
peer-to-peer mailboxes and child-initiated mid-task escalation (`caller_ping`, `contact_supervisor`)
are the most capable mechanisms reviewed, but Decision 50 and the system-overview's out-of-scope list
("Peer worker mailboxes, open-ended worker conversations... not part of the initial implementation")
currently exclude exactly this shape from V1. This report treats that boundary as authoritative and
frames those mechanisms as bounded `Experiment` candidates for a future decision, not as adoptable now.

## Scope and method

Reviewed on 2026-08-09 against the exact revisions named in the assignment; all three matched without
needing a newer HEAD:

| Repository | HEAD | Commit date | License |
| --- | --- | --- | --- |
| [`shift-labs-ai/pi-peer`](https://github.com/shift-labs-ai/pi-peer) | `5e8fcb20c14cc5bc99a704e5b466f22bcf553861` | 2026-08-09 | MIT (Shift Labs) |
| [`nicobailon/pi-intercom`](https://github.com/nicobailon/pi-intercom) | `0685e199b7003cddbb190352f1669fe23be8b9c2` | 2026-08-09 | MIT (Nico Bailon) |
| [`edxeth/pi-subagents`](https://github.com/edxeth/pi-subagents) | `4c4545da9053c95e921f0620519000972d8babae` | 2026-08-08 | MIT (HazAT, edxeth) |

All three were cloned directly (`git clone` + `git log -1`) and read from disk, not summarized from
READMEs alone; source citations below name the exact file. The local Pi baseline is installed
`@earendil-works/pi-coding-agent`, `pi-agent-core`, and `pi-ai` 0.84.1 under
`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent`. Its declarations and SDK/extension
documentation were read directly for the edit/write and Stateless Model Call claims below.

Prior context loaded and not repeated here: `AGENTS.md` (root and `docs/`), the complete
[`vocabulary.md`](../../foundation/vocabulary.md) and [`system-overview.md`](../../foundation/system-overview.md),
the decision record, `extensions/subagent/index.ts`, `packages/pi-execution-adapter/`,
`packages/worker-registry/`, and the existing ledgers
[`subagent-implementations.md`](subagent-implementations.md),
[`prompt-cache-economics.md`](prompt-cache-economics.md), [`firstmate.md`](firstmate.md), and
[`afk-supervision-packages.md`](afk-supervision-packages.md). Findings that duplicate those ledgers
(the RPC-subprocess baseline, cache-miss economics, FirstMate's watcher/current-state split) are
referenced rather than re-derived.

## What each package is

- **`pi-peer`** (0.2.0, Bun/Biome, `bun test` — 10 test files): a directory-mailbox extension so any
  two local Pi sessions can `list_peers` and `message_peer` in plain text, with an optional Redis
  transport for cross-machine team messaging. No daemon; sending is `writeFile`, receiving is
  `fs.watch`. Source: [`README.md`](https://github.com/shift-labs-ai/pi-peer/blob/5e8fcb20/README.md),
  [`ARCHITECTURE.md`](https://github.com/shift-labs-ai/pi-peer/blob/5e8fcb20/ARCHITECTURE.md).
- **`pi-intercom`** (0.10.0, `tsx --test` — 15 test files): a local-socket/named-pipe broker for
  direct 1:1 messaging with a blocking `ask`/`reply` protocol, a session-list/compose TUI overlay, and
  an opt-in `contact_supervisor` tool that appears only in children launched by the *other*,
  already-reviewed `nicobailon/pi-subagents` package. Source:
  [`README.md`](https://github.com/nicobailon/pi-intercom/blob/0685e199/README.md).
- **`edxeth/pi-subagents`** (2.7.0, `node --test`, `bunx tsc`/`biome`/`knip` — a fork of
  `HazAT/pi-interactive-subagents`, with 69 TypeScript files and about 12,500 physical lines across
  `src/runtime`, `src/launch`, `src/session`, `src/tools`, and `src/mux`): a large named-agent framework with interactive (Herdr/cmux/tmux/zellij/
  WezTerm) and background (`pi -p`) children, orchestrator mode, spawn depth/width ceilings, a live
  TUI widget, and child-to-parent `caller_ping`/`subagent_done` lifecycle tools. Source:
  [`README.md`](https://github.com/edxeth/pi-subagents/blob/4c4545da/README.md).

## Findings by mechanism

### Deterministic classification and recovery decisions

`edxeth/pi-subagents` separates deterministic classification from any resulting model work:

- `classifyAssistantMessageForMixedBatch` is a zero-model-call classifier. It inspects one assistant tool-call batch and marks it
  blocking, purely from tool names and each child's resolved `async` frontmatter, when an async
  subagent launch shares a batch with a non-subagent tool call — closing a race in Pi's own batch
  contract without asking a model whether the batch is "mixed."
  Source: [`src/runtime/batch-classifier.ts`](https://github.com/edxeth/pi-subagents/blob/4c4545da/src/runtime/batch-classifier.ts).
- `ProviderErrorRecoveryController` applies a timer- and `ctx.isIdle()`-driven ladder to provider or
  agent errors unless the package's limited pattern list classifies them as clearly permanent;
  unfamiliar errors remain recovery-eligible. It arms countdowns
  (`[30_000, 60_000, 90_000]` ms by default), uses quiet windows and event supersession to reduce
  interference with recovery already in progress, sends a plain `"continue"` nudge on early windows,
  and writes a structured exit signal plus shuts the child down after the last window. The decision
  ladder is deterministic, but each `continue` nudge triggers another model turn; `ctx.isIdle()` alone
  cannot guarantee that a nudge never lands between provider retries.
  Source: [`src/tools/provider-error-recovery.ts`](https://github.com/edxeth/pi-subagents/blob/4c4545da/src/tools/provider-error-recovery.ts).

`pi-peer`'s `InboundGuard.admit` (below, under loop/backlog limits) is the same category: dedupe,
rate, and backlog decisions are pure functions of counters and timestamps, never a model call.
Source: [`src/peer/policy.ts`](https://github.com/shift-labs-ai/pi-peer/blob/5e8fcb20/src/peer/policy.ts).

None of the three sources adds a general "is this session stuck" classifier comparable to
`pi-watchdog-supervisor`'s hash-based repeat detector or FirstMate's watcher (both already covered in
[`afk-supervision-packages.md`](afk-supervision-packages.md) and [`firstmate.md`](firstmate.md)); the
provider-error ladder above is scoped specifically to provider/agent errors, not general stalls.

### Result retention, queued delivery, and wakeup

These are four distinct capabilities rather than one durability claim:

- **Restart durability:** `pi-peer` stores mailbox files by conversation identity and retains unread
  mail for up to 30 days, so resumable sessions can drain it later. `pi-intercom` and
  `edxeth/pi-subagents` keep coordination/result state in memory and lose it when their broker or
  parent process resets. Source: [`pi-peer/src/peer/registry.ts`](https://github.com/shift-labs-ai/pi-peer/blob/5e8fcb20/src/peer/registry.ts),
  [`pi-intercom/broker/broker.ts`](https://github.com/nicobailon/pi-intercom/blob/0685e199/broker/broker.ts),
  [`pi-subagents/src/runtime/state.ts`](https://github.com/edxeth/pi-subagents/blob/4c4545da/src/runtime/state.ts).
- **In-session retention:** `pi-intercom` keeps a bounded in-memory mailbox for recently disconnected
  explicitly named sessions. `edxeth/pi-subagents` caches completed results in process; `caller_ping`
  takes a separate delivery path and is not stored in that completion cache.
- **Queued delivery:** `edxeth/pi-subagents` routes completion and ping messages through
  `pi.sendMessage(..., { deliverAs: "steer" | "nextTurn" })`, allowing delivery at a safe turn
  boundary. Source: [`src/runtime/result-router.ts`](https://github.com/edxeth/pi-subagents/blob/4c4545da/src/runtime/result-router.ts).
- **Idle wakeup:** `triggerTurn: true` wakes an idle recipient in the reviewed messaging extensions;
  that is separate from retaining the message or result.

Workbench retains a live execution's terminal result in its adapter state and exposes it through
`adapter.status()` and `subagent_collect` for the attended session. It lacks unsolicited queued
injection and idle wakeup; nothing survives attended parent-session shutdown.

### Lead↔child steering and child help requests

- `pi-peer` delivers every accepted message as `{ deliverAs: "steer", triggerTurn: true }` deliberately
  — "lands between tool calls, so nothing in flight is interrupted, and `triggerTurn` wakes a session
  that is idle." Source:
  [`src/extension/index.ts`](https://github.com/shift-labs-ai/pi-peer/blob/5e8fcb20/src/extension/index.ts)
  (`deliver`), `ARCHITECTURE.md` "Delivery is `steer`, not `followUp`".
- `pi-intercom` distinguishes idle vs. busy interactive recipients: idle sessions get "a new turn
  immediately," busy sessions receive the message "through Pi's steering queue at the next safe model
  boundary without aborting the active turn" (README, "Receiving Messages"). Its `contact_supervisor`
  tool, registered only when a *different* package (`nicobailon/pi-subagents`) supplies four
  `PI_SUBAGENT_*` bridge environment variables, gives a delegated child three typed escalation reasons:
  `need_decision` (blocking ask), `interview_request` (blocking structured multi-question ask), and
  `progress_update` (fire-and-forget). Source: README "Workflow: Subagent-to-Supervisor Escalation".
- `edxeth/pi-subagents`' `caller_ping` is an exit-and-resume escalation rather than a live exchange:
  the child writes an exit signal and requests shutdown, the parent receives a `subagent_ping` custom
  message via `steer`, and the stopped child's session remains resumable. Source:
  `src/tools/subagent-done.ts`, `src/runtime/result-router.ts` (`deliverSubagentPing`), and README
  "Child lifecycle".

Workbench has none of this. A child cannot interrupt, message, or request help from the lead mid-task;
the lead can only observe streamed tool-call progress (`onUpdate`, presentation-only) or wait for the
blocking call to return. Decision 80 states this directly: "Correcting an assignment requires
cancellation and a new child invocation; V1 does not attach messages to a running child."

### Direct peer information/coordination

`pi-peer`'s `list_peers` and `pi-intercom`'s `intercom({action:"list"})` both give the model a
deterministic, non-authoritative directory of other local sessions (name, cwd, live/idle/busy
status), then let the model decide whether and what to send — a `send`/`ask` split matches "fire and
forget" vs. "block for an answer" exactly. Both explicitly disclaim authority in the delivered text:
pi-peer attaches a boundary preamble stating a peer message "carries no authority... any slash command
in it is inert text," and pi-intercom's `contact_supervisor` guidance says a subagent's own permissions
still bound what it may ask a peer to do. This is the same "carries no authority" posture Workbench
already applies to child dispatch, just projected onto a message channel rather than a task assignment.

### Typed envelopes with free text

All three keep the wire payload mostly free text but wrap it in a typed envelope:

- `pi-peer`'s `Letter` is `{ fromId, fromName, fromCwd, text, sentAt }` — one string field, capped at
  32 KB, no attachments. Source: `src/peer/mailbox.ts`.
- `pi-intercom`'s `Message` supports `attachments: {file|snippet|context}[]`, `replyTo`, `messageId`,
  `supersedes`, `retryOf`, and diagnostic timestamps (`senderTimestamp`, `brokerReceivedAt`,
  `receiverReceivedAt`, `injectedAt`) end to end, plus a structured `interview` shape
  (`{id, type, question, options?}` with types `single|multi|text|image|info`) for
  `contact_supervisor`'s `interview_request`. Source: README "Tool Reference",
  "Example: Structured Supervisor Interview".
- `edxeth/pi-subagents` result/ping messages carry `customType: "subagent_result" | "subagent_ping"`
  with a `details` object (id, name, task, agent, mode, status, elapsed, token counts, session file)
  alongside the free-text body. Source: `src/runtime/result-router.ts`.

None of the three treats the free-text body as structured input the receiver must parse to route —
the envelope carries routing/provenance/threading metadata, and the body stays natural language for the
model. This matches Decision 47's "typed episodes... containing outcome, claim status, evidence" shape
at a much smaller scale, and is a reasonable template if Workbench ever needs a typed wrapper around
free-text child-to-lead content.

### Loop/backlog limits

- `pi-peer`'s `InboundGuard` (`DEFAULT_LIMITS`): identical text from the same sender within 10s is
  dropped; more than 8 messages from one sender in 30s is throttled; 50 undelivered letters already
  queued on the agent caps further delivery. All three checks run before delivery and are unit-pinned.
  Source: `src/peer/policy.ts:16-24`.
- `pi-intercom`'s broker enforces `MAX_SESSIONS = 128`, `MAX_UNREGISTERED_CONNECTIONS = 32`,
  `RATE_LIMIT_CAPACITY = 240` tokens refilling at `120`/s per connection, `MAX_MAILBOX_MESSAGES = 256`,
  and separate 16 KiB/64 KiB caps for the generic extension-channel bus. Source:
  `broker/broker.ts:30-42`.
- `edxeth/pi-subagents` bounds fan-out rather than message volume: `spawn-depth` (default 1) decrements
  at each spawn level so a mutual-launch loop terminates; `spawn-width` caps concurrent children per
  parent with a hard ceiling of 16 regardless of configuration. Source: README frontmatter table
  ("spawn-depth", "spawn-width"), `src/runtime/spawn-width.ts`.

Workbench currently has one dispatch at a time per worker (`WorkerRegistry.beginDispatch` fails
preflight on a busy worker rather than queueing) but no rate, backlog, or fan-out ceiling for
subagents, because V1 subagents are attended one-at-a-time or explicit `background:true` launches, not
an autonomous or peer-triggered channel that could loop.

### Local logs bound to a lead session, and summaries/counts by message type

`edxeth/pi-subagents`' live widget derives its per-child status entirely by re-reading the child's own
session JSONL on disk (`existsSync`/`statSync`/`readFileSync`, gated on file-size change so it does not
re-parse unchanged files) and counting entries by type: `messageCount`, `toolUses` (from
`role: "toolResult"` entries), cumulative and last-known `totalTokens`, and a set of still-pending tool
calls computed by diffing the last assistant message's `toolCall` blocks against subsequent
`toolResult` entries. All of this happens with zero model calls, purely from the child's own JSONL,
scoped from `getSubagentActivityStartIndex` (the point where the child's own turns begin, excluding any
forked parent history). Source:
[`src/runtime/widget.ts`](https://github.com/edxeth/pi-subagents/blob/4c4545da/src/runtime/widget.ts)
(`refreshRunningSubagentState`).

This is the strongest single adoptable mechanism in the review: it is a template for a richer
`subagent_status`/`worker_status` line — "N tool uses, M tokens, last activity: editing 3 files" —
computed by parsing the child's own Pi-persisted session file rather than by asking a model to
summarize, and it is "local" in exactly the sense the assignment asks about: it reads a log file that
belongs to one child, scoped to that child's own session, not a shared or lead-owned log.

Workbench's current `adapter.status()`/`ExecutionStatus` (in `packages/pi-execution-adapter/`) exposes
`latestObservation` (one item) and `observationCount`, not counts by type or token/tool tallies; the
underlying child Pi session file already exists (Decision 89 keeps it inspectable) but nothing parses
it for a compact status line today.

### Stateless Model Call without an AgentSession

Pi itself exposes the mechanism more directly than any reviewed extension. In installed
`@earendil-works/pi-coding-agent` 0.84.1, `ModelRuntime` implements the `@earendil-works/pi-ai`
`Models` interface and publicly exposes `complete()` and `completeSimple()`. Calling either method
does not require `createAgentSession()`, `AgentSession`, or `SessionManager`. Source:
`dist/core/model-runtime.d.ts` and `docs/sdk.md`.

Pi exposes its existing in-session runtime to extensions through the `ctx.modelRegistry`
compatibility facade, whose public `complete()` method accepts a model, context, and API-specific
options. Constructing another `ModelRuntime` in the same process would duplicate credential,
catalog, and availability-refresh state. An out-of-process SDK host can own or receive one
`ModelRuntime`.
Source: `dist/core/model-registry.d.ts` ("Synchronous compatibility facade exposed to extensions")
and `docs/extensions.md` (`ctx.modelRegistry`). `ModelRegistry` does not expose `completeSimple()`;
its `complete()` accepts raw API-specific options, while Pi's ThinkingLevel-to-provider mapping occurs
on the simple-stream path.

The `pi-ai` `Context` type requires only `messages`; `systemPrompt` and `tools` are optional. The
returned `AssistantMessage` contains provider, model, stop reason, and usage, but does not echo Model
Effort; a wrapper would have to carry effort from its requested binding. Calling the completion API
alone creates no Pi conversation or session file. This is distinct from `pi --no-session` or
`SessionManager.inMemory()`, which suppress persistence but still create a full in-memory
AgentSession. Session-free is not cache-free: request options can still carry cache retention and
provider affinity.

These primitives demonstrate a technically smaller path for one bounded semantic classification or
summary than launching a child process. They provide no tool loop, actor identity, Continuity,
message tree, or authority by themselves. `edxeth/pi-subagents`' `mode: background` (`src/launch/background.ts:65`,
`src/launch/resume.ts:129`) plus `no-session: true` (README) remains a separately evidenced,
process-based one-shot composition rather than the same mechanism.

### Idle Worker routing

None of the three sources auto-routes work to whichever peer or child is idle. `pi-peer`'s
`list_peers` and `pi-intercom`'s `intercom({action:"list"})` both surface idle/busy/unresponsive status
so *the model* can choose an idle target, and `pi-intercom`'s `cwd`-only targeting resolves to "the sole
live peer" in a directory when there is exactly one — a convenience for unambiguous addressing, not
load-balancing. `edxeth/pi-subagents`' Herdr/Zellij "auto" placement balances *pane geometry* among
already-launched panes, not idle-vs-busy agent selection. Workbench's own worker model is the sharper
mechanism here: `worker_dispatch` fails preflight immediately on a locked (busy) worker rather than
queueing or picking a different idle worker, and leaves that choice — reuse this worker, or launch a
fresh subagent — to the lead. No reviewed source improves on that.

### Shutdown

- `pi-peer`: `session_shutdown` marks the session offline (record kept, mailbox kept) rather than
  removing it, except for ephemeral sessions with no session file, which are removed outright because
  they can never be resumed. Source: `src/extension/index.ts` (`pi.on("session_shutdown", ...)`).
- `pi-intercom`: the broker auto-spawns on first connection and exits after `5000` ms idle once the
  last connected session disconnects (`broker/broker.ts:270`); clients reconnect automatically if the
  broker restarts.
- `edxeth/pi-subagents`: `shutdownSubagentsForParentExit` walks every running child and applies its
  `parent-close-policy` — `terminate` (default: SIGTERM, then SIGKILL after an escalation window for
  background children; abort + close-surface for interactive children) or `continue` (leave the child
  running and stop delivering its result to the closed parent). Source:
  [`src/runtime/shutdown.ts`](https://github.com/edxeth/pi-subagents/blob/4c4545da/src/runtime/shutdown.ts).

Workbench's `session_shutdown` handler calls `adapter.cancelAll("Attended parent session ended.")` and
awaits pending worker completions — closer to `pi-subagents`' `terminate` policy than to `continue`.
`pi-subagents`' `continue` option is a direct conflict with Decision 89 ("No child outlives the attended
parent") and should not be adopted as written; it is evidence that the *pattern* (some children may
deliberately outlive a closing parent) exists elsewhere, not a reason to weaken that decision.

### Shared-file conflict behavior

None of the three reviewed packages arbitrates concurrent file edits between sessions; all three are
messaging or process-lifecycle tools, not file-coordination tools. This makes the actually load-bearing
finding **Pi's own installed concurrency semantics**, verified directly rather than assumed:

- `createEditTool` and `createWriteTool` both wrap their mutation in
  `withFileMutationQueue(env, absolutePath, fn)`. Source:
  `@earendil-works/pi-agent-core` 0.84.1, `dist/harness/tools/edit.js` and `dist/harness/tools/write.js`
  (installed under `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/`).
- `withFileMutationQueue` keys its queue on `(env, canonicalPath)` via a `WeakMap<env, {queues,
  registration}>` and a promise chain per canonical path, so two `edit`/`write` calls against the same
  file *inside one process's `env`* are strictly serialized. Source: `dist/harness/tools/file-mutation-queue.js`.
- The queue's key is scoped to the `env` object, which is per-process. **Two separate Pi processes —
  a lead and a foreground/background child, or two sibling children — each construct their own `env`
  and therefore their own independent mutation queue.** There is no OS-level file lock, no read-time
  content hash or mtime check compared at write time, and no cross-process coordination anywhere in
  this code path. `edit`'s `execute` reads the file fresh (`env.readTextFile`) immediately before
  writing within its own queued turn, so within one process a second queued edit always sees the first
  edit's result — but a concurrent edit from a different process can freely interleave. The outcome is
  uncoordinated and can lose, overwrite, or corrupt updates without a reliable conflict marker.

This invalidates any assumption of cross-process ACID safety and is unaddressed by any of the three
reviewed sources: `pi-peer` and `pi-intercom` never touch project files; `edxeth/pi-subagents` isolates
interactive children into separate terminal panes and gives each agent an optional distinct `cwd`, but
nothing prevents two children configured with the *same* `cwd` — the common case for Workbench's Level
1 children, which currently always inherit `ctx.cwd` (`extensions/subagent/index.ts`) — from editing
the same file concurrently. Level 1's explicit absence of "enforced workspace isolation" (system
overview, "Out of scope") means this is a live, previously-unverified risk for any future feature that
runs two children (or a lead and a child) against the same working tree at once, not a theoretical one.

## Comparison to current Workbench implementation

| Mechanism | Workbench today | Strongest reviewed source |
| --- | --- | --- |
| Deterministic classification and provider-error recovery | None beyond typed status/settlement handling | `pi-subagents` provider-error ladder + batch classifier (non-LLM) |
| Unsolicited result delivery into a later parent turn | No; the lead must call `subagent_collect` or poll | `pi-peer` steer delivery; `pi-subagents` `deliverAs: "steer"/"nextTurn"` |
| Child-initiated help mid-task | None; only cancel + relaunch (Decision 80) | `pi-intercom` `contact_supervisor`; `pi-subagents` `caller_ping` |
| Peer-to-peer session discovery/messaging | None (Decision 50: hub-and-spoke only, no peer mailboxes) | `pi-peer` `list_peers`/`message_peer`; `pi-intercom` `intercom` |
| Loop/backlog limits on inbound child-originated messages | N/A — no inbound channel exists yet | `pi-peer` `InboundGuard`; `pi-intercom` broker rate/mailbox caps |
| Per-child status from its own session log | `observationCount` + last observation only | `pi-subagents` widget: parses child JSONL for message/tool/token counts |
| Shutdown of live children | `cancelAll` on `session_shutdown`, no exceptions | `pi-subagents` `parent-close-policy: terminate\|continue` |
| Shared-file conflict arbitration | None; relies on Pi's per-process mutation queue only | None reviewed; gap confirmed, not filled, by any source |

## Recommendations

These are source-faithful proposals for narrow, bounded mechanisms. None of them settles policy, and
none should be read as amending the decision record; several explicitly require an owner decision
before any implementation, most importantly wherever they touch Decision 50's peer-mailbox exclusion
or Decision 89's "no child outlives the attended parent" invariant.

### Adopt

- **Parse each child's own session JSONL for a richer, zero-model-call status line.** Adapt
  `pi-subagents`' `refreshRunningSubagentState` approach (message/tool-use/token counts by entry type,
  gated on file-size change) into `packages/pi-execution-adapter/` or the `subagent_status`/
  `worker_status` renderers in `extensions/subagent/index.ts`. This is read-only, adds no new
  authority, and directly improves an existing surface. Attribute the source pattern; do not copy code
  verbatim (MIT permits it, but the file layout and types differ enough that a reimplementation is
  simpler than an adaptation).

### Adapt

- **Deterministic tool-batch and provider-error classification as a template**, not the code itself.
  `pi-subagents`' `classifyAssistantMessageForMixedBatch` and `ProviderErrorRecoveryController`
  demonstrate that a useful class of "is this actionable" decisions can be made from tool-call shape
  and idle/error timers alone, matching Decision 55's "durable actionable items" posture and the
  already-approved FirstMate watcher direction (`firstmate.md`). Building Workbench's own equivalent
  belongs behind whichever contract eventually owns watcher-style supervision (see
  `afk-supervision-packages.md`'s recommendation 4), not inside `extensions/subagent/` directly.
- **Typed envelope-with-free-text shape** (routing/provenance metadata alongside a natural-language
  body) is a reasonable pattern if Workbench ever needs a wrapper around child-to-lead content richer
  than the current `ExecutionObservation`. `pi-intercom`'s `Message` fields (`replyTo`, `supersedes`,
  `retryOf`, delivery timestamps) are a concrete reference for what such an envelope should carry
  without becoming a second episode schema; Decision 47 already owns the authoritative typed-episode
  shape, so any adaptation should stay a presentation-layer envelope around existing observations, not
  a competing durable format.

### Experiment (requires an explicit decision before building)

- **Bounded child-to-lead escalation.** `pi-intercom`'s `contact_supervisor` can ask while the child
  keeps running; `edxeth/pi-subagents`' `caller_ping` instead sends context, exits, and leaves a
  resumable session. These are distinct answers to "the lead never learns a child is blocked until it
  returns." Both exceed current Level 1: Decision 80 does not attach messages to a running child, and
  automatic resumption after `caller_ping` would exceed its cancel-and-relaunch correction path. Do not
  build either against `extensions/subagent/` without first revising or scoping Decision 80. If live
  escalation is approved, `pi-peer`'s loop/backlog guard
  (`InboundGuard`: dedupe window, rate cap, backlog cap) is the right deterministic safety net to pair
  with it, because an escalation channel is exactly the shape that can loop.
- **Delivering a terminal or ping result via `steer` to an idle lead** rather than requiring
  `subagent_collect`. This is a smaller, more contained version of the above: it does not let a child
  interrupt an in-flight lead turn, only wakes an idle one — closer to what pi-peer's `triggerTurn`
  does for an idle receiver. Still requires deciding whether an unattended, model-initiated wake of the
  lead session is compatible with V1's continuous-Human-Attention framing (system overview, "Product
  model") before implementation.

### Reject

- **Installing any of the three packages, or their transport (Redis, local socket/pipe broker, or
  multiplexer surfaces), as a V1 orchestration dependency.** Their complete delivery, presence, and
  launch models exceed Decisions 50 and 80. Reuse narrow evidenced mechanisms behind Workbench-owned
  interfaces instead of importing a second coordination product.
- **`parent-close-policy: continue`** (letting a child outlive its closing parent) as written. It
  directly contradicts Decision 89. The underlying idea — some background work legitimately outlives
  one attended session — is a Level 4/durable-worker question, not a V1 extension change.
- **Redis-backed or any cross-machine peer messaging.** Out of scope for a single attended local
  session and not needed to evaluate any mechanism above; `pi-peer`'s local directory transport is
  sufficient evidence on its own.
- **Treating Pi's per-process file-mutation queue as sufficient file-conflict protection across
  processes.** It is not, per the verified source above. This is a finding to carry into any future
  design that lets two children (or a lead and a child) touch the same working tree concurrently. This
  is already a Level 1 risk because background implementer children share `ctx.cwd`; recording the risk
  does not itself require conflict-arbitration machinery.

## Confidence and limits

- Revision, date, and license claims for all three repositories are **high confidence** — read directly
  from `git log` and `LICENSE` files on the exact clones used for this review.
- Mechanism claims cite specific files and, where useful, line numbers from the cloned source, not
  README paraphrase alone; where a claim rests only on README wording (no corroborating source read),
  that is stated explicitly (e.g., `pi-intercom`'s in-memory disconnected-sender mailbox).
- The Pi edit/write concurrency claim is **high confidence**, read directly from the installed
  `@earendil-works/pi-agent-core` 0.84.1 distribution vendored under the installed
  `@earendil-works/pi-coding-agent` 0.84.1. It is an implementation detail, not a documented public
  guarantee, and should be re-verified after any Pi upgrade, consistent with the same caveat already
  recorded in `prompt-cache-economics.md` for other installed-Pi-source claims.
- The Stateless Model Call finding is **high confidence** from the installed 0.84.1 declarations and
  implementation: `ModelRuntime.completeSimple()` delegates directly to the model provider path and
  references no `AgentSession`, `SessionManager`, or session-file writer. `Context` and
  `AssistantMessage` establish optional tools/system prompt and returned provider/model/usage. This is
  installed implementation evidence rather than a documented promise and must be re-verified after
  Pi upgrades.
- The `edxeth/pi-subagents` process-based one-shot alternative remains weaker evidence: combining
  `mode: background`/`pi -p` with `no-session: true` is an inferred composition of independently
  verified fields, not a demonstrated dedicated classification feature.
- This report does not re-verify mechanisms already covered in `subagent-implementations.md`,
  `prompt-cache-economics.md`, `firstmate.md`, or `afk-supervision-packages.md` (the RPC-subprocess
  baseline, cache-miss/keepalive economics, and FirstMate's deterministic watcher); it references them
  by name rather than re-deriving them.
