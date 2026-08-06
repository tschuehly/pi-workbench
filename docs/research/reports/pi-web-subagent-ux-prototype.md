# Subagents inside a Workstream — prototype investigation

Status: exploratory UX evidence. This is not a supported behavioral or protocol contract.

## Question

How should PI WEB show one bounded child Pi execution, its self-contained input, attended progress,
cancellation, compact outcome, and inspectable Pi session identifier without presenting the child as
a peer Workstream session, resumable conversation, durable Worker, managed Run, or authoritative
Workstream state?

## Artifact

Open [`pi-web-subagent-ux-prototype.html`](pi-web-subagent-ux-prototype.html) directly in a browser.
The three variants are shareable as `?variant=A`, `?variant=B`, and `?variant=C`. Use the bottom
switcher or Left/Right arrow keys to compare them.

The artifact inherits the hierarchy-first shell and neutral presentation of
[`pi-web-workbench-ux-prototype.html`](pi-web-workbench-ux-prototype.html). It is standalone,
throwaway prototype code and changes no production UI or protocol.

## What the current prototype already gets right

The selected Workbench prototype nests delegations under their parent interactive session and adds
only an active count when session navigation collapses. That correctly communicates origin and
accountability. Children do not appear as Workstream session tabs.

The existing compact delegation rows are not sufficient as the only surface. At roughly 260 px,
they cannot legibly expose the self-contained task, profile, Cognitive Role, resolved runtime,
quota admission, observation stream, terminal category, result, diagnostics, and Pi session ID.
They are a useful index, not an inspection surface.

## Product truths encoded in every variation

- One invocation launches one fresh child Pi for one bounded assignment.
- The lead remains attended and accountable for cancellation, interpretation, and reconciliation.
- The child receives a self-contained task rather than a fork of the parent transcript.
- Detailed observations inform the UI but do not enter parent Model Context.
- Only the compact terminal result returns to the lead.
- Child Pi sessions remain inspectable evidence, not peer or resumable Workstream sessions.
- Cancellation remains **Cancelling** until process termination is confirmed.
- **Outcome unknown** remains distinct from failure or successful cancellation.
- Runtime binding and degraded quota telemetry are visible facts, not hidden routing behavior.

## Variations

### A — Conversation-native cards

Each `subagent` tool invocation appears chronologically inside Chat. Its collapsed row shows the
assignment, child profile and Cognitive Role, elapsed time, and state. Expansion reveals the exact
task sent to fresh context, resolved runtime, quota admission, observations, compact terminal
result, and copyable Pi session ID.

**Best at:** causality and lead accountability. The request, progress, result, and subsequent lead
synthesis remain in one reading flow.

**Risk:** active executions become hard to find in a long conversation; several expanded streams
can overwhelm Chat.

### B — Session execution tray

Chat retains one compact invocation/result marker. A session-scoped tray lists all bounded child
executions from the selected lead session and provides one roomy detail inspector. The tray is
explicitly labeled “This lead session only · not resumable sessions.”

**Best at:** monitoring concurrent children, cancellation, diagnostics, and comparing current
states without transcript scrolling.

**Risk:** the tray can resemble durable execution state. Production copy and lifecycle behavior
must make its attended, session-local nature explicit.

### C — Parent-and-child activity map

A dedicated session tool shows the interactive lead as the accountable root and each bounded
invocation as a terminal branch. Selection opens a detail inspector containing inputs,
observations, outcome, and session ID.

**Best at:** making parentage, boundedness, and parallel delegation immediately legible.

**Risk:** it is more navigation than ordinary single-child use warrants and can drift toward a
managed-Run graph metaphor. It should not become the default production surface for Level 1.

## Recommendation

Use a **hybrid of A and B**:

1. Keep the existing nested delegation rows as a compact origin/status index beneath the parent
   session.
2. Put a compact chronological marker at the `subagent` invocation point in Chat.
3. Open one session-scoped execution tray for detailed progress, cancellation, errors, inputs,
   result, runtime facts, and Pi session ID.
4. Return the compact terminal result to Chat so the lead’s reconciliation remains visible.
5. Do not ship C as the default; retain its parent-and-branch grammar only if later usability work
   proves that users regularly coordinate several concurrent children.

This provides progressive disclosure without duplicating authority:

```text
session count/status → nested child index → Chat marker → execution detail → lead synthesis
```

## Recommended detail order

The inspector should answer these questions in order:

1. **What is happening?** Assignment title, current lifecycle state, elapsed time.
2. **Why does this child exist?** Exact self-contained task.
3. **What kind of judgment was requested?** Child profile and Cognitive Role.
4. **What actually ran?** Resolved provider/model/effort and quota admission.
5. **What has been observed?** Bounded progress, tool activity, usage, and diagnostics.
6. **What came back?** Stable terminal category and compact final text.
7. **How can it be inspected?** Copyable Pi session ID, never a peer-session or resume action.

## Lifecycle presentation

| Runtime state | Primary action | Required wording |
| --- | --- | --- |
| Launching / running | Cancel child | Child remains attached to the attended lead |
| Cancelling | None | Confirming termination; cancellation is not yet proven |
| Success | Copy session ID | Compact result returned to lead for reconciliation |
| Preflight / launch / execution failure | Inspect details | Name the failed phase and recovery option |
| Cancelled | Copy session ID | Termination confirmed |
| Timed out | Inspect details | Timeout used the cancellation sequence |
| Outcome unknown | Inspect session and repository state | Never imply failure, cancellation, or safe retry |

## Questions for production planning

- Which PI WEB-owned tool-result seam can expose normalized live observations without the Workbench
  adapter inferring state from transcript rendering?
- How long is session-local execution detail retained after the attended parent tool finishes?
- Does PI WEB already have an inspect-only child-session affordance, or should V1 expose only a
  copyable identifier?
- What is the narrow-layout handoff between Chat and the execution tray?
- Which terminal failures remain highlighted on a collapsed parent-session tab until inspected?
