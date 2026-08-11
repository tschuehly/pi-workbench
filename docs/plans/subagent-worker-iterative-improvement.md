# Subagent and Worker Iterative Improvement Plan

Status: active attended-use plan. It improves Level 1 from observed sessions without expanding current execution authority. Peer messaging, automatic monitoring turns, and mid-dispatch steering remain experiments rather than supported behavior.

## Outcome

Improve Subagent and Worker behavior through a short empirical loop:

1. state what we want to learn;
2. run the smallest supported behavior;
3. evaluate a meaningful Pi session with a fresh strong model;
4. accumulate evidence locally;
5. promote only source-backed Learning Candidates through explicit human judgment.

This plan is for humans deciding what to try next. [`compound`](../../skills/compound/SKILL.md) executes the evaluation step. Its per-session local reports are working evidence, not another authoritative ledger. Managed Runs continue to use the Run Analysis and Compounding contract in [`workflow.md`](../contracts/workflow.md).

## Current boundary

The implemented Level 1 extension supports fresh Subagents, durable attended Workers, foreground blocking, in-session background execution, status/collection/cancellation, typed outcomes, and shutdown cleanup. It does not currently support lead-to-child steering, child help requests, peer messaging, automatic completion wakeups, or cross-process file-conflict protection.

Keep these distinctions visible:

- a **Subagent** is fresh and suited to narrow context or independent judgment;
- a **Worker** preserves useful continuity across sequential assignments in one semantic scope;
- background execution still ends with the attended parent session;
- Pi's `edit` and `write` tools do not provide cross-process ACID protection;
- current coordination remains lead-mediated under Decision 50;
- prompt guidance does not turn an experiment into a supported capability.

The evidence and implementation comparisons are in [Subagent/worker monitoring and communication](../research/sources/subagent-worker-monitoring-and-communication.md), [Pi Subagent Implementation Evidence](../research/sources/subagent-implementations.md), and [Prompt-cache economics](../research/sources/prompt-cache-economics.md).

## Pilot Evaluation Questions

An **Evaluation Question** is one stable, identified question whose answer could change guidance, implementation, or an experiment. It accumulates evidence without assuming the desired answer. Use the questions below as the initial `/skill:compound` set. IDs are append-only: retire a question without renumbering later IDs. This file's SHA-256 identifies the evaluated revision.

- **Q1 — Delegation value:** Did delegation provide a concrete benefit—fresh context, Independence, parallelism, mechanical volume, or specialist capability—compared with working inline?
- **Q2 — Worker threshold:** When at least two related assignments were expected, did Continuity reduce re-briefing or improve the outcome enough to justify a Worker?
- **Q3 — Background posture:** Did background execution enable useful parallel work, watching, or steering preparation, or did it add polling and reconciliation noise?
- **Q4 — Cache behavior:** Did monitoring turns preserve useful prompt-cache state, and were those turns valuable independent of cache renewal?
- **Q5 — Result reconciliation:** Did the lead reconcile every child result before relying on it and disclose failed Independence honestly?
- **Q6 — Communication need:** Which observed problem would lead↔child or peer messaging have prevented, and could a simpler status/result mechanism have solved it?
- **Q7 — Coordination quality:** When parallel actors exchanged or lacked information, did that reduce duplicate work or create hidden scope changes?
- **Q8 — Shared-file risk:** Did parallel mutation touch overlapping files, lose work, or require reconciliation given the absence of cross-process write protection?
- **Q9 — Human visibility:** Did the user receive material timing, failure, uncertainty, and confidence changes without routine execution telemetry?
- **Q10 — Prompt usefulness:** Which persistent instruction measurably changed behavior, and which instruction was ignored, redundant, or misleading?
- **Q11 — Stateless Model Call value:** Did a session-free semantic summary or classification save lead context and Human Attention without hiding material evidence or displacing a deterministic check?

For each question, `/skill:compound` records `supports`, `contradicts`, or `inconclusive`. These labels classify one session's evidence. They are not scores: a session can support one hypothesis, contradict another, and leave most questions inconclusive.

## Human Loop

### 1. Choose one behavior to observe

Before meaningful Subagent or Worker use, select at most three Pilot Evaluation Questions. Do not change prompts and runtime simultaneously unless the test specifically concerns their interaction.

**Done when:** the session has a small question set and the current behavior is known.

### 2. Use the simplest supported mechanism

Prefer a fresh Subagent when its benefit is concrete. Create or reuse a Worker when at least two sequential assignments in one stable semantic scope are expected and Continuity is valuable. Use background execution for real parallel work or useful attended monitoring, not content-free cache pings. Keep assignments self-contained and reconcile every result.

Do not simulate unsupported peer messaging through hidden files or claim mid-dispatch steering exists. Record the need when it appears naturally.

**Done when:** the work reaches a meaningful outcome or failure with inspectable session and repository evidence.

### 3. Run `/skill:compound`

Invoke `/skill:compound` manually against the named lead session. It uses a fresh `independent-review` Subagent routed away from the target lead's author provider. Inspect child transcripts only when an active question requires them. Per-session evaluation reports remain under `~/.pi-workbench/compound/`; no global register or authoritative ledger is created.

The lead need not read every routine child or future coordination message. Inspect when the evaluation reports an unresolved conflict, unanswered question, material behavioral influence without evidence, unknown outcome, or contradiction between the result and Primary Evidence.

**Done when:** every selected question has evidence, an assessment, limits, cumulative effect, and one next observation.

### 4. Decide whether evidence compounds

After several comparable sessions—or immediately after a severe contradiction—review the accumulated evaluations. Prefer repeated behavioral evidence over model preference. A useful Learning Candidate names:

- the narrowest destination and scope;
- the sessions and Primary Evidence supporting it;
- where it applies and where it does not;
- how to validate it after promotion;
- what would invalidate it; and
- how it relates to current guidance and decisions.

**Done when:** the owner chooses observe again, reject, or authorize one narrow promotion.

### 5. Promote one layer at a time

Place a validated change at the narrowest owner:

- tool lifecycle or deterministic safety → extension/adapter and tests;
- recurring lead behavior → concise persistent instruction;
- context-sensitive technique → skill;
- supported semantics → owning contract;
- surprising durable trade-off → decision record.

Re-run the same Evaluation Questions after promotion. Revert or revise guidance that does not improve observed behavior.

**Done when:** the change has implementation evidence and a later session evaluation, or has been rejected without leaving stale standing guidance.

## Ordered Experiments

Run one experiment at a time. Each later experiment depends on evidence from the earlier one.

### Experiment 1 — background observation

Use existing `background:true`, `subagent_status`, and `subagent_collect` in real attended work. Measure useful parallel work, monitoring-turn value, cache behavior, missed completions, and reconciliation cost.

**Advance when:** repeated sessions show a clear problem that automatic terminal wakeup or richer status would solve.

### Experiment 1a — Stateless Model Call for bounded semantic summaries

Run this only when Experiment 1 produces a bounded observation batch whose semantic summary would
reduce lead context; otherwise leave Q11 inconclusive. Build a small Workbench-owned `completeOnce`
utility in a new `packages/pi-stateless-model-call/` package plus an out-of-process host entry point. The host owns and injects one `ModelRuntime`; the
utility calls `completeSimple()` so Pi maps Model Effort consistently. Do not construct another
runtime inside a Pi session. Defer direct `ctx.modelRegistry.complete()` use until Pi exposes
`completeSimple()` on that facade or a separately tested Workbench mapper fails closed for every
admitted API.

Resolve the `mechanics` Cognitive Role through
`skills/model-orchestration/scripts/resolve-runtime-binding.mjs` immediately before every model call;
do not reuse a binding across calls. Accept only a passing binding and quota admission, reject fresh
exhaustion and returned provider/model mismatch, and carry Model Effort from the requested binding
because the response does not echo it. Reject tools and deferred responses, set retries to zero,
bound messages and output, own an abort deadline, and normalize terminal errors.

Return content plus a bounded receipt containing input-evidence references, resolved and returned
binding metadata, quota admission, outcome, and usage. The first attended caller must expose this
receipt in its tool-result `details` so `/skill:compound` can evaluate Q11 from the lead session
without persisting a separate model-call ledger.

Use the utility only after the Level 1 deterministic observation/status path has gathered evidence
and a small semantic summary or classification could reduce lead context—for example, summarizing a
bounded batch of child progress observations. Lifecycle state, wake conditions, message counts,
unresolved-result detection, and other mechanically decidable facts remain deterministic. The
model-call content is optional presentation evidence and may be discarded or regenerated; its
receipt remains in the attended tool result.

**Advance when:** tests prove one provider dispatch with retries disabled, per-call binding and quota
resolution, exact response binding, timeout/cancellation, tools/deferred rejection, usage and receipt
capture, no AgentSession or session file, no in-session duplicate runtime, and no state mutation;
attended evaluations then show that the summary saves Human Attention without hiding material
evidence.

### Experiment 2 — deterministic wakeup and retained result

After an explicit decision defines whether a terminal `triggerTurn` remains inside the attended Level 1 posture, adapt only terminal-result retention and idle/busy wakeup patterns demonstrated by `edxeth/pi-subagents`; preserve Workbench typed outcomes and attended shutdown. Current decisions do not settle this terminal-wakeup question. Do not add peer messaging.

**Advance when:** sessions show that completion wakeup works reliably and that leads benefit from mid-task interaction rather than merely more notifications.

### Experiment 3 — lead↔child information and steering

Only after an explicit revision to Decision 80, pilot typed envelopes with free text for `information`, `question`, `reply`, `guidance`, `conflict`, `progress`, and `completion`. Route messages through the attending lead and preserve a bounded session-local log. A material objective change still starts a new assignment.

**Advance when:** evidence shows lead mediation is the bottleneck for parallel collaboration.

### Experiment 4 — bounded peer collaboration

Only after an explicit revision to Decision 50, pilot direct messaging among active executions launched by one attended lead and named as one collaboration group. Start with information and help requests. Treat peer steering as launch-time guidance, not a new authority system. Messages to an idle Worker route to the lead; no durable Worker mailbox.

**Stop when:** messaging produces loops, hidden scope changes, unresolved conflicts, excessive context, or weaker result attribution without a compensating outcome improvement.

## Initial Promotion Bar

Do not change persistent Subagent/Worker guidance from one attractive session. Promote when either:

- at least three comparable meaningful sessions support the same narrow change with no material contradiction; or
- one high-impact failure exposes a reproducible correctness problem and the proposed change passes a direct validation case.

This is a pilot threshold, not a universal statistical claim. `/skill:compound` must preserve contrary and inconclusive evidence rather than averaging it away.
