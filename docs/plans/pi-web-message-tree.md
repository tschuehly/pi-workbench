# PI WEB message-tree implementation plan

Status: implementation plan for the approved message-tree prototype. The existing
[Workbench UI plan](pi-web-workbench-ui.md) remains implemented and authoritative for the shell,
Workstream hierarchy, current exchange, and attention behavior. This plan adds generic PI WEB
conversation-branch navigation without reopening those decisions.

## Outcome

Add a compact **History tree** inspector to every PI WEB Chat surface. The inspector shows retained
message branches for the selected session and supports two explicit operations:

- **Continue from here** changes the active conversation branch in the same session, optionally
  summarizing the context being left behind.
- **Fork into new session** creates a new session from the selected retained entry and leaves the
  original session unchanged.

Do not label either operation **Revert**. Neither operation undoes filesystem changes, shell
commands, tool calls, or other side effects.

Baselines:

- [Message-tree prototype](../research/reports/pi-web-message-tree-prototype.html)
- [Investigation and prototype decisions](../research/reports/pi-web-message-tree-prototype.md)
- [Workbench hierarchy prototype](../research/reports/pi-web-workbench-ux-prototype.html)
- PI WEB branch `upstream/feat/session-tree-fork-from-entry`

## Non-goals

This work does not change Workstream checkpoints, Human Tasks, concise current-exchange grouping,
transcript paging, Git history, child-Pi relationships, or repository undo behavior. It does not
expose PI WEB transcript data to the Workbench adapter. `/clone` remains a session action for the
current leaf rather than an action on every historical entry.

## Ownership and seams

### PI WEB core

PI WEB owns the tree projection, tree loading, branch mutation, fork creation, compact inspector,
confirmation flows, prompt-draft replacement, focus restoration, responsive behavior, and
side-effect warnings. The feature must work in ordinary Chat and in a Chat surface mounted through
`PrimaryViewSurfaceHost` without Workstream concepts in core code.

Keep one deep `SessionTreeNavigator` module. Its interface remains the snapshot plus callbacks for
continue, fork, cancellation, and summarization cancellation. It owns selection, folding, keyboard
navigation, confirmation state, busy state, local errors, compact rendering, and hover/focus
previews. Callers must not reproduce that state machine.

`PiWebApp` owns the Chat workspace composition: Chat and composer in the main column, with the
navigator as an optional right column on wide layouts and a focused full-width pane at narrow
widths. A small `SessionController.openTree()` interface should hide the `/tree` command string and
its result handling from rendering code.

### Pi Workbench adapter

The adapter owns the durable home of a session created by **Fork into new session**. It records a
pending Workstream association before PI WEB creates the fork, confirms the returned session, and
reconciles an interrupted outcome by a stable correlation token. It never reads the message tree or
infers a fork from the session list.

### Workstream Store

The existing records cover pending, confirmed, and failed creation, but they cannot terminalize a
user-cancelled fork truthfully. Add a reviewed `session.cancelled` record that removes the pending
association from the current projection while retaining the cancelled attempt in the ledger. Extend
`session.pending` with an optional typed derivation kind (`fork`) so activation-time reconciliation
can distinguish a fork from an ordinary launch; retain the source session through record
provenance. Keep unknown outcomes pending. These are protocol changes and require schema,
runtime-validation, reducer, fixture, and conformance review before the fork control is exposed in
a Workstream.

## Delivery sequence

### 0. Prepare the PI WEB branch and lock the outcome contract

Before editing `../pi-web`, fetch both `upstream` and `origin`, branch from the current fork baseline,
and confirm that `upstream` remains fetch-only. Preserve unrelated changes in the sibling checkout.

Review `upstream/feat/session-tree-fork-from-entry`, specifically commits `e002efe`, `a0582a6`, and
`d7aa17b`. Reuse their fork route, strict parsing, expected-leaf conflict check, controller refresh,
prompt-draft behavior, and navigator tests. Rebase or cherry-pick only after comparing those commits
with the current Workbench fork.

Approve an outcome table before implementation:

| Observed outcome | Runtime truth | Workstream transition |
| --- | --- | --- |
| Fork returns a session | Created | `session.pending` → `session.confirmed` |
| Runtime explicitly cancels before creation | Not created | `session.pending` → `session.cancelled` |
| Server rejects a checked precondition before mutation | Not created | `session.pending` → `session.failed` |
| Response is lost, connection drops, or mutation outcome is not proven | Unknown | Remain `session.pending`; reconcile by token |
| Session exists but Workstream confirmation fails | Created, association incomplete | Remain `session.pending`; retry confirmation by token |

"Unknown" is a client/coordinator conclusion caused by missing evidence, not a successful server
response. A generic network exception must never be converted to `session.failed` unless the server
proves non-creation.

Exit: the reviewed protocol can represent every terminal and non-terminal outcome without deleting
or inventing a session.

### 1. Adopt fork-from-entry and add durable correlation

Bring the three upstream fork-from-entry commits onto the Workbench PI WEB branch, then extend their
request with an optional opaque operation token:

1. Accept `entryId`, `expectedLeafId`, and the token at the client, federated route, server route, and
   runtime seams.
2. Preserve the source semantics: user entries fork from before the entry and return their text as
   the new session's prompt draft; other entries fork at the entry.
3. Before runtime mutation, write a server-owned derivation journal entry keyed by token in
   `prepared` state. Create the fork with the same token in its durable session header, then advance
   the journal to `created` with the session identity before returning success. Reuse of a token
   returns or resumes the same operation and must never create a second session.
4. Expose a server-backed lookup result of `absent`, `prepared`, `created`, `cancelled`, or `failed`.
   After reconnect completion, `absent` proves that the authoritative server never accepted the
   request, so the adapter terminalizes the Workstream pending record as failed. For `prepared`, the
   server first scans durable session headers for the token: a match advances the journal to
   `created`; no match remains pending while the server resumes or reconciles the operation.
   `created`, `cancelled`, and `failed` map to their corresponding Workstream transitions. The server
   may journal `failed` only when it proves non-creation. If journal and session-header evidence
   otherwise disagree, report an operator-visible reconciliation error and remain pending.
5. Keep active-work rejection, serialized session replacement, stale-leaf rejection, unique
   `— Fork N` naming, and authoritative session-list refresh.
6. Keep runtime cancellation distinct from failure. Treat response loss as unknown at the client;
   resolve it through the durable journal rather than a synthetic server result.

Exit: generic PI WEB can create or find exactly one correlated fork without the Workbench plugin,
including through remote-machine proxying and reconnect.

### 2. Add the derived-session coordinator and Workstream handshake

Add one generic `SessionDerivationCoordinatorContribution` to the PI WEB plugin interface. Its small
interface receives `{ operationId, kind: "fork", source }`, where `source` contains the selected
machine, project, workspace, and session identity. `operationId` is PI WEB's in-memory request
identity for duplicate-click suppression; the coordinator's `operationToken` is the durable
cross-system correlation key. The contribution provides these lifecycle methods:

- `prepare(request) -> { operationToken }` before PI WEB calls the fork route;
- `confirm(request, operationToken, createdSession)` after a created session is known;
- `cancel(request, operationToken)` after explicit runtime cancellation;
- `fail(request, operationToken, knownFailure)` only when non-creation is proven;
- `reconcile(request, operationToken)` for pending or unknown outcomes.

PI WEB rejects more than one active coordinator. When none is registered, ordinary PI WEB performs
the generic fork directly. When the Workbench plugin is installed, the coordinator applies in both
ordinary and mounted Chat, regardless of which primary view is currently visible.

The Workbench adapter resolves the source session against canonical snapshots before `prepare`.
Exactly one open home Workstream must contain that active session. No home, multiple homes, a closed
home, pending/failed source state, or mismatched location blocks creation with a precise recovery
message. `prepare` appends `session.pending` with the operation token, `derivationKind: "fork"`,
source-session provenance, and location. The projected pending association retains enough typed data
to reconstruct the reconciliation request after process replacement. `confirm`, `cancel`, and known
`fail` append the corresponding record idempotently. Plugin activation, reconnect completion, and
observed pending derived associations trigger `reconcile`; reconciliation asks PI WEB's server-backed
token lookup, never transcript or session-list inference.

Exit: tests prove pending-before-create ordering, confirmation, cancellation, known failure, unknown
outcome, browser replacement, reconnect reconciliation, duplicate delivery, closed/missing/multiple
home rejection, and rejection of a session already assigned to another Workstream.

### 3. Add a direct History tree entry point

Add a PI WEB-owned **History tree** button to the selected Chat surface. Use the same entry point in
ordinary Chat and host-mounted Chat.

`SessionController.openTree(): Promise<void>` should call the existing command route directly and
own a `treeOpening` state beside `treeDialog`. It applies a tree result, turns unsupported results
into a local actionable error, and always clears loading state; it does not insert `/tree` into the
transcript or prompt draft. Disable the button for archived, pending-start, empty, or actively
working sessions and explain the reason through accessible help text. Keep `/tree` available for
keyboard-oriented command use.

Opening, closing, and successful navigation must restore focus predictably: active tree leaf on
open, invoking button on cancel, and the composer after a successful continue. Session changes close
the inspector unless the operation itself selects the newly created fork.

Exit: the inspector can be opened without typing a command in both default and dedicated primary
views, and the selected checkout/session anchor remains visible.

### 4. Implement the compact in-context inspector

Replace the desktop full-screen tree dialog with the prototype's in-context composition:

1. On wide layouts, render a 400–460 px right column beside Chat. The PI WEB-owned mounted surface
   adapts only to its own container: when that container cannot preserve a useful Chat width,
   History replaces Chat temporarily. The Workbench adapter retains ownership of its outer session
   pane and existing responsive collapse rules; PI WEB core never collapses a Workstream pane.
2. Use one-line rows with branch-point indentation, kind, summary, timestamp, active-path state, and
   active-leaf state. Keep interactive hit areas at least 40 px high even if the visible row appears
   denser.
3. Show the complete summary in a positioned preview only when the visible summary is truncated.
   Pointer hover and keyboard focus both open it. Selection always exposes the full summary in a
   stable detail region, so touch and assistive-technology users do not depend on hover.
4. Preserve the existing tree keyboard model: Up/Down, Left/Right folding, Home/End, Enter, Escape,
   roving focus, explicit `aria-level`, `aria-selected`, `aria-expanded`, and non-color-only active
   markers.
5. On narrow layouts, show History as the focused pane while retaining the Pi menu and a clear return
   to Chat. Do not squeeze Chat and History into two unusable columns.
6. Keep large and deeply branched trees bounded with capped visual indentation, `content-visibility`,
   stable scrolling, and previews that stay within the viewport.

Exit: desktop, tiled-window, 200% zoom, coarse-pointer, reduced-motion, and narrow-width fixtures all
retain readable tree rows, reachable actions, and the selected session scope.

### 5. Preserve continue and fork semantics

Keep confirmation separate from selection. **Continue from here** offers no summary, default
summary, or custom-focus summary. **Fork into new session** states that the original session remains
unchanged. Both confirmations place the warning beside the final action:

> Conversation context only. This does not undo filesystem changes, shell commands, tool calls, or
> other side effects.

During summarization, retain cancellation and distinguish "cancelling" from "cancelled." During
fork creation, disable duplicate submission. If a fork exists but Workstream confirmation is still
pending, select the runtime session as required by PI WEB's replacement semantics, show the pending
association in the Workstream hierarchy, and report that reconciliation is required instead of
claiming success or failure.

After confirmation, the adapter refreshes the canonical Workstream projection. Only a confirmed
association becomes a peer session in the Workstream hierarchy. The PI WEB session list may show the
runtime session earlier, but the Workbench adapter must not manufacture an active Workstream row
from that observation. PI WEB must await selection of a successful fork, restore its prompt draft,
then focus its composer. If Workstream confirmation remains pending, the runtime selection is still
shown because PI WEB has already replaced the active runtime, but the Workbench hierarchy shows the
canonical pending association and reconciliation message.

Exit: continue keeps the same session identity and refreshes authoritative history; fork produces
one correlated new session and one canonical Workstream association, with the correct prompt draft
and focus destination.

### 6. Verify and roll out

Deliver bounded pull requests in this order:

1. `session.cancelled` and pending `derivationKind` contract, schema, reducer, fixture, and conformance updates;
2. upstream fork-from-entry adoption and server-owned correlation lookup;
3. generic derived-session coordinator seam;
4. Workstream coordinator and reconciliation;
5. direct History entry point and shared Chat workspace composition;
6. compact inspector and responsive behavior;
7. recorded-fixture browser evidence and accessibility fixes.

Unit and integration coverage must include malformed and cyclic trees, missing parents, deep linear
history, multiple branches, empty trees, active work, archived sessions, stale expected leaves,
summary cancellation, fork cancellation, duplicate clicks, remote machines, selection changes
mid-operation, browser replacement, unknown fork outcome, failed Workstream confirmation, and
reconciliation after reconnect.

Browser verification must cover ordinary PI WEB Chat and the Workbench dedicated view. Record
screenshots for default, hover/focus preview, continue confirmation, fork confirmation, pending
association, successful fork, error, tiled, and narrow states. Verify that concise current-exchange
history expansion still works independently of the message tree and that drafts and scroll anchors
survive opening and closing the inspector.

The first releasable cut includes phases 0–6. Do not expose **Fork into new session** inside an
active Workstream until the pending-before-create handshake, cancellation transition, durable token
lookup, and unknown-outcome reconciliation pass.
