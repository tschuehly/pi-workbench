# Unified Chats and Workstreams prototype plan

Status: active working prototype

## Prototype authority

`docs/research/reports/pi-web-unified-chat-workstream-prototype.html` is the canonical interaction prototype for ongoing owner judgment. Iterate product slices there before production planning. The prototype is not protocol authority or production code; accepted interactions must still be reconciled with the contracts and implemented through a separate production plan.

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

A Workstream row opens state 2. A session row or horizontal session tab opens state 3. Chat, Context, Files, and Git are peer middle surfaces; switching surfaces does not change the selected standalone or Workstream session. Terminal is a checkout-labelled bottom dock scoped to the explicit session anchor. Do not add a second status/navigation bar beneath the global toolbar: anchor and checkpoint state remain available in session navigation, Context, the Session menu, and Terminal.

## Delivery sequence

### 1. Converge on one working prototype

Remove the A–E variant switcher and the four losing structures. Keep the unified navigator as the final shell, then restore the validated brief, navigation, Context, and decision interactions from the original prototype.

Represent the selected destination as `standalone-chat`, `workstream`, or `workstream-session`, rather than deriving the center from whether a Workstream happens to be active. Keep selected Workstream, session, tool, panel widths, and collapsed navigation as separate in-memory presentation state.

Use fixture data with at least two standalone Chats, two Workstreams, and one Workstream containing three differently anchored sessions. Every navigation control must update the middle pane, active selection, explicit anchor, context, and available actions without repeating Workstream or session identity in the global navbar.

### 2. Restore coordinated Workstream navigation

When a Workstream is selected, render the original prototype’s session hierarchy in the left pane. Clicking the Workstream identity opens the brief; clicking a session opens Chat.

When the left pane collapses, remove the vertical hierarchy and show the Workstream identity, a Brief tab, and horizontal session tabs above the middle surface. Expanding the pane removes that strip. Preserve attention markers, running-child counts, New session, and selected-session identity in both modes. New session must collect an explicit project/workspace anchor before launch rather than inherit hidden shell state.

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

### 5. Rebuild Context, tools, history, and Terminal

Standalone Chat exposes Chat, Files, and Git as peer middle surfaces. A Workstream session also exposes Context. Context contains the brief summary, durable Human Tasks, selected-session checkpoint, links, and anchor. Files, Git, and the Terminal dock remain scoped to the selected session. Remember the selected surface and Terminal state per session in prototype memory. Show selected-session context-window consumption beside the composer as used tokens, capacity, percentage, and a compact meter; warn visually at high usage.

Keep message history out of the permanent navbar. Double Escape opens earlier conversation points, and the Session menu provides a discoverable entry. Continuing from an earlier point returns to Chat and branches from that point.

### 6. Replace generic Actions with owned menus

Remove the current Search and Actions controls. Add one PI WEB menu for command palette, projects/checkouts, authentication, recovery, theme/presentation, and settings. Do not repeat Workstreams in this menu.

Add separate contextual menus:

- Workstream: rename, add link, close;
- Session: inspect anchor, resume, message history, request checkpoint.

Request checkpoint demonstrates the attended propose → correct → confirm interaction in memory. Only confirmation changes the displayed latest checkpoint; a simulated failure leaves the previous confirmation visible with an explicit failure state. Menu labels and placement must make ownership visible.

### 7. Retain promotion as a bounded transition

A standalone Chat has one Promote action. Confirmation collects the Workstream title and displays the existing Chat and checkout association. Confirmation preserves the same conversation and opens the resulting Workstream session state. No separate full-screen promotion-preview state is allowed.

### 8. Verify the complete prototype

Browser-test the final working prototype at desktop and narrow widths. Required scenarios:

- select each standalone Chat, Workstream, and session;
- open the Workstream brief from Workstream identity and Context;
- collapse and expand navigation, confirming the vertical/horizontal handoff and matching attention markers;
- start a session only after explicitly selecting its project/workspace anchor;
- resize and collapse side panels;
- answer, correct, and submit an inline live decision;
- answer a durable Human Task, inspect its receipt, resolve it separately, and open its source session;
- request a checkpoint, correct the proposal, confirm it, and inspect a failed proposal without losing the latest confirmation;
- switch surfaces and the Terminal dock across differently anchored sessions;
- confirm the redundant status bar is absent and context-window usage changes with the selected session, including the high-usage warning;
- open history with Double Escape and continue from an earlier point as a branch;
- promote a Chat without changing its transcript;
- operate every menu by pointer and keyboard;
- confirm no duplicate Workstream lists, actions, session navigation, or decision records.

## Completion and follow-on

Completion means one self-contained HTML prototype demonstrates every required state and transition with in-memory fixtures, working pointer and keyboard interactions, resizable panels, and responsive layouts.

After human acceptance, record which interactions won and create a separate production implementation plan. That later plan must reconcile the current contract requirement that every interactive session starts in a Workstream before proposing standalone Chats or promotion. No production or protocol change belongs to this prototype task.
