# Graphical Attention Contract

Status: V1 interaction contract.

This document defines how the iterative Workbench client presents attended Chat and canonical
Workstream state. The [Attention and Interface Specification](interfaces.md) remains authoritative
for typed actions and client ownership.

## Outcome

The first slice makes one complete attended Pi Chat usable in one macOS window. Later Workstream
slices answer **what was I doing?**, **what changed?**, **what needs me?**, and **where can I
resume?** from canonical projections rather than transcript inference.

V1 does not launch FirstMate, synthesize portfolio priorities with another model, or mix future
managed Run attention into Workstream views.

## Authority and state boundary

Chat consumes PI WEB runtime session state. A Workstream surface consumes canonical Workstream
snapshots, revisions, and ordered watch results. The Workstream Store remains authoritative; the
client does not infer Workstream state from Chat, terminal output, tool activity, or visual state.

Every Workstream mutation submits a typed, revision-checked, idempotent request and renders its
receipt or semantic failure. The Workbench client owns presentation and uses PI WEB transport where
appropriate; neither owns Workstream semantics or persistence.

## Chat window

A blank native window offers a small explicit workspace/session chooser. Once selected, one Chat
fills the window and retains transcript, draft, scroll, live activity, status, asks, and dialogs for
that complete session identity. Separate windows do not share selection or presentation state.
Closing or replacing a window leaves the PI WEB session daemon and unrelated sessions running.

## Later Workstream re-entry surface

When delivered, the view presents current and closed Workstreams across repositories. Each Workstream exposes:

- associated sessions and pending, confirmed, or failed launch state;
- each session's latest confirmed checkpoint and visible checkpoint failure or staleness;
- unresolved human tasks;
- relevant links;
- revision and closure state;
- actions to start or resume an attended session, checkpoint, and close.

Several Workstreams and human-initiated sessions may remain active. The projection, rather than a
broker model or raw transcript, supports the owner's choice of what to resume.

## Checkpoint surface

Pi writes checkpoints automatically at meaningful attention changes, stating what changed, what
remains, the next useful continuation, and a concise paste-ready prompt for a fresh session. The
interface lets the owner correct or replace any field afterwards; a later checkpoint supersedes an
earlier one.

The interface presents the next-session prompt distinctly from the owner-facing next action and lets
the owner copy it without reconstructing context from Chat. A failed write preserves the previous
checkpoint and makes the missing, failed, or stale state visible. For a checkpoint accepted before
next-session prompts existed, the interface identifies the prompt as unavailable instead of
constructing one from `next`.

## Re-entry and place preservation

When the Workstream slice is delivered, the client restores its selected Workstream view across
compatible reload and reconnect scenarios. On return it presents the latest canonical projection
and identifies reconnect or reconciliation state without hiding the last known Workstream state.

The view derives changes from Workstream revisions and records. It does not summarize raw chat or
terminal output as current state.

## Presentation rules

- Lead with the next available attended action and current continuation state.
- Distinguish unresolved human tasks from passive links and session status.
- State failures as cause, impact, and available recovery action without alarmist language.
- Keep current Workstreams visually distinct from closed context.
- Preserve access to authentication, connectivity, recovery, and every control required by the delivered slice.
- Support keyboard and the slice's declared macOS window sizes without hiding protected controls.
- Treat mobile and coarse-pointer support as separate future product slices rather than implicit release gates.

## Acceptance fixtures

The first slice satisfies this contract when the controlled session fixture and an attended real
pass prove one-window/one-Chat isolation, explicit location, complete conversation controls,
reconnect, and runtime survival.

A later Workstream slice satisfies this contract when the shared recorded Workstream fixture proves:

1. The owner can identify where to resume and copy the confirmed next-session prompt without reading raw logs or chat history.
2. Current, closed, empty, loading, failure, reconnect, and checkpoint-failure states are distinct.
3. Re-entry restores the Workstreams destination and reconciles from canonical revisions.
4. A failed or abandoned checkpoint cannot appear current or replace confirmed continuation state.
5. Every Workstream mutation produces a typed, revision-checked receipt or semantic error.
6. Controls required by the delivered Workstream slice remain reachable at its declared macOS window sizes.
