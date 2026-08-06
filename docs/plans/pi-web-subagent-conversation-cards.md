# PI WEB subagent conversation-card implementation plan

Status: selected UX direction; implementation not started.

## Outcome

Implement **Prototype A — Conversation-native cards** for the Level 1 `subagent` tool. Each bounded
child execution remains at its chronological invocation point in the accountable lead Chat. The
card is collapsed by default, expands in place for input, progress, runtime facts, cancellation, and
outcome, and can open the persisted child transcript in a read-only inspector without creating a
peer Workstream session or resumable conversation tab.

Baselines:

- [Selected prototype](../research/reports/pi-web-subagent-ux-prototype.html?variant=A)
- [Prototype investigation and selection](../research/reports/pi-web-subagent-ux-prototype.md)
- [Level 1 child execution plan](level-1-subagents.md)
- [Workbench UI plan](pi-web-workbench-ui.md)

This plan replaces the Workbench UI plan's blanket deferral of nested child presentation. It does
not change the Level 1 execution posture: the owner attends the lead session, one invocation is one
bounded child execution, and the lead remains accountable for reconciling the result.

## Product and protocol constraints

The implementation must preserve these distinctions:

- A **Subagent** is a fresh Pi actor for one bounded action, not a Worker, peer interactive session,
  managed Run, or durable Logical Actor.
- The parent tool call is the relationship record. The Workstream Store does not acquire child
  execution records and PI WEB does not infer canonical Workstream state from the card.
- The exact self-contained task, bundled profile, Cognitive Role, resolved provider/model/effort,
  quota admission, bounded observations, terminal category, compact result, and Pi session ID are
  presentation inputs.
- Raw thinking never enters the details envelope or UI.
- The child transcript is inspection evidence. It has no composer, resume, fork, checkpoint,
  Workstream-association, or session-tab action.
- **Cancelling** is not **Cancelled**. Cancellation remains pending until termination is confirmed;
  `outcome_unknown` remains distinct from failure and successful cancellation.
- A malformed or unknown details version falls back to the ordinary generic tool card. It must not
  break the transcript or produce guessed state.

No Workstream schema or ledger change is required.

## Current implementation fit

| Needed behavior | Current implementation | Plan |
| --- | --- | --- |
| Chronological tool card | `ChatView` coalesces calls, updates, and results into `ToolExecutionPart` | Reuse |
| Standalone visibility | `groupChatMessages` currently folds every ordinary tool execution into an event group | Treat validated subagent executions as readable standalone parts |
| Tool input | `ToolExecutionPart.args` carries `task`, `profile`, and `cognitiveRole` | Validate and project |
| Live progress | The extension sends bounded `onUpdate.details` | Replace flat details with a versioned envelope |
| Terminal metadata | The extension returns execution result and observations in `details` | Normalize into the same envelope |
| Child Pi session ID | The adapter captures it, but live observations do not expose it | Add it to the verified-launch observation and envelope |
| Child transcript | `sessionsApi.messages` already reads a session by ID and checkout | Reuse through a read-only inspector after a real probe |
| Full Chat | `ChatView` owns transcript layout, paging, anchors, and current exchange | Preserve |
| Per-tool presentation | `ToolExecutionView` has generic rendering plus edit-specific behavior | Add one deep subagent projection and view |
| Child count under parent session | Workbench plugin cannot parse transcripts | Add a bounded PI WEB-owned presentation host seam |
| Direct child-only cancellation | PI WEB currently aborts active parent work, which propagates to the tool signal | Ship truthful combined-stop behavior; defer child-only control |

## Ownership and module seams

### Pi execution adapter

`packages/pi-execution-adapter/` continues to own launch, observation, termination, and cleanup. It
adds no UI concepts. Its only contract change is to include the known `sessionId` in the
`binding_verified` observation after the child runtime identity and binding have both been
validated.

### Subagent extension

`extensions/subagent/` owns one versioned, bounded presentation envelope. It maps adapter
observations and terminal results into that envelope for every update and final result. PI WEB must
not reverse-engineer adapter observations or parse display prose.

Proposed shape:

```ts
interface SubagentExecutionDetailsV1 {
  kind: "pi-workbench.subagent-execution";
  version: 1;
  executionId?: string;
  input: {
    task: string;
    profile: "scout" | "planner" | "reviewer" | "implementer";
    cognitiveRole: CognitiveRole;
  };
  state: "preflight" | "launching" | "running" | "cancelling" | "terminal";
  runtime?: {
    provider: string;
    model: string;
    effort: string;
    quotaAdmission: QuotaAdmission;
    quotaTelemetryStatus: QuotaTelemetryStatus;
  };
  childSessionId?: string;
  observations: Array<{
    sequence: number;
    at: string;
    kind: string;
    label: string;
    toolName?: string;
    isError?: boolean;
  }>;
  outcome?: ExecutionOutcome;
  resultText?: string;
  diagnostic?: string;
}
```

Bounds remain enforced at the producer: maximum observation count, task/result/diagnostic lengths,
and no unbounded arbitrary detail objects.

### PI WEB core

PI WEB owns the generic transcript and child-session reader, so the implementation belongs in the
PI WEB fork rather than the Workbench adapter.

Create one deep `SubagentExecutionPresentation` module whose interface is approximately:

```ts
projectSubagentExecution(execution: ToolExecutionPart):
  | { kind: "subagent"; value: SubagentExecutionViewModel }
  | { kind: "ordinary" };
```

The module owns version validation, legacy fallback, lifecycle mapping, labels, bounded
observations, terminal categories, and action availability. `ChatView` and tests consume the view
model rather than inspecting raw `details`.

Create `SubagentExecutionCard` for disclosure state and rendering. Create `ChildSessionInspector`
for read-only paging and loading/error/retry behavior. `PiWebApp` supplies the selected machine and
parent checkout when it handles an inspect request; the Workbench plugin never reads child
transcripts.

### Pi Workbench adapter

The Workbench adapter may show a collapsed count/index beneath the **selected parent session** only
through a generic PI WEB-owned `SessionChildExecutionHost`:

```ts
interface SessionChildExecutionHost {
  snapshot(): SessionChildExecutionSnapshot;
  watch(handler: (snapshot: SessionChildExecutionSnapshot) => void): () => void;
  focus(executionId: string): Promise<boolean>;
}
```

The snapshot contains bounded presentation facts—parent session identity, execution identity,
title, state, and active/terminal status—not task text, observations, result text, or child
transcript. `focus` selects Chat, scrolls to the chronological card, expands it, and restores focus.
The host is live presentation state, never Workstream authority. Absence means “not currently
observed,” not “no child executions exist.”

## Interaction contract

### Collapsed card

Show:

- assignment title derived from the first bounded line of `task`;
- `profile` and Cognitive Role;
- elapsed time when available;
- one non-color-only lifecycle label;
- disclosure affordance.

Cards start collapsed on initial load, transcript paging, reconnect, session selection, and return
from the child inspector. User disclosure state may remain local while the same Chat stays mounted,
but is not persisted as Workstream state.

### Expanded card

Order information by user question:

1. exact self-contained input;
2. child profile and Cognitive Role;
3. resolved provider/model/effort and quota admission;
4. bounded observation timeline;
5. terminal category, compact result, and diagnostic;
6. Pi session ID and **Inspect child chat** when available.

Do not render raw JSON. Degraded quota telemetry is a warning fact, not a failure. Preflight failure
has no child-chat action because no child session exists.

### Cancellation

The first production cut uses PI WEB's existing stop-active-work path. The card action must say
**Stop child and lead turn**, with confirmation text explaining that PI WEB will abort the current
lead turn and the extension will then confirm child termination. It may change to **Cancel child**
only after a generic, tested tool-call cancellation mechanism can target one active invocation
without claiming the lead remains unaffected.

During termination the card says **Cancelling…** and disables repeated submission. The terminal
state comes only from the extension envelope. A lost or unreconciled process becomes **Outcome
unknown** with explicit repository/session inspection guidance.

### Read-only child chat

**Inspect child chat** replaces the center Chat content temporarily while preserving the outer
Workbench shell and parent session selection. The inspector header shows:

- **Back to parent chat**;
- assignment title;
- “Read-only child conversation”;
- profile, Cognitive Role, and lifecycle status.

The body reuses PI WEB's safe message normalization and Chat rendering where possible, including
history paging. It omits the composer and all mutating session controls. The footer states that the
session is inspection evidence from one bounded execution and offers **Copy Pi session ID**.
Returning restores the parent card's scroll anchor and focus.

For a running child, refresh the transcript with a bounded foreground poll only while the inspector
is open. Stop polling on close, terminal state, reconnect, or component disposal. Do not add the
child to the normal session catalog to obtain live updates.

## Delivery sequence

### 0. Prove the runtime path and lock the contract

Before editing `../pi-web`, fetch both `upstream` and the `origin` fork, branch from the current fork
baseline, and preserve unrelated local changes.

1. Capture real `tool.start`, `tool.update`, and `tool.end` events from the current Level 1
   extension, including success, active cancellation, and `outcome_unknown`.
2. Prove that `sessionsApi.messages({ id: childSessionId, cwd: parent.cwd }, machineId)` can read the
   separately launched child's persisted transcript while running and after completion without
   selecting or registering it as a normal PI WEB session.
3. Confirm how soon the child session file becomes discoverable and specify bounded loading/retry
   behavior for startup races.
4. Approve the V1 combined-stop wording. Do not label an abort of the parent turn as child-only
   cancellation.
5. Freeze the V1 details schema, bounds, lifecycle table, and malformed-input fallback.

Exit: one recorded fixture proves every required fact can reach PI WEB and the transcript inspector
can read the child without changing selected session state. If live reads are impossible, keep the
inspector terminal-only for the first cut rather than adding hidden session registration.

### 1. Produce typed execution details

1. Add `sessionId` to the adapter's verified-binding observation and update its declarations and
   deterministic tests.
2. Add a pure extension-side projector that builds `SubagentExecutionDetailsV1` from params,
   binding, receipt, observations, cancellation, and result.
3. Emit the same versioned envelope on every `onUpdate` and final return.
4. Preserve compact model-facing `content`; presentation details must not inflate parent Model
   Context.
5. Cover preflight failure, launch failure, running, degraded quota telemetry, tool progress,
   cancelling, success, execution failure, timeout, cancelled, and outcome unknown.

Exit: fixture streams are bounded, versioned, and require no prose parsing by PI WEB.

### 2. Add the PI WEB projection module

1. Define and validate `SubagentExecutionDetailsV1` at the transcript seam.
2. Project raw `ToolExecutionPart` plus args into one stable view model. A pending or running
   `subagent` call with valid typed args may produce a provisional preflight/launching model before
   its first details update; a terminal or replayed record requires the versioned envelope.
3. Give `groupChatMessages` one predicate from that module so a validated subagent execution is a
   readable standalone message rather than disappearing inside the generic event-group disclosure.
4. Keep generic `ToolExecutionView` as the fallback for absent, legacy, malformed, oversized, or
   unknown-version details.
5. Preserve live update reconciliation by `toolCallId`; updates must not reset user disclosure.
6. Add table-driven tests for all lifecycle, action, and grouping states.

Exit: callers learn one small projection interface and no rendering module understands raw details.

### 3. Implement conversation-native cards

1. Route recognized `subagent` executions from `ToolExecutionView` to `SubagentExecutionCard` at
   the same transcript index, but outside the generic collapsed event group.
2. Render the selected collapsed and expanded content hierarchy.
3. Keep cards collapsed by default and stable through current-exchange grouping, earlier-history
   expansion, live streaming, and result replacement.
4. Wire copy-session-ID and truthful stop-active-work actions.
5. Make tool and execution failures legible without opening raw details.
6. Preserve generic tool cards for every other tool.

Exit: the complete parent Chat remains primary and a child execution can be understood or stopped
without leaving its chronological context.

### 4. Add read-only child transcript inspection

1. Add `ChildSessionInspector` and a small controller that loads `sessionsApi.messages` with the
   child ID, parent checkout, and selected machine.
2. Normalize messages through the existing transcript pipeline and reuse safe Markdown, tool,
   image, and history presentation.
3. Exclude composer, prompting, model controls, checkpoint controls, branch/fork controls, and
   session selection.
4. Add loading, startup-race retry, missing session, malformed history, remote-machine, reconnect,
   paging, and terminal states.
5. Restore parent transcript scroll and focus exactly to the invoking card.
6. Poll only while a running child inspector is visible, if phase 0 proves live reads safe.

Exit: **Inspect child chat** shows the complete available child conversation and cannot mutate or
promote the child session.

### 5. Add the selected-session child index

1. Add `SessionChildExecutionHost` to generic PI WEB primary-view context.
2. Derive its selected-parent snapshot from the same validated view models used by Chat; do not
   parse DOM or raw transcript details in the plugin.
3. Add a collapsed **Child executions · N** disclosure beneath the selected Workstream session.
4. Show compact state rows only after disclosure; active count may appear on the collapsed session
   tab.
5. Route a selected row through `focus`, which opens parent Chat and expands the chronological card.
6. Clear or replace the snapshot when parent session selection changes. Never imply unobserved
   sessions have zero children.

Exit: the hierarchy provides origin and status while detailed truth remains in the parent Chat card.

### 6. Harden responsive, accessibility, and recovery behavior

1. Verify 40 px minimum interactive targets, visible focus, semantic `details` or equivalent
   disclosure, `aria-expanded`, status announcements, and non-color-only outcomes.
2. At narrow width, keep full parent Chat by default; expanded cards remain inline and the child
   inspector becomes the focused workspace pane with a clear return action.
3. Preserve parent drafts, scroll anchors, current-exchange disclosure, and selected checkout when
   opening or closing the inspector.
4. Handle reconnect during running, cancellation during reconnect, missing session ID, unavailable
   child transcript, stale updates, duplicate terminal events, and malformed details.
5. Ensure reduced motion, coarse pointer, 200% zoom, long tasks, long model names, and 50,000-character
   bounded results remain usable.

Exit: the feature remains truthful and operable in desktop, tiled, narrow, reconnect, and failure
fixtures.

### 7. Verify and roll out

Deliver bounded pull requests in this order:

1. adapter observation and extension envelope;
2. PI WEB projection module and fixtures;
3. conversation-native card;
4. child transcript inspector;
5. selected-session child activity host and Workbench index;
6. responsive/accessibility fixes and recorded browser evidence.

Do not expose the custom card until the new extension envelope and generic fallback tests pass.
Do not expose **Inspect child chat** until phase 0 proves lookup cannot change normal session
selection or Workstream association. Do not expose a child-only cancellation label until child-only
termination is actually controllable.

## Verification matrix

Automated coverage must include:

- all seven terminal outcomes and every intermediate lifecycle state;
- fresh and degraded quota admission;
- updates before binding verification and before child session ID discovery;
- duplicate, missing, out-of-order, oversized, malformed, and unknown-version details;
- two concurrent subagent tool calls with independent disclosure and status;
- cancellation confirmation, timeout, forced termination, and outcome unknown;
- current exchange, collapsed earlier history, transcript paging, reconnect, and result replay;
- child transcript loading while running and after completion;
- child transcript not found, wrong checkout, remote machine, and startup race;
- no composer or mutating controls in child inspection;
- parent scroll/focus/draft restoration;
- selected-session index focus and session-switch cleanup;
- generic rendering of old subagent records and unrelated tools.

Recorded browser evidence must cover collapsed, expanded running, degraded telemetry, cancelling,
success, failure, outcome unknown, read-only child chat, return-to-parent focus, two concurrent
children, tiled width, narrow width, 200% zoom, and reduced motion.

## Explicit deferrals

- durable Worker continuity or child-session recovery;
- child sessions as Workstream sessions, tabs, or checkpoints;
- Workstream Store records for child execution activity;
- cross-session or cross-Workstream child dashboards;
- background execution after the attended parent ends;
- retries, batches, chains, or managed Run graphs;
- direct child prompting, continuation, fork, resume, archive, or deletion;
- child-only cancellation until the harness exposes a truthful targeted mechanism;
- persistence of card disclosure state as canonical data.
