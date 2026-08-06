---
description: Execute a multi-phase plan while trialing one model-triggered context compaction
argument-hint: "<plan-path> [scope or constraints]"
---
Execute one multi-phase plan under continuous Human Attention.

Invocation arguments: `$ARGUMENTS`

Before implementation:

1. From the invocation arguments, identify the first existing Markdown file intended as the plan; strip an optional leading `@` and ignore leading verbs such as `Execute`. Treat the remaining text as scope or constraints. If no unambiguous existing plan is present, stop and ask for its path.
2. Read the plan and the repository authority it references.
3. Confirm that the requested work is still applicable to current repository state.
4. Organize execution into coherent phases without inventing new authority or requiring separate plan approval.

During execution:

- Complete, save, and verify each phase before starting the next.
- Trial `compact_and_continue` at most once, at the most useful boundary where substantial completed context can be replaced by a concise checkpoint.
- Do not force the trial if there is no safe boundary or too little history to compact; report that instead.
- Call `compact_and_continue` alone as the final action at the chosen boundary, immediately after verification and before producing more large tool output.
- Keep `summaryFocus` at 1,200 characters or fewer. It is a short directive to Pi's summarizer, not the summary itself. Name what must be emphasized and reference existing plan or evidence paths instead of copying their contents or restating session history.
- Keep `nextPhase` at 800 characters or fewer and name one concrete phase from the plan.
- Do not create a progress file solely for compaction. Never call generated notes or summaries authoritative state, durable checkpoints, Continuation Artifacts, or handoffs.

After continuation:

1. Verify repository state and directly inspect relevant evidence before relying on the compacted summary.
2. Continue the named phase and finish the requested plan work.
3. In the final report, state whether compaction was attempted, its boundary, pre/post token usage when available, whether the named phase resumed correctly, and any validation retry, lost context, repetition, failure, summarization cost, or recovery work observed.

Treat compaction as lossy same-session Model Context management. It is not a confirmed Workstream checkpoint, Continuation Artifact, durable handoff, authority grant, or permission for unattended execution.
