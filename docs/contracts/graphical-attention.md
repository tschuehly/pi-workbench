# Graphical Attention Contract

Status: V1 interaction contract.

This document defines how PI WEB presents canonical V1 Workstream state. The
[Attention and Interface Specification](interfaces.md) remains authoritative for typed PI WEB
actions and shell ownership.

## Outcome

PI WEB answers **what was I doing?**, **what changed?**, **what needs me?**, and **where can I
resume?** from the Workstream projection. It reduces the effort required to start, leave, resume,
and close attended human–Pi pair-programming sessions.

V1 does not launch FirstMate, synthesize portfolio priorities with another model, or mix future
managed Run attention into the Workstream view.

## Authority and state boundary

The surface consumes canonical Workstream snapshots, revisions, and ordered watch results. The
Workstream Store remains authoritative. PI WEB does not infer current state from chat, terminal
output, tool activity, or visual state.

Every Workstream mutation submits a typed, revision-checked, idempotent request and renders its
receipt or semantic failure. PI WEB owns transport and presentation, not Workstream semantics or
persistence.

## Workstream re-entry surface

The view presents current and closed Workstreams across repositories. Each Workstream exposes:

- associated sessions and pending, confirmed, or failed launch state;
- each session's latest confirmed checkpoint and visible checkpoint failure or staleness;
- unresolved human tasks;
- relevant links;
- revision and closure state;
- actions to start or resume an attended session, checkpoint, and close.

Several Workstreams and human-initiated sessions may remain active. The projection, rather than a
broker model or raw transcript, supports the owner's choice of what to resume.

## Attended checkpoint surface

Checkpointing begins with an explicit owner action in the active session. Pi proposes what changed,
what remains, and the next useful continuation. The interface lets the owner review and correct the
proposal before confirmation.

Only confirmed content becomes the latest checkpoint. Failure, rejection, or abandonment preserves
the previous confirmed checkpoint and makes the missing, failed, or stale state visible.

## Re-entry and place preservation

PI WEB restores the selected Workstreams view across compatible reload and reconnect scenarios. On
return it presents the latest canonical projection and identifies reconnect or reconciliation state
without hiding the last known Workstream state.

The view derives changes from Workstream revisions and records. It does not summarize raw chat or
terminal output as current state.

## Presentation rules

- Lead with the next available attended action and current continuation state.
- Distinguish unresolved human tasks from passive links and session status.
- State failures as cause, impact, and available recovery action without alarmist language.
- Keep current Workstreams visually distinct from closed context.
- Preserve visible access to PI WEB-owned authentication, connectivity, settings, recovery,
  workspace, conversation, and navigation controls.
- Support keyboard, narrow, mobile, and coarse-pointer interaction without hiding protected controls.

## Acceptance fixture

PI WEB satisfies this contract when the shared recorded Workstream fixture proves:

1. The owner can identify where to resume without reading raw logs or chat history.
2. Current, closed, empty, loading, failure, reconnect, and checkpoint-failure states are distinct.
3. Re-entry restores the Workstreams destination and reconciles from canonical revisions.
4. A failed or abandoned checkpoint cannot appear current or replace confirmed continuation state.
5. Every Workstream mutation produces a typed, revision-checked receipt or semantic error.
6. Protected shell controls remain reachable at desktop, narrow, and mobile widths.
