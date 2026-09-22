# Subagent and Worker Iterative Improvement Plan

Status: Step 1 and background-first system guidance owner-approved and implemented on 2026-08-11; its per-child `followUp` delivery failed the busy-lead case and was replaced by one coalesced `steer` signal on 2026-08-29. Steps 2–6 remain proposals for owner review.

## Decision requested

Approve or revise the remaining order below. Step 1 now makes explicitly backgrounded child work wake the attended lead once per attention cycle, however many children finish. A later, provider-aware cache-ping pilot may keep the lead's prompt cache warm while the child runs, but it must remain measurable, bounded, and easy to disable.

The remaining review questions are:

1. **Resolved:** the owner approved one terminal completion turn without a new human message; Decision 98 records the scoped Level 1 clarification and its authority limits.
2. May we run an opt-in, Anthropic-only cache-ping pilot as a scoped extension of that exception—up to seven additional synthetic lead turns—and as an exception to the current recommendation against an automatic Level 1 ping scheduler?
3. **Resolved:** Decision 99 makes explicit `background: true` the system-prompt preference for most delegated work. It remains guidance rather than a mechanical default; foreground blocking is the immediate-dependency exception.

If the owner accepts question 2, record the bounded experiment in [`decisions.md`](../foundation/decisions.md), without changing the global cache default or persistent launch guidance.

## Outcome for the owner

The owner should be able to delegate work without watching a blocked terminal or repeatedly asking whether a child has finished. The lead should remain available for useful parallel work, receive one clear completion signal, reconcile every result, and stay inside the current attended Level 1 authority boundary.

Later steps should make delegated work easier to understand, correct, and coordinate:

- richer progress without opening child transcripts;
- clearer failure and recovery guidance;
- bounded lead-to-child guidance and child-to-lead questions;
- safer parallel work in one repository; and
- peer collaboration only if simpler lead-mediated coordination proves insufficient.

This is an empirical roadmap, not a commitment to build every feature. Each step must solve an observed problem before the next step expands capability.

## What already works

The current extension supports:

- fresh Subagents for one bounded assignment;
- durable attended Workers that preserve context within one semantic scope;
- foreground execution with streamed presentation;
- in-session background execution;
- status, collection, cancellation, typed outcomes, and shutdown cleanup.

The current limitations are important:

- a foreground child blocks the lead until it returns;
- streamed progress is presentation-only and does not renew the lead's prompt cache;
- a background child does not wake an idle lead when it finishes;
- the lead cannot guide a running child;
- a child cannot ask the lead or owner for help mid-dispatch;
- separate Pi processes can overwrite each other's file changes because file mutation queues are process-local; and
- no child may outlive the attended parent session.

Subagents remain fresh actors for narrow context or Independence. Workers remain continuity-bearing actors for repeated bounded work in one scope. Neither receives managed Run authority, Acceptance authority, or Publication authority.

## How we will improve the system

For every step:

1. Name the human problem and the smallest behavior that might solve it.
2. Add deterministic lifecycle and safety tests before relying on model behavior.
3. Use the behavior in meaningful attended sessions.
4. Evaluate those sessions with `/skill:workbench-compound` and Primary Evidence.
5. Keep, revise, or remove the behavior before expanding the next capability.

Promote a change into persistent guidance only after either:

- three comparable sessions support the same narrow improvement without a material contradiction; or
- one reproducible, high-impact correctness failure justifies an immediate fix and the fix passes a direct validation case.

## Step 1 — Background completion wakeup

### Human problem

A long foreground child makes the lead unavailable. A background child avoids that block, but today the owner or lead must poll or remember to collect it.

### Recorded decision

Decision 98 approves one coalesced terminal completion turn for explicitly backgrounded children. Pi wakes the lead with `sendMessage(..., { deliverAs: "steer", triggerTurn: true })`. This starts a real, billed lead model turn without a new human message; it either reads the live cached prefix or pays the miss after expiry. It grants no new authority and remains bounded by the attended Level 1 session.

The woken lead may reconcile the terminal results the default `subagent_status` roster names. It may not use the signal as authority to start unrelated work, retry, relaunch, publish, or accept an outcome. This limit is partly prompt-guided rather than mechanically enforced, so unexpected actions count as a failed pilot observation.

### Failed per-child `followUp` pilot

The first pilot sent one bounded `followUp` per terminal child, identifying the execution and outcome. It passed its idle-lead smoke, then failed the busy-lead case it was meant to answer. In one 23-child fan-out the lead received 23 wakes: 20 arrived after the results were already collected and 12 produced no useful work. `followUp` also holds the signal until the whole run stops, so a lead in a long tool batch learns nothing until it would have checked anyway. Per-child identity was the cause, not a detail: the lead reconciles the whole `subagent_status` roster at once, so every wake after the first restates work already claimed.

### Rejected follow-ups

Two adverse reviews on `openai-codex/gpt-5.6-sol`, independent of the authoring model family, rejected two proposed refinements on 2026-08-29. Adding "finish your current step first" to the signal was rejected because the signal arrives at a model boundary, so the instruction means "continue what was already intended", which the finished child may have invalidated; interrupting is sometimes correct and message text cannot decide which case applies. Printing uncollected children to the terminal when the agent settles was rejected because it is visible only in the interactive host, leaving RPC and graphical hosts with no signal, while `subagent_status` already reports the terminal-uncollected count as the recovery path. The same reviews established the receipt guard and the bulk-collection predicate now recorded in Decision 98.

### Implemented quick win

`background: true` remains explicit. Terminal background children coalesce into exactly one generic bounded `steer` signal, delivered at the lead's next safe model boundary.

The completion signal should:

- name no execution and carry no result, because the lead reconciles the default status roster rather than one child;
- tell the lead to collect and reconcile each terminal-uncollected child exactly once, which `subagent_collect` does for the whole set when it is called without an `executionId`;
- use `steer` delivery so a busy lead is reached between turns of one long run;
- wake an idle lead with `triggerTurn: true`;
- suppress every later completion until this signal is delivered; and
- return to idle only on delivery of that exact message or on `agent_settled`, never on status or collection.

For a Worker, the terminal result and registry receipt must settle and the dispatch lock must release before the completion signal is sent. If a background receipt cannot settle, one separately deduplicated bounded `outcome_unknown` attention wakeup reports that failure without claiming lock release; a foreground failure returns `outcome_unknown` directly with the child result marked inspection-only. The terminal result remains available through the existing adapter for collection. Session shutdown still cancels live children. No wakeup may survive that shutdown.

### Completion evidence

- An idle lead starts one new turn when a background child finishes.
- A busy lead in a multi-step tool batch receives the signal at the next model boundary, with children still finishing after it was sent.
- A fan-out produces one signal, one status snapshot, one collection per child, and no stale completion turn afterwards.
- Duplicate terminal observations do not create duplicate turns.
- Every terminal outcome remains collectable and attributable.
- A Worker can be dispatched again after its completion wakeup without a stale busy lock.
- Shutdown produces no late wakeup and leaves no child running.
- The wakeup turn's input, output, cache, and total usage are recorded.
- The woken lead performs no unrelated action.

## Step 2 — Child-execution cache posture pilot

### Human problem

A child that runs longer than the provider's short prompt-cache lifetime can make the lead repay its large prompt prefix on the next turn. Foreground presentation heartbeats do not help because they never reach the model.

### Important constraints

There is no free cache refresh in Pi. A cache ping is a real lead model request: it reads the cached prefix, adds a small message and response to the session, consumes quota, and may trigger model behavior.

The earlier evidence-backed cache recommendation paired long retention with foreground blocking for a single 10–60-minute child, reserved backgrounding for fan-out or useful parallel lead work, and rejected an automatic Level 1 ping scheduler. Decision 99 now prioritizes Human Attention by making explicit background execution the system-prompt preference while retaining foreground blocking for immediate dependencies. This does not settle cache economics or make background execution a mechanical default.

For Anthropic short retention, one renewal costs roughly one cache read. Long retention becomes cheaper than short retention after about eight synthetic renewals, before output overhead; pings remain cheaper than accepting one later miss until roughly eleven renewals. The first ping experiment uses the tighter seven-renewal cap. Pi's `PI_CACHE_RETENTION=long` / `cacheRetention: "long"` setting maps to a one-hour cache only for an Anthropic model whose compatibility flags support long retention, so every observation must record the actual provider, model, and compatibility result.

### Measurement prerequisite

Do not start the posture comparison until Workbench can observe cache misses programmatically. Installed Pi currently exposes detailed idle-versus-model-switch misses only through TUI behavior, not a supported SDK event. The visible notice is gated at 20,000 missed tokens or $0.10, `/session` aggregates misses without cause, and Pi's detector ignores noise below 1,024 tokens.

Implement or upstream a read-only cache observation that uses session entries and per-turn usage without importing Pi's private distribution files. Pin it against the installed detector's behavior and expose the cause, idle gap, missed tokens, and missed cost. This is the instrumentation requested by Recommendation 1 in [Prompt-cache economics](../research/sources/prompt-cache-economics.md). Keep `showCacheMissNotices` enabled as a human-visible cross-check, but do not treat its thresholded notice as complete pilot data.

### Proposed staged comparison

Use at least three comparable meaningful sessions per posture before changing policy. Stage A therefore requires at least 12 attended observations across four postures; Stage B adds at least six if it runs. Alternate eligible postures when practical, and record task shape, lead-prefix size band, expected child duration, actual duration, and whether the lead had useful parallel work.

**Stage A — establish foreground and background baselines**

1. **Foreground + short retention:** the mechanical omitted-`background` baseline, now an exception to Decision 99's prompt guidance.
2. **Foreground + long retention:** the standing recommendation for one 10–60-minute child.
3. **Background + short retention:** explicit backgrounding plus the Step 1 completion wakeup.
4. **Background + long retention:** explicit backgrounding plus the completion wakeup on an eligible Anthropic model.

This stage separates two questions: whether keeping the lead available is useful, and which retention posture reduces cache waste. It does not assume that backgrounding is economically better.

**Stage B — run only if pings still have a plausible use**

Compare background + long retention with background + short retention plus bounded pings for work expected to run 10–30 minutes. Track the timestamp at `before_provider_request`; Anthropic's time-to-live begins at request start, so schedule with a safety margin before five minutes rather than from response completion.

For the ping posture:

- while at least one child is running and the lead is idle, send one compact cache-maintenance message;
- use one session-level ping for all active children, never one timer per child;
- stop immediately when the owner or lead becomes active, all children finish, the model changes, the session shuts down, or the cap is reached;
- cap the first pilot at seven renewals, covering roughly 30 minutes; classify longer executions separately rather than presenting them as successful ping cases; and
- keep pings off for OpenAI and Gemini until their cache-renewal and pricing behavior is directly verified.

A ping should state that background work is still running and that no collection, cancellation, or unrelated action is requested. This instruction reduces accidental meddling but does not enforce it mechanically; any unexpected tool use or verbose response fails that observation.

The completion wakeup either renews a live cache or pays the miss after expiry. Record it separately so it does not silently distort the comparison.

### What we compare

For each posture, record:

- programmatically observed idle-driven and model-switch cache misses;
- cache-read, cache-write, input, output, and total usage;
- actual provider, model, retention eligibility, and model switches;
- number and timing of cache-ping and completion-wakeup turns;
- whether the lead performed unintended work after a synthetic turn;
- whether backgrounding enabled useful work or only created noise;
- whether the owner found the behavior helpful;
- child duration and number of active children; and
- whether useful parallel work already renewed the cache.

### Decision after the pilot

Keep current defaults when evidence is inconclusive. Otherwise:

- retain completion wakeup only if at least three comparable sessions eliminate polling without duplicate, premature, or unrelated lead actions;
- retain, narrow, or revise the background-first guidance after at least three comparable sessions show whether its Human Attention benefit outweighs cache and reconciliation costs;
- retain a ping option only if at least three comparable Stage B sessions use less total lead quota than background + long retention, produce no unintended lead action, and are preferred by the owner; otherwise remove it; and
- prefer a retention posture only when comparable sessions show lower measured cache waste without a compensating usage or reliability regression.

Then resolve every part of Deferred Design Decision 19 explicitly:

- whether long retention becomes the default lead posture;
- which immediate-dependency cases should remain foreground exceptions to Decision 99's background-first guidance;
- whether children expected to outlast the chosen retention window should start immediately after a checkpoint or compaction; and
- whether the resulting policy belongs in environment defaults, `extensions/subagent/` guidance, the model-orchestration skill, or nowhere persistently.

No global default or persistent launch guidance changes before this owner review.

## Step 3 — Progress that answers “what is happening?”

### Human problem

The current status surface exposes the latest observation, but not enough context to judge whether a child is making progress or stuck.

### Proposed improvement

Parse each child's own persisted Pi session log without a model call. Add a compact status line containing bounded mechanical facts such as:

- elapsed time and last activity time;
- message and tool-use counts;
- current or last tool category;
- token usage when available;
- unresolved tool calls; and
- terminal state.

Decision 89 keeps each child's persisted Pi session inspectable even though it remains unmanaged. For a Worker, counts must start at the current dispatch boundary rather than including its complete resumed session lineage. Gate parsing on session-file size changes so unchanged status reads remain cheap. Implement the derivation in `packages/pi-execution-adapter/`; keep `extensions/subagent/` responsible for thin attended presentation. Reimplement and attribute the reviewed source pattern rather than copying its code.

The default view stays short. Detailed observations remain expandable and local. Status derivation must not summarize raw thinking or create another narrative ledger.

### Completion evidence

Owners can distinguish active, idle, blocked-looking, and finished work without opening the child transcript, and the status computation adds no model usage.

## Step 4 — Safer failure handling and parallel mutation

Background execution makes concurrent mutation more attractive, so this is a live consequence of Step 1 rather than optional cleanup. Level 1 children inherit the same working directory, and the existing process-local file queue does not coordinate separate lead and child processes.

Before adding richer communication:

1. Classify provider and process failures deterministically where possible.
2. Show one bounded recovery recommendation: wait, inspect, cancel, or relaunch.
3. Detect overlapping background implementer activity in the same repository.
4. Begin with a visible warning and explicit affected paths when known.
5. Decide separately whether to prevent concurrent mutating children or introduce isolated workspaces. Do not claim cross-process file safety without an enforced mechanism.

This step must preserve typed outcomes and must never report cancellation as successful until termination is confirmed.

## Step 5 — Lead-to-child guidance and child help requests

Only start this experiment after completion wakeups and richer status have shown that status plus cancel-and-relaunch is insufficient.

Pilot a bounded, lead-mediated message envelope for:

- information;
- question and reply;
- guidance;
- conflict;
- progress; and
- completion.

Messages may carry free text, but routing, provenance, reply relationships, rate limits, and backlog limits remain deterministic. A material objective change still cancels the current assignment and starts a new one.

This step requires an explicit revision or scoped exception to Decision 80, which currently forbids attaching messages to a running child.

## Step 6 — Bounded peer collaboration

Consider direct child-to-child information and help requests only when repeated evidence shows that lead mediation is the bottleneck.

The first experiment would allow active executions launched by one attended lead to exchange information inside one named collaboration group. It would not allow peer delegation, authority transfer, a durable Worker mailbox, or autonomous continuation after the parent exits.

This step requires an explicit revision to Decision 50. Stop the experiment if it creates message loops, hidden scope changes, unresolved conflicts, excessive context, or weaker result attribution.

## Pilot Evaluation Questions

These stable IDs remain the default question source for `/skill:workbench-compound`. Select at most three questions for any one session. IDs are append-only, and the file's SHA-256 identifies the evaluated revision.

- **Q1 — Delegation value:** Did delegation provide a concrete benefit—fresh context, Independence, parallelism, mechanical volume, or specialist capability—compared with working inline?
- **Q2 — Worker threshold:** When at least two related assignments were expected, did Continuity reduce re-briefing or improve the outcome enough to justify a Worker?
- **Q3 — Background posture:** Did background execution enable useful parallel work or attended monitoring, or did it add polling and reconciliation noise?
- **Q4 — Cache behavior:** Did the selected cache posture reduce measured waste at an acceptable quota and Human Attention cost?
- **Q5 — Result reconciliation:** Did the lead reconcile every child result before relying on it and disclose failed Independence honestly?
- **Q6 — Communication need:** Which observed problem would lead-to-child or peer messaging have prevented, and could a simpler status, result, cancellation, or relaunch mechanism have solved it?
- **Q7 — Coordination quality:** When parallel actors exchanged or lacked information, did that reduce duplicate work or create hidden scope changes?
- **Q8 — Shared-file risk:** Did parallel mutation touch overlapping files, lose work, or require reconciliation given the absence of cross-process write protection?
- **Q9 — Human visibility:** Did the user receive material timing, failure, uncertainty, and confidence changes without routine execution telemetry?
- **Q10 — Prompt usefulness:** Which persistent instruction measurably changed behavior, and which instruction was ignored, redundant, or misleading?
- **Q11 — Retired:** Stateless Model Call value moved to `ws-stateless-model-call`; do not select Q11 for this roadmap.
- **Q12 — Completion signal:** Did the coalesced terminal signal eliminate polling without creating duplicate, post-collection, premature, unrelated, or unexpectedly costly lead turns?

Per-session evaluations are working evidence under `~/.pi-workbench/compound/`. They are not an authoritative global ledger. The owner decides whether a Learning Candidate is promoted into an extension, instruction, skill, contract, or decision record. Until the roadmap is approved, the stable questions remain usable for observing current behavior; the proposed runtime steps do not become supported behavior.

## Explicitly separate work

Which model and Model Effort each Cognitive Role should get, and whether the profile instruction
sentences change outcomes, are evaluated in [Model–role and profile-instruction evaluation](model-role-evaluation.md),
not in this roadmap; that plan reuses these Evaluation Questions and `/skill:workbench-compound`.

Stateless Model Calls are evaluated in `ws-stateless-model-call`, not in this roadmap. Workstream checkpoint continuation is useful session infrastructure, but it is not a substitute for Subagent and Worker monitoring, wakeup, communication, or conflict safety.

## Boundaries that remain in force

The following are invariants for this roadmap, not options this plan may relax:

- every child remains bounded by the attended parent session;
- a background handle is not durable autonomous work;
- the lead reconciles every result;
- child messages grant no authority;
- no peer mailbox or open-ended conversation exists;
- no model decides lifecycle facts that can be derived mechanically;
- no automatic retry, relaunch, publication, or Acceptance is introduced; and
- no implementation claims cross-process file safety without an enforced mechanism.

## Recommended next implementation slice

Step 1 and background-first prompt guidance are complete. Before Step 2, implement the programmatic cache observation and gather the foreground/background and short/long-retention baselines without changing launch guidance. Add the automatic ping posture only after the owner separately approves that scoped experiment. Do not implement lead-to-child messaging, peer collaboration, automatic retries, or a global cache default in this slice.

## Evidence basis

- [Level 1 child Pi execution](level-1-subagents.md) — current Subagent behavior, background lifecycle, outcomes, and attended shutdown.
- [Level 1 durable Workers](level-1-durable-workers.md) — Worker continuity, dispatch locking, background collection, and retirement boundaries.
- [Prompt-cache economics](../research/sources/prompt-cache-economics.md) — provider cache behavior, Pi mechanics, cost crossover, and Deferred Design Decision 19 candidate policy.
- [Subagent and Worker monitoring and communication](../research/sources/subagent-worker-monitoring-and-communication.md) — completion wakeup prior art, session-log status derivation, messaging safeguards, and cross-process mutation risk.
- [Decision record](../foundation/decisions.md) — Decisions 50, 80, and 89, plus Deferred Design Decision 19.
- Installed Pi extension documentation, `docs/extensions.md`, sections `pi.sendMessage(message, options?)`, `before_provider_request`, `message_end`, and `ctx.sessionManager` — wake delivery, request timestamps, per-turn usage, and session-entry access.
