---
description: Execute a multi-phase plan one phase at a time, stopping for human judgment and trialing one approved-boundary compaction
argument-hint: "<plan-path> [scope or constraints]"
---
Execute one multi-phase plan under continuous Human Attention, one human-approved phase at a time.

Invocation arguments: `$ARGUMENTS`

Before implementation:

1. From the invocation arguments, identify the first existing Markdown file intended as the plan; strip an optional leading `@` and ignore leading verbs such as `Execute`. Treat the remaining text as scope or constraints. If no unambiguous existing plan is present, stop and ask for its path.
2. Read the plan and the repository authority it references.
3. Confirm that the requested work is still applicable to current repository state.
4. Organize execution into coherent phases without inventing new authority.
5. Identify exactly one next phase. The initial invocation authorizes the first phase. Every later phase requires explicit human approval after judging the preceding phase. A system notification, tool result, task completion event, silence, or earlier AFK instruction is not approval.

During each phase:

- Execute only the approved phase. Do not begin the next phase in the same turn.
- Make routine decisions inside that phase without interrupting the human.
- Complete, save, verify, and commit the coherent phase output before requesting judgment.
- Stop early if continuing would exceed authority, risk irreversible or destructive change, require unavailable credentials or approval, or hit unresolved ambiguity.
- Do not reinterpret a failed gate, exhausted attempt ladder, partial artifact, or stale workflow state as completion.
- Do not call `compact_and_continue` before the human has judged the phase output; automatic continuation would bypass the human gate.

After each phase, return a concise human judgment packet:

1. Phase goal and outcome: pass, fail, or blocked.
2. Commit SHA and changed-file summary.
3. Exact artifact or interface to inspect, with paths or commands.
4. Verification evidence and known limitations.
5. Deviations, unresolved risks, and discarded alternatives.
6. One explicit request: approve, request corrections, revise the plan, or stop.
7. The next phase that approval would unlock, without starting it.

Then stop and wait for a genuine human response.

Compaction trial after approval:

- Trial `compact_and_continue` at most once across the plan, only after the human explicitly approves a completed phase and the next phase.
- Use the most useful approved boundary where substantial completed context can be replaced by a concise checkpoint.
- Do not force the trial if there is no safe boundary or too little history to compact; report that instead.
- Call `compact_and_continue` alone as the final action at that approved boundary, before producing more large tool output.
- Keep `summaryFocus` at 1,200 characters or fewer. It is a directive to Pi's summarizer, not the summary itself. Name what must be emphasized and reference the plan, approved commit, and evidence paths rather than restating history.
- Keep `nextPhase` at 800 characters or fewer and name only the explicitly approved next phase.
- Do not create a progress file solely for compaction. Never call generated notes or summaries authoritative state, durable checkpoints, Continuation Artifacts, or handoffs.

After continuation:

1. Re-verify repository state, the approved commit, and relevant evidence before relying on the compacted summary.
2. Execute only the named approved phase.
3. End that phase with another human judgment packet and stop.

Final report:

1. State whether the plan completed and identify any blocker.
2. List phase commits and explicit human approvals.
3. State whether compaction was attempted, its approved boundary, pre/post token usage when available, whether the named phase resumed correctly, and any validation retry, lost context, repetition, failure, summarization cost, or recovery work observed.

Treat compaction as lossy same-session Model Context management. It is not a confirmed Workstream checkpoint, Continuation Artifact, durable handoff, authority grant, or permission for unattended execution.
