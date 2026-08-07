# Pi Workbench Level 1 Plan

Status: implemented V1; acceptance evidence is maintained with the implementation.

## Outcome

Pi Workbench V1 implements **Level 1: Pair** from the
[Operating Levels specification](../foundation/operating-levels.md). It supports durable,
human-attended pair programming with one interactive Pi through PI WEB.

A user can organize work into Workstreams, pair with Pi in an explicitly selected Workstream,
leave, and later resume without reconstructing the state from conversation history. V1 is the
supported product destination, not a temporary orchestration step.

## Completed foundation

- PI WEB hosts the supported Pi runtime.
- The Workstream Store implements typed persistence, revisions, idempotency, ordered observation,
  deterministic projections, and user-local file storage.
- PI WEB provides a first-class Workstreams view over the typed Workstream interface.
- Workstreams survive browser and PI WEB web-process replacement.

## V1 workflow

```text
create or select Workstream
→ start an attended Pi session
→ pair program
→ review and save a checkpoint
→ leave or restart PI WEB
→ resume from the Workstream
→ close the Workstream
```

Every interactive session belongs to exactly one Workstream. Session launch records a pending
association, asks PI WEB to start the session with that Workstream identity, and then confirms or
fails the association. Reconnect reconciles pending associations instead of creating another
session.

Several Workstreams and human-initiated sessions may remain open. Pi performs semantic work only in
the interactive session while the user is attending it.

## V1 capabilities

### Durable Workstreams

PI WEB presents current and closed Workstreams with associated sessions, each session's latest
confirmed checkpoint, unresolved human tasks, relevant links, revision, and closure state. The
Workstream Store remains authoritative; PI WEB transports typed operations and renders projections.

### Attended sessions

The user selects a Workstream before starting a session. One interactive lead Pi pairs directly with
the user. The lead may launch bounded ephemeral child Pi processes for investigation,
implementation, or review while the user remains engaged. Child work is visible and cancellable,
and the lead reconciles it into the attended session. Correcting an assignment requires cancelling
it and launching a new child. It creates no managed Run,
workspace-isolation, or recovery guarantee. V1 has no background semantic work or unattended
execution, and implementation does not wait for a separately agreed execution plan.

### Optional phase-boundary compaction trial

When attended work is organized into multiple implementation phases, the lead may trial
`compact_and_continue` after completing, saving, and verifying one phase. The tool compacts older
Model Context in the same Pi session and starts one concrete next phase automatically. Calling it is
model-decided rather than required after every phase, and it must be the lead's only tool call at
that boundary.

This trial changes only disposable Model Context. It does not create or replace a confirmed
Workstream checkpoint, produce a Continuation Artifact, grant unattended execution, or act as a
durable cross-session handoff. Compaction failure remains ordinary attended session material; the
lead reports it and continues only when the remaining context is sufficient.

### Confirmed checkpoints

Checkpointing is explicit and attended. The active Pi session proposes a concise checkpoint stating
what changed, what remains, and the next useful action. The user may correct it before saving it to
the Workstream ledger. A failed or abandoned checkpoint does not replace the latest confirmed
checkpoint.

### Resume and close

After browser or PI WEB restart, the user can inspect the latest confirmed state, reconnect to or
continue the relevant session, review unresolved human tasks, and close completed Workstreams.
Closing preserves the ledger and unresolved items. File cleanup always requires explicit human
action.

The focused [Level 1 child execution plan](level-1-subagents.md) defines the bounded implementation
of this attended delegation capability.

## Acceptance

V1 is complete when one real project demonstrates the complete workflow across browser and PI WEB
process restarts, including:

- successful session launch and one-home-Workstream association;
- one bounded child assignment whose progress and result remain visible and cancellable from the
  attended lead session;
- launch failure without an orphaned or duplicate session;
- reconnect reconciliation without duplicate association;
- attended checkpoint review and confirmation;
- preservation of the previous checkpoint after checkpoint failure or abandonment;
- resumption without reconstructing the plan from chat history;
- concurrent Workstreams without cross-assigned sessions;
- Workstream closure without automatic file deletion.

## Non-goals

V1 does not include automatic checkpointing, background semantic model work, FirstMate, an
agreed-before execution-plan gate, contract-driven multi-agent execution, durable child identity,
independent acceptance authority, unattended execution, or controller-managed Runs. Levels 2–4 are
concepts, not scheduled implementation. Any expansion beyond Level 1 requires a new decision and
implementation plan based on evidence from sustained V1 use.

## Implementation

- Workstream protocol and persistence: `packages/workstream-store/`
- PI WEB typed service, Workstreams surface, and attended launch coordinator: `packages/pi-web-integration/`
- PI WEB host contribution APIs: sibling `../pi-web` fork branch `pi-workbench`
- Attended child process mechanics: `packages/pi-execution-adapter/`
- Level 1 child tool: `extensions/subagent/`
- Live workflow evidence: `packages/pi-web-integration/level-1-acceptance-evidence.md`
- Real child launch/cancellation evidence: `packages/pi-execution-adapter/real-smoke-evidence.md`

## Evidence

Evaluate V1 by whether it reduces the Human Attention needed to leave and resume real work. Record
where users still reconstruct context manually, whether checkpoints remain concise and accurate,
launch and reconnect failures, conflicting associations, unnecessary Workstream interactions, and
whether human tasks and links aid resumption. During the optional phase-boundary compaction trial,
record whether the lead chooses useful boundaries, preserves enough verified context, begins the
named next phase successfully, or causes premature compaction, repetition, or recovery work. Do not
add orchestration machinery without observed V1 evidence that justifies it.
