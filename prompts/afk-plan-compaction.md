---
description: Execute a multi-phase plan autonomously in one session, minimizing interruptions and using model-triggered compaction to survive long runs
argument-hint: "<plan-path> [scope or constraints]"
---
Execute one multi-phase plan autonomously within a single session, minimizing human interruptions.

Invocation arguments: `$ARGUMENTS`

This runs "AFK-style": you drive the plan to completion without pausing for routine check-ins. It is not managed unattended execution. There is no Run Controller, managed authority, workspace isolation, attempt bounds, or durable recovery. Human Attention may be absent, but you remain inside one ordinary attended session and must not imply otherwise.

Before implementation:

1. From the invocation arguments, identify the first existing Markdown file intended as the plan; strip an optional leading `@` and ignore leading verbs such as `Execute`. Treat the remaining text as scope or constraints. If no unambiguous existing plan is present, stop and ask for its path. (This is a legitimate blocker, not a routine check-in.)
2. Read the plan and the repository authority it references.
3. Confirm that the requested work is still applicable to current repository state.
4. Organize execution into coherent phases without inventing new authority. Work only within the authority the plan and repository already grant.

During execution:

- Proceed through all phases without stopping for confirmation. Complete, save, and verify each phase before starting the next.
- Make decisions within the plan's stated scope and constraints on your own. Do not pause to ask the human to choose between options the plan already implies.
- Stop and surface a blocker only when continuing would exceed the plan's authority, risk irreversible or destructive change, require credentials or approvals you lack, or hit an ambiguity the plan does not resolve. Prefer the reversible, lower-risk option and keep going.
- Commit each coherent unit of completed work so progress survives independently of any summary.
- Use `compact_and_continue` whenever accumulated Model Context would otherwise force a stop, and at any boundary where substantial completed context can be replaced by a concise checkpoint. Multiple compactions across a long run are expected.
- Call `compact_and_continue` alone as the final action at the chosen boundary, immediately after verification and a commit, and before producing more large tool output.
- Keep `summaryFocus` at 1,200 characters or fewer. It is a short directive to Pi's summarizer, not the summary itself. Name what must be emphasized and reference existing plan, commit, or evidence paths instead of copying their contents or restating session history.
- Keep `nextPhase` at 800 characters or fewer and name one concrete phase from the plan.
- Do not create a progress file solely for compaction. Never call generated notes or summaries authoritative state, durable checkpoints, Continuation Artifacts, or handoffs.

After each continuation:

1. Re-verify repository state and directly inspect relevant evidence and commits before relying on the compacted summary.
2. Resume the named phase and continue driving the plan to completion.

Final report:

1. State whether the plan completed, and if not, the exact blocker that stopped autonomous execution and what human decision it needs.
2. List the commits produced and the phases they cover.
3. State how many times compaction ran, at which boundaries, pre/post token usage when available, whether each resume was correct, and any lost context, repetition, retries, failure, or recovery work observed.

Treat compaction as lossy same-session Model Context management. It is not a confirmed Workstream checkpoint, Continuation Artifact, durable handoff, authority grant, or permission for managed unattended execution.
