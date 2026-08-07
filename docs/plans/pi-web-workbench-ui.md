# PI WEB Workbench UI implementation plan

Status: phases 0–5 implemented in the Workbench repository and PI WEB fork. Phase 6 is resolved
for V1 by the explicit deferrals below.

Implemented surfaces use the canonical Workstream protocol, generic PI WEB Pi-menu and
session-attention host seams, concise current-exchange presentation, namespaced place memory, and
typed durable Human Task answers. Recorded fixtures and browser evidence cover desktop and narrow
layouts.

## Outcome

Update PI WEB so a user can return through Workstreams, enter a stable session hierarchy, work in
centered Chat/Files/Git/Terminal surfaces, inspect canonical Workstream context in a top drawer, and
answer a concise decision attached to the latest Pi response.

Baselines:

- [Workbench hierarchy prototype](../research/reports/pi-web-workbench-ux-prototype.html)
- [Concise current-exchange prototype](../research/reports/pi-web-current-exchange-prototype.html)
- [Prototype lessons](../research/reports/pi-web-workbench-ux-prototype.md)

The implementation is desktop-first. Narrow and mobile behavior remains required before release.

## Current UI fit

| Prototype behavior | Current implementation | Result |
| --- | --- | --- |
| Centered Chat and fixed composer | Core `ChatView` and `PromptEditor` already own the main region | Reuse |
| Safe formatted model response | `FormattedText` renders sanitized Markdown and escapes raw HTML | Reuse |
| Choice and free-text decisions | `AskUserCard` supports options, custom text, drafts, and outcomes | Adapt |
| Compact tool activity | Event groups and the activity dock already exist | Adapt |
| Return to work | The Workbench plugin already contributes a Workstreams primary view | Reshape |
| Session hierarchy and scoped tools | The dedicated view mounts Chat, Files, Git, and Terminal through `surfaceHost` | Reshape |
| Top Workstream drawer | The plugin currently uses a separate tasks pane and checkpoint controls | Replace presentation |
| Latest-response focus | Chat renders a chronological stream with equal message treatment | New core behavior |
| Integrated Pi menu | Dedicated views can suppress native shell chrome and protected controls | Prerequisite shell change |
| Failed launch and checkpoint staleness | Current Workstream projection cannot represent both states completely | Protocol gap |
| Answerable durable Human Tasks | Workstream tasks contain only title/detail and can only be resolved | Protocol change |
| Cross-session pending asks | Plugin context exposes only the selected session, not an attention projection | New host seam |
| Nested child Pi status | Child work is visible as tool execution, not structured Workbench activity | Later seam |
| External attention | PI WEB has in-app notifications, not browser/OS escalation | Later capability |

## Ownership

### PI WEB core and fork

Own generic shell composition, qualified Pi-menu entries, protected controls, current-exchange
rendering, compact `AskUserCard`, session-attention observation, focus restoration, responsive
behavior, safe Markdown, and notification permission. Core code must not contain Workstream
semantics.

Likely files include `PiWebApp.ts`, `ChatView.ts`, `AskUserCard.ts`, `shared.ts`, `chatGroups.ts`,
`appShell/`, and `plugins/types.ts`.

### Pi Workbench adapter

Own Return to work, Workstream/session hierarchy, checkpoint and Human Task projections, explicit
session anchors, Workstream drawer content, typed mutations, receipts, and Workbench-specific
badges. The implementation remains in `packages/pi-web-integration/`.

### Workstream Store

Own failed-association projection, checkpoint freshness, durable Human Task answers, and any future
generated-brief records. PI WEB never infers canonical state from Markdown, transcripts, tool
output, or child activity.

## Delivery sequence

### 0. Close protocol gaps and prepare the fork branch

Before editing `../pi-web`, fetch both `upstream` and `origin`, create a fork branch, and confirm that
`upstream` remains fetch-only.

Review the Workstream schema before building UI fixtures:

1. Define how a failed session launch remains visible in the canonical projection instead of being
   deleted from current state.
2. Define a canonical checkpoint-staleness field or record and the deterministic event that changes
   it. Do not derive staleness from Chat or tool activity.
3. Add runtime validation, reducer tests, and recorded fixtures for pending, active, failed,
   checkpoint-failed, and checkpoint-stale sessions.
4. Capture desktop screenshots of the current PI WEB and Workstreams plugin for comparison.

Exit: fixtures can truthfully represent every state required by the graphical-attention contract.

### 1. Preserve protected controls through a generic Pi menu

Implement the minimum shell frame before expanding the dedicated Workstream experience:

1. Put registered primary-view entries, Projects, Actions, authentication, recovery, settings, and
   connection state behind the Pi logo. “Workstreams” appears because it is a qualified registry
   contribution, not because PI WEB core knows Workstream semantics.
2. Preserve keyboard access, command-palette access, focus return, and protected-control visibility.
3. Keep the current navigation panel as a rendered fallback until the Pi menu passes desktop and
   narrow-width verification.
4. Ensure dedicated primary views retain the Pi menu and protected shell frame instead of replacing
   all native chrome.

Exit: opening a dedicated Workstream cannot hide authentication, connectivity, recovery, settings,
or a route back to the default PI WEB views.

### 2. Reshape the Workbench adapter using existing surface seams

1. Make Workstreams the Return-to-work destination. Each row must show canonical what-changed
   content from confirmed checkpoints, unresolved Human Tasks, and the next resumable session.
2. Remember the last selected session per Workstream in browser-local presentation state. Use
   namespaced plugin preferences when that host seam is available rather than expanding direct
   global `localStorage` access. On return, restore the session when available; otherwise choose an
   active session deterministically, then the first recorded session. This memory is not canonical
   Workstream state.
3. Replace the permanent three-pane layout with vertical session navigation, a central mounted
   surface, an optional Human Tasks tray, and collapse-to-horizontal session tabs.
4. Keep New Session available in both navigation modes.
5. Add the Chat/Files/Git/Terminal rail through `surfaceHost.mount` and `activate`.
6. Add the top Workstream drawer. It composes only canonical session checkpoints, tasks, links,
   revision, freshness, and failure state. It is not a generated combined brief.
7. Preserve the explicit machine/project/workspace anchor on every session-owned surface.

Exit: Return to work answers what changed, what needs attention, and where to resume without reading
Chat. Entering a Workstream restores place and retains protected shell controls.

### 3. Implement the generic concise current exchange

Define presentation from message structure, not semantic inference:

1. The current exchange begins at the latest ordinary user message in the loaded transcript and
   extends to the live tail. Compaction and branch-summary messages do not start an exchange.
2. Earlier loaded messages remain in a collapsed history region. An anchor targeting collapsed
   history expands the region before restoring scroll and focus.
3. If the user message is outside the loaded page, render the loaded tail with an explicit history
   boundary. If no user message exists, retain the existing chronological presentation.
4. Keep streaming and tool-only tail events open; collapse completed tool groups and retain the
   existing activity dock.
5. Render the latest assistant response with existing safe Markdown. Never parse headings into
   inferred context, recommendation, evidence, or authority.
6. Render `pendingAsk` as the current decision after the tail, without claiming it belongs to a
   specific assistant message. An ask without assistant prose must still work.
7. Add compact single-question presentation to `AskUserCard`; preserve its multi-question flow,
   drafts, partial submission, outcomes, and accessibility.
8. Omit “Why and evidence” unless the question detail or a future typed schema supplies it
   explicitly.

Exit: the latest response and decision fit in one desktop viewport while paging, scroll anchors,
copy actions, compaction, reconnect, and full history remain correct.

### 4. Add a bounded session-attention host seam

The Workbench session hierarchy cannot inspect other sessions through current plugin context.
Introduce a generic PI WEB-owned interface instead of parsing transcripts:

1. Expose an immutable session-attention snapshot keyed by machine, session, and ask identity.
2. Provide disposable ordered watch updates and a reconnect-complete snapshot so absence is
   distinguishable from stale observation.
3. Provide one focus command that selects the owning session, opens Chat, expands required history,
   scrolls to the ask, and focuses its first unanswered control.
4. Badge the owning PI WEB session once and deduplicate by ask identity, not prose.
5. Keep this live session attention separate from canonical Workstream Human Tasks. The adapter must
   not copy pending asks into durable state implicitly.

Exit: the Workbench hierarchy can show and focus pending asks across its sessions without broad
`AppState` access or transcript inference.

### 5. Extend durable Human Tasks separately

Define and review a Workstream schema for answer type, options, source-session provenance,
materiality, answer, status, and receipt. The projection must preserve provenance currently present
only on semantic records. Add answer records and reducer behavior, then update runtime validation,
`workstream-client.js`, fixtures, and adapter controls.

A live `ask_user` submission and Workstream answer are separate mutations. Define retry, partial
failure, and reconciliation behavior before connecting them; do not imply atomicity. This phase is
when durable badges and answers become available in Return to work and the Workstream drawer.

Exit: Yes, No, Change, finite-choice, and free-text answers survive reload, duplicate delivery,
reconnect, and revision conflicts.

### 6. Gate advanced prototype behavior

The V1 protocol decisions are:

- **Brief Curator:** rejected for V1. Per-session owner-confirmed checkpoints remain the only
  continuation narrative; no hidden session or combined generated brief is introduced.
- **Nested child status:** deferred until structured Workbench parent/child activity metadata exists.
  Child execution remains visible in Chat tool activity and does not become a peer session.
- **Browser/OS notifications:** deferred until typed materiality and notification-deduplication rules
  are approved. The implemented session-attention focus command provides exact in-app restoration;
  routine progress never triggers external notification.

## Verification and rollout

Split delivery into bounded pull requests: protocol conformance, protected shell frame, adapter
hierarchy, current exchange, session-attention host, then durable answers. Each pull request includes
unit tests and recorded-fixture browser evidence.

Validate keyboard flow, screen-reader labels, protected controls, scroll and draft preservation,
stale revisions, reconnect, session switching, desktop, tiled window, narrow width, reduced motion,
and coarse pointer. Ordinary UI tests use deterministic fixtures and spend no model tokens.

The first usable implementation cut is phases 0–3. It delivers truthful re-entry, the selected
hierarchy, and concise decisions without pretending pending asks are durable Workstream state.
