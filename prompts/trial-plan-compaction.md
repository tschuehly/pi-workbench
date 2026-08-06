---
description: Execute a multi-phase plan while trialing one model-triggered context compaction
argument-hint: "<plan-path> [scope or constraints]"
---
Execute the plan at `$1` under continuous Human Attention.

Additional scope or constraints: ${@:2}

Before implementation:

1. Read the plan and the repository authority it references.
2. Confirm that the requested work is still applicable to the current repository state.
3. Organize execution into coherent phases without inventing a new authority or requiring separate plan approval.

During execution:

- Complete, save, and verify each phase before starting the next.
- Trial `compact_and_continue` at most once, at the most useful boundary where substantial completed context can be replaced by a concise checkpoint.
- Do not force the trial if the plan has no safe boundary or the session has too little history to compact; report that instead.
- Call `compact_and_continue` alone as the final action at the chosen boundary.
- Set `summaryFocus` to preserve the plan goal, completed changes, exact paths and identifiers, decisions, verification evidence, unresolved risks, and the starting state needed by the remaining phases.
- Set `nextPhase` to one concrete phase from the plan.

After continuation:

1. Verify repository state before relying on the compacted summary.
2. Continue the named phase and finish the requested plan work.
3. In the final report, state whether compaction was attempted, which boundary was chosen, whether the named phase resumed correctly, and any lost context, repetition, failure, or recovery work observed.

Treat compaction as lossy same-session Model Context management. It is not a confirmed Workstream checkpoint, Continuation Artifact, durable handoff, authority grant, or permission for unattended execution.
