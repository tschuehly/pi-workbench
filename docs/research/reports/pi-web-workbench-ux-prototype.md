# PI WEB Workbench UX prototype

Status: selected desktop prototype direction and design evidence. This report is not a supported
behavioral contract. The Workstream and graphical-attention contracts remain authoritative.

## Artifact

Open [`pi-web-workbench-ux-prototype.html`](pi-web-workbench-ux-prototype.html) directly in a
browser. It is a standalone, throwaway interaction prototype preserved for production planning.
It changes no production code or protocol.

## Selected interaction model

The selected direction is a hierarchy-first Workbench:

- **Return to work** is the cross-Workstream re-entry surface. It answers what changed, what needs
  Human Attention, and where useful work can resume before exposing conversations.
- The **Pi menu** is the single global navigation and utility entry point. It contains Return to
  work, Workstreams, Projects, Actions, authentication, recovery, settings, and connection state.
- Entering a Workstream restores its last selected interactive session. Session navigation can be
  expanded as a vertical hierarchy or collapsed into horizontal tabs. Both forms expose the same
  sessions, and both provide an explicit new-session action.
- The selected session owns Chat, Files, Git, and Terminal. These remain scoped to its explicit
  machine, project, and workspace anchor.
- The **Workstream brief** opens as a top drawer over active session work. It presents the confirmed
  continuation, unresolved Human Tasks, and each session's latest confirmed update without making
  the user navigate away from the conversation.
- Human Tasks are answerable requests rather than generic checkboxes. The prototype demonstrates
  Yes, No, Change, finite-choice, and free-text responses with source-session provenance.

## Lessons

1. **Structure must be resolved before visual style.** Early visual-world mockups did not answer the
   actual problem: how Workstreams, sessions, conversations, tools, and Human Attention relate.
2. **Returning and working are different situations.** New-day re-entry needs a cross-Workstream
   continuation view. Active work needs a stable session and checkout, not the portfolio hierarchy.
3. **One hierarchy is enough.** Duplicating global PI WEB navigation inside a dedicated Workstream
   shell creates competing navigation systems. Workstreams belong in the Pi menu; sessions belong
   inside the selected Workstream.
4. **Session density should be reversible.** Vertical session navigation preserves summaries,
   anchors, and delegation detail. Horizontal tabs recover workspace width without changing the
   underlying selection model.
5. **The conversation remains central.** Files, Git, Terminal, tasks, and the brief surround the
   selected conversation through progressive disclosure instead of permanently dividing the main
   working surface.
6. **A brief is not a transcript summary.** Current V1 state comes from confirmed session
   checkpoints, Human Tasks, links, and revisions. Presentation must not infer authority or current
   state from raw messages.
7. **Subagent work is subordinate activity.** A bounded child Pi appears as a delegation beneath
   its parent interactive session. Active delegation counts may appear on session tabs; progress,
   cancellation, results, failures, and the child Pi session identifier remain inspectable. Child
   Pi sessions do not become peer Workstream sessions or resumable conversation tabs.
8. **Hidden sessions are the wrong abstraction.** Model work that contributes to durable state must
   be visible, bounded, attributable, and reviewable.

## Design principles

- Restore Human Attention before exposing activity.
- Keep Return to work, Workstream, and session scopes visibly distinct.
- Preserve one global navigation entry point and one contextual session hierarchy.
- Keep the selected checkout anchor visible on every session-owned surface.
- Prefer drawers, collapsible hierarchies, and scoped trays over permanent competing panes.
- Show required human answers with their question type, source session, and consequence.
- Nest bounded delegations under the accountable lead session.
- Treat model output as a proposal until an owner-confirmed typed mutation is accepted.
- Preserve authentication, recovery, settings, connection, and action controls without keeping all
  of them permanently visible.

## Brief Curator proposal

The prototype explores **Prepare updated brief** as a future explicit operation similar to a
focused handoff. A fresh, visible Brief Curator would read the canonical Workstream projection and
current session transcripts at recorded message cutoffs, then produce an editable proposal for
what changed, what remains, and the next useful continuation. The owner could discard, correct, or
confirm it. New transcript activity after the captured cutoffs would make the proposal stale.

This behavior is outside the current V1 contract. V1 forbids fresh-context checkpoint generation
and does not persist a second combined narrative. Production planning must therefore either reject
this proposal or define a typed curator operation, transcript references, freshness checks,
proposal lifecycle, and owner-confirmed persistence. It must not be implemented as an invisible
interactive session or by having PI WEB infer state from transcripts.

## Protocol implications to resolve before production

- Whether Human Tasks gain typed answer specifications and durable answer outcomes.
- Whether a confirmed Workstream-level brief is introduced in addition to per-session checkpoints.
- How Brief Curator inputs identify transcript ranges and canonical revisions.
- How stale proposals fail without replacing the last confirmed continuation.
- Where curator execution observations and its inspectable Pi session identifier are retained.
- Mobile and narrow-window navigation; this prototype intentionally resolves desktop first.
