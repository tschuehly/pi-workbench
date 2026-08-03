# Pi Workbench V1 requirements and validation

This document preserves the product outcomes and system-level validation matrix for V1. The
[system overview](system-overview.md) explains the architecture, the
[Operating Levels specification](operating-levels.md) defines the broader concepts, and the
[Workstream contract](../contracts/workstreams.md) defines supported behavior.

## User outcomes

1. As a developer, I want every interactive Pi session to start in an explicitly selected
   Workstream, so that the session has one durable home for attention continuity.
2. As a PI WEB user, I want every V1 Workstream operation available in the shell, so that I do not
   need a terminal client.
3. As a developer, I want to pair directly with one Pi while I am attending the session, so that
   semantic work remains observable and steerable.
4. As an interruptible developer, I want current and closed Workstreams to survive browser and PI
   WEB process restarts, so that I can resume related work across days.
5. As a developer, I want session launch to be idempotent and reconnect-safe, so that failure cannot
   orphan a session or associate it with multiple Workstreams.
6. As a developer, I want each session checkpointed independently through an explicit attended
   action, so that several sessions do not create one duplicated or stale combined summary.
7. As a developer, I want to review and correct Pi's proposed checkpoint before saving it, so that
   the continuation state reflects shared understanding.
8. As a developer, I want a failed or abandoned checkpoint to preserve the latest confirmed
   checkpoint, so that stale context is not presented as current.
9. As a developer with several active topics, I want Workstream projections to show sessions,
   unresolved human tasks, links, and closure state, so that I can choose what to resume without a
   broker model turn.
10. As a repository owner, I want Workstream persistence to exclude raw transcripts, routine
    activity, and linked file contents, so that continuity does not become unlimited standing
    context.
11. As a developer, I want closure to preserve unresolved items and require explicit file cleanup,
    so that finishing an attention container cannot silently delete work.
12. As a PI WEB user, I want loading, empty, failure, reconnect, narrow, and mobile states to retain
    access to shell-owned authentication, settings, recovery, workspace, and conversation controls.

## Validation matrix

- Exercise `create`, `append`, `inspect`, `list`, `watch`, and `close` through the PI WEB adapter;
  assert Workstream Store semantics independently from presentation.
- Rebuild Workstream current state from its ledger; assert sessions, latest confirmed checkpoints,
  unresolved human tasks, links, revision, and closure state without a persisted combined narrative.
- Replay exact mutations and assert the original receipt; reuse an idempotency key with changed input
  and assert deterministic rejection.
- Submit stale revisions, invalid records, oversized mutations, and illegal session transitions;
  assert deterministic rejection without prompt interpretation.
- Reconnect observation after retained and expired sequences; assert ordered replay or canonical
  snapshot reconciliation without duplicate current state.
- Start several human-initiated sessions in one Workstream and Workstreams across repositories;
  assert one home Workstream per session and no cross-assignment.
- Interrupt session launch before and after PI WEB returns a session identifier; assert pending
  association reconciliation, no duplicate launch, and visible failure without an orphaned session.
- Ask the active attended Pi session to propose a checkpoint, edit it, and confirm it; assert only the
  confirmed content replaces the prior checkpoint.
- Fail, reject, or abandon a checkpoint proposal; assert the prior confirmed checkpoint remains and
  failure or staleness is visible.
- Restart the browser and PI WEB web process; assert Workstreams and confirmed continuation state
  remain available from user-local storage.
- Resume a real session from the Workstream projection; assert the user does not need to reconstruct
  the current plan from raw chat history or scratch directories.
- Append routine activity, verbose output, raw transcript content, linked file content, and an
  oversized checkpoint; assert rejection or reference-based storage rather than ledger growth.
- Close a Workstream with unresolved tasks and linked scratch files; assert preserved unresolved
  state and no deletion without human confirmation.
- Verify that V1 launches no child actor, background checkpoint context, portfolio broker, or
  unattended semantic work.
- Exercise loading, empty, failure, reconnect, desktop, narrow, and mobile Workstream views; assert
  that PI WEB-owned protected controls remain visible and operable.
