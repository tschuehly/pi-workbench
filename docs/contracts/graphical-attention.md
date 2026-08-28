# Graphical Attention Contract

Status: V1 interaction contract.

The iterative Workbench client first makes one complete attended Pi Chat usable in one macOS window. Later Workstream slices restore canonical cross-session context: what the owner was doing, what changed, what needs attention, and where to resume. This contract defines how the client presents both Chat and Workstream state.

The [Attention and Interface Specification](interfaces.md) remains authoritative for typed actions and client ownership.

## Scope

V1 does not launch FirstMate, use another model to synthesize portfolio priorities, or mix future managed Run attention into Workstream views.

Chat consumes PI WEB runtime session state. A Workstream surface consumes canonical Workstream snapshots, revisions, and ordered watch results. The Workstream Store remains authoritative. The client does not infer Workstream state from Chat, terminal output, tool activity, or visual state.

The Workbench client owns presentation and uses PI WEB transport where appropriate. Neither the client nor PI WEB owns Workstream semantics or persistence.

## First Slice: One Chat per Window

A blank native window provides a small, explicit workspace and session chooser. After selection, one Chat owns the window. The window retains the transcript, draft, scroll position, live activity, status, asks, and dialogs for that complete session identity.

The first delivery checkpoint provides a proper graphical composer. The second adds a toggleable right-hand viewer and editor for that Chat's workspace while Chat remains visible.

File saves reject stale loaded content rather than silently overwriting newer agent or external changes. Separate windows do not share Chat, file, or presentation state. Closing or replacing a window leaves the PI WEB session daemon and unrelated sessions running.

### First-slice acceptance

The controlled session fixture and attended real passes must prove:

- one-window/one-Chat isolation;
- explicit location;
- complete graphical conversation controls;
- workspace-scoped file viewing and editing;
- stale-save rejection;
- reconnect behavior; and
- runtime survival.

## Later Workstream Re-entry Surface

When delivered, the Workstream view presents current and closed Workstreams across repositories. Each Workstream shows:

- associated sessions and their pending, confirmed, or failed launch state;
- each session's latest confirmed checkpoint and any visible checkpoint failure or staleness;
- unresolved Human Tasks;
- relevant links;
- revision and closure state; and
- actions to start or resume an attended session, checkpoint, and close.

Several Workstreams and human-initiated sessions may remain active. The canonical projection—not a broker model or raw transcript—supports the owner's decision about what to resume.

### Checkpoints

Pi writes checkpoints automatically at meaningful attention changes. Each checkpoint states what changed, what remains, the next useful continuation, and a concise paste-ready prompt for a fresh session. The owner can later correct or replace any field; a later checkpoint supersedes an earlier one.

The interface presents the next-session prompt separately from the owner-facing next action. The owner can copy the prompt without reconstructing context from Chat.

A failed write preserves the previous checkpoint and makes the missing, failed, or stale state visible. If a checkpoint was accepted before next-session prompts existed, the interface identifies the prompt as unavailable instead of constructing one from `next`.

### Re-entry and place preservation

The client restores the selected Workstream view across compatible reload and reconnect scenarios. On return, it presents the latest canonical projection and identifies reconnect or reconciliation state without hiding the last known Workstream state.

The view derives changes from Workstream revisions and records. It does not summarize raw Chat or terminal output as current state.

### Workstream-slice acceptance

The shared recorded Workstream fixture must prove:

1. The owner can identify where to resume and copy the confirmed next-session prompt without reading raw logs or Chat history.
2. Current, closed, empty, loading, failure, reconnect, and checkpoint-failure states are distinct.
3. Re-entry restores the Workstreams destination and reconciles from canonical revisions.
4. A failed or abandoned checkpoint cannot appear current or replace confirmed continuation state.
5. Every Workstream mutation produces a typed, revision-checked receipt or semantic error.
6. Controls required by the delivered Workstream slice remain reachable at its declared macOS window sizes.

## Mutation Contract

Every Workstream mutation submits a typed, revision-checked, idempotent request. The client renders the resulting receipt or semantic failure.

## Presentation Rules

- Lead with the next available attended action and current continuation state.
- Distinguish unresolved Human Tasks from passive links and session status.
- Describe failures by cause, impact, and available recovery action without alarmist language.
- Keep current Workstreams visually distinct from closed context.
- Preserve access to authentication, connectivity, recovery, and every control required by the delivered slice.
- Support keyboard use and the slice's declared macOS window sizes without hiding protected controls.
- Treat mobile and coarse-pointer support as separate future product slices, not implicit release gates.
