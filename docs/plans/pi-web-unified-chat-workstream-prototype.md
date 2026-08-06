# Unified Chats and Workstreams prototype plan

Status: proposed

## Outcome

Replace the current prototype’s additive layout with one coherent interaction model:

- selecting a Workstream opens its brief in the middle pane;
- selecting a session opens its Chat in the same pane;
- expanded vertical session navigation and collapsed horizontal tabs are mutually exclusive;
- live session decisions remain inline in Chat;
- durable Human Tasks remain in Workstream context;
- one PI WEB menu owns shell actions without repeating Workstreams.

Only the working prototype is in scope:

- change `docs/research/reports/pi-web-unified-chat-workstream-prototype.html`;
- use `docs/research/reports/pi-web-workbench-ux-prototype.html` as a read-only interaction reference;
- do not change PI WEB, the Workbench adapter, the Workstream Store, contracts, or schemas.

The result is an interactive working example for human validation. It does not claim that standalone sessions or promotion are supported by the current protocol. Production implementation receives a separate plan only after the prototype is accepted.

## Interaction contract

The middle pane has three destination states:

1. **Standalone Chat** — the standalone session’s conversation and live decisions.
2. **Workstream Brief** — continuation, changes, remaining work, Human Tasks, session updates, and session index.
3. **Workstream Session** — the selected Workstream session’s conversation and live decisions.

A Workstream row opens state 2. A session row or horizontal session tab opens state 3. Chat, Files, Git, and Terminal are orthogonal tool state for either kind of session: switching tools replaces the middle surface without changing its selected standalone or Workstream session.

## Delivery sequence

### 1. Converge on one working prototype

Remove the A–E variant switcher and the four losing structures. Keep the unified navigator as the final shell, then restore the validated brief, navigation, Context, and decision interactions from the original prototype.

Represent the selected destination as `standalone-chat`, `workstream`, or `workstream-session`, rather than deriving the center from whether a Workstream happens to be active. Keep selected Workstream, session, tool, panel widths, and collapsed navigation as separate in-memory presentation state.

Use fixture data with at least two standalone Chats, two Workstreams, and one Workstream containing three differently anchored sessions. Every navigation control must update the middle pane, breadcrumb, active selection, context, and available actions.

### 2. Restore coordinated Workstream navigation

When a Workstream is selected, render the original prototype’s session hierarchy in the left pane. Clicking the Workstream identity opens the brief; clicking a session opens Chat.

When the left pane collapses, remove the vertical hierarchy and show the Workstream identity, a Brief tab, and horizontal session tabs above the middle surface. Expanding the pane removes that strip. Preserve New session and selected-session identity in both modes.

Keep PI WEB-style narrow resize rails and compact collapse controls. Do not render both navigation modes simultaneously.

### 3. Restore the Workstream brief as a middle surface

Move the complete brief out of the overlay drawer and into the middle pane when the Workstream itself is selected. Include:

- next useful continuation;
- what changed and what remains;
- revision, freshness, and provenance;
- unresolved Human Tasks;
- latest confirmed session updates;
- session index with explicit anchors.

Remove the overlay brief drawer. A compact brief summary may remain in Context during session work, but it links to the full middle-pane brief rather than duplicating it.

### 4. Separate live decisions from durable Human Tasks

Render live `ask_user` decisions inline at the current Chat tail using the compact decision-card interaction: choice or text input, correction, submission status, and outcome. These decisions belong to the live session.

Render illustrative durable Human Tasks in the Workstream Context tab with answer kind, options, source-session provenance, materiality, answer status, answer receipt, resolution status, and “Open source conversation.” Model answering and resolving as separate in-memory interactions. Do not imply that the prototype writes canonical Workstream state or automatically combines live decisions with durable tasks.

### 5. Rebuild Context and tools

Standalone Chat exposes Files, Git, and Terminal only. Workstream session Chat exposes Context, Files, Git, and Terminal.

Context contains the brief summary, durable Human Tasks, selected-session checkpoint, links, and anchor. Files, Git, and Terminal remain scoped to the selected session. Remember the selected tool per session in prototype memory.

### 6. Replace generic Actions with owned menus

Remove the current Search and Actions controls. Add one PI WEB menu for command palette, projects/checkouts, authentication, recovery, theme/presentation, and settings. Do not repeat Workstreams in this menu.

Add separate contextual menus:

- Workstream: rename, add link, close;
- Session: inspect anchor, resume, request checkpoint.

Request checkpoint demonstrates the attended propose → correct → confirm interaction in memory. Only confirmation changes the displayed latest checkpoint; a simulated failure leaves the previous confirmation visible with an explicit failure state. Menu labels and placement must make ownership visible.

### 7. Retain promotion as a bounded transition

A standalone Chat has one Promote action. Confirmation collects the Workstream title and displays the existing Chat and checkout association. Confirmation preserves the same conversation and opens the resulting Workstream session state. No separate full-screen promotion-preview state is allowed.

### 8. Verify the complete prototype

Browser-test the final working prototype at desktop and narrow widths. Required scenarios:

- select each standalone Chat, Workstream, and session;
- open the Workstream brief from Workstream identity and Context;
- collapse and expand navigation, confirming the vertical/horizontal handoff;
- resize and collapse side panels;
- answer, correct, and submit an inline live decision;
- answer a durable Human Task, inspect its receipt, resolve it separately, and open its source session;
- request a checkpoint, correct the proposal, confirm it, and inspect a failed proposal without losing the latest confirmation;
- switch tools across differently anchored sessions;
- promote a Chat without changing its transcript;
- operate every menu by pointer and keyboard;
- confirm no duplicate Workstream lists, actions, session navigation, or decision records.

## Completion and follow-on

Completion means one self-contained HTML prototype demonstrates every required state and transition with in-memory fixtures, working pointer and keyboard interactions, resizable panels, and responsive layouts.

After human acceptance, record which interactions won and create a separate production implementation plan. That later plan must reconcile the current contract requirement that every interactive session starts in a Workstream before proposing standalone Chats or promotion. No production or protocol change belongs to this prototype task.
