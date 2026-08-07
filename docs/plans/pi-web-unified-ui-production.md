# Unified Chats and Workstreams UI production plan

Status: proposed UI-only release plan. This plan sequences the accepted interaction direction in
[`pi-web-unified-chat-workstream-prototype.html`](../research/reports/pi-web-unified-chat-workstream-prototype.html)
without changing Workstream protocol meaning.

## Outcome

Ship one PI WEB composition in which the owner can move among three middle-pane destinations:

1. **Chat** — an existing PI WEB-native conversation selected outside Workstream navigation;
2. **Workstream brief** — a structured, read-oriented projection of one canonical Workstream;
3. **Workstream session** — the selected Workstream session using the same host-owned Chat canvas.

A Workstream row always opens its brief. A Workstream session row opens its Chat. On desktop, the
expanded vertical navigator and collapsed horizontal destination strip are mutually exclusive. At
narrow widths, navigation becomes a focused overlay while the selected destination remains full
width. Chat, Files, and Git remain PI WEB-owned session surfaces; Workstream sessions additionally
receive an adapter-owned Context surface. Terminal remains a checkout-labelled bottom dock.

This is deliberately a presentation release. It does not make standalone Chats canonical
Workbench objects, create a durable relationship between a Chat and a Workstream, or add a
Workstream-level generated narrative.

## Production judgment

Implement the unified composition in the **Pi Workbench adapter**, supported by one additive,
generic PI WEB session-navigation host. Do not move Workstream vocabulary or projection logic into
PI WEB core, and do not expose broad `AppState` to the adapter.

“Chat” is a presentation label in this release. PI WEB core supplies immutable native session
metadata and complete locations. The native-session inventory is bounded to the currently selected
PI WEB machine; Workstreams remain portfolio-wide, and changing machines replaces the Chat
inventory. After both that inventory and the full current and closed Workstream projection have
reconciled, the adapter may place a session in **Chats** only when
no canonical Workstream association positively names that session. The adapter does not persist
that classification. While either inventory is incomplete, it shows loading or reconnect state
instead of inferring that absence means standalone.

The release supports navigating existing unmatched PI WEB Chats. It does **not** add a New Chat path
to the Workbench shell. The existing session-start guard remains in force because the current
contract requires every newly started interactive Workbench session to begin in exactly one
Workstream. Creating durable standalone Chats requires the deferred protocol decision.

A **Workstream brief** is likewise a presentation, not a new stored record. It mechanically arranges
canonical per-session checkpoints, Human Tasks, links, anchors, revision, closure, and failure or
staleness state. It must not synthesize a combined “what changed,” “what remains,” freshness claim,
or provenance that the projection does not contain.

## Scope

### Included

- A root **Chats + Workstreams** navigator with explicit Chat and Workstream sections.
- The three destination states and their deterministic selection/restoration behavior.
- Workstream-specific session navigation after a Workstream is selected.
- A middle-pane Workstream brief and a compact Workstream Context surface during session work.
- Expanded vertical navigation, collapsed horizontal navigation, panel resizing, and narrow overlay
  navigation without rendering duplicate modes.
- Reuse of the existing host-owned Chat, concise current exchange, compact single-question
  `ask_user` card, Files, Git, Terminal, drafts, scroll restoration, and session attention.
- Browser-local place memory through the namespaced preferences host.
- Existing typed Workstream actions, including attended session launch, resume, checkpoint,
  Human Task answer/resolve, Workstream reference links, closure, and typed anchor repair.
- A refined PI menu that preserves protected shell controls without repeating the active
  Workstreams destination.
- Desktop, tiled, narrow, keyboard, coarse-pointer, reconnect, and failure evidence.

### Explicitly deferred

- Chat promotion into a Workstream and Chat-to-Workstream linking, including their controls,
  dialogs, persistence, and relationship badges.
- Starting a new standalone Chat from the Workbench composition.
- Any Workstream schema, ledger record, client operation, Store reducer, controller, or other
  protocol change.
- A generated or persisted combined Workstream brief, background curator, or transcript-derived
  continuation.
- Workstream rename unless and until a typed operation exists. Existing `link.upsert` remains
  available for ordinary Workstream references; it is not Chat linking.
- Message-tree redesign, Double-Escape history behavior, child-execution navigation, subagent cards,
  and child-session semantics. Preserve compatible upstream behavior; follow their separate plans.
- New notification policy, managed Run controls, FirstMate, or model-backed portfolio synthesis.
- Lifecycle or session-anchor protocol expansion. The durable lifecycle and typed anchor-repair work
  are prerequisites to preserve, not features to redesign in this release.

## Ownership and invariants

### PI WEB core and fork

PI WEB owns:

- the Pi menu, protected controls, responsive shell frame, focus restoration, and default-shell
  escape path;
- the generic native-session navigation snapshot/watch/select host and complete session locations;
- host-owned Chat, Prompt Editor, concise current exchange, live `ask_user`, Files, Git, Terminal,
  session telemetry, drafts, scroll state, and session-tree compatibility;
- generic plugin preferences and session-attention hosts;
- long-lived session-daemon ownership, restartable web/UI lifecycle, typed session selection errors,
  and session-location resolution from the durable lifecycle work.

Core code must not contain Workstream names, Store fields, checkpoint selection rules, Human Task
semantics, or Chat/Workstream relationship inference. Public host additions remain optional and
additive under the current plugin API compatibility policy.

### Pi Workbench adapter

`packages/pi-web-integration/` owns:

- joining the complete PI WEB session inventory with canonical Workstream session associations for
  presentation;
- the Chats + Workstreams navigator, Workstream hierarchy, brief, Context surface, badges, and
  deterministic destination reducer;
- canonical Workstream watch/reconnect state and all existing typed mutations and receipts;
- explicit Workstream-session anchors, selected-session attention, typed anchor-repair presentation,
  and browser-local Workbench place memory;
- deterministic paired fixtures and release evidence.

The adapter must use public host interfaces. It must not read private routes, broad `AppState`, DOM
from mounted core surfaces, transcript text, terminal output, or machine-local files to decide
Workstream or Chat state.

### Workstream Store

The Workstream Store remains unchanged and authoritative for session association, checkpoints,
Human Tasks, links, revision, closure, and anchor repair. No UI state is appended to its ledger.

### Fixed release invariants

- Selecting a Workstream opens the brief; selecting a session opens that session's Chat.
- Selecting a destination does not manufacture or mutate a Workstream association.
- Every Files, Git, Terminal, checkpoint, resume, and anchor-repair action uses the selected
  session's explicit machine/project/workspace location.
- Live PI WEB asks remain live session attention. Durable Human Tasks remain canonical Workstream
  state; the UI never combines them implicitly.
- PI WEB web/UI replacement must preserve Workstream state and must not restart the session daemon.
- Authentication, connection, recovery, Projects/checkouts, settings, command actions, theme and
  presentation, and a route to the default shell remain reachable in every state.
- Expanded vertical and collapsed horizontal navigation never render at the same time.

## Rebased integrated baseline

The production baseline is `feat/unified-workbench-ui` in the sibling PI WEB fork. It is a clean,
linear stack on the freshly fetched `upstream/main` and is not yet pushed. The safety ref
`safety/unified-ui-before-upstream-rebase` preserves the pre-rebase tip.

The baseline separates and preserves:

- configurable presentation profiles and the GitHub theme pair;
- project relocation and project navigation;
- generic primary views and dedicated mounted surfaces;
- the Pi menu, concise current exchange, compact decisions, namespaced preferences, and
  session-attention host;
- moved-worktree repair as an independent fix;
- fail-closed session-location resolution and the complete durable lifecycle series.

Rebase conflicts were resolved against current upstream contracts rather than by accepting either
side wholesale. Removed upstream compatibility controls were not reintroduced. The resulting fork
passes `npm run verify` (2,542 tests passed, 3 skipped), `npm run build`, and the complete Workbench
test suite. `upstream` remains fetch-only.

Before pushing, inspect the final range from `upstream/main`, retain the safety ref until browser
verification completes, and push only `feat/unified-workbench-ui` to `origin`. Generic PI WEB
commits and Workbench adapter commits remain separable for later upstream review.

**Baseline exit:** complete. New unified-navigation work starts from this verified branch.

## Target interaction and state model

Create a pure adapter-owned reducer rather than adding more implicit booleans to
`pi-web-plugin.js`:

```text
destination =
  | chat(sessionIdentity, completeLocation)
  | workstream(workstreamId)
  | workstream-session(workstreamId, sessionId)

navigation = expanded(width) | collapsed | narrow-overlay(open|closed)
surfaceBySession = chat | context | files | git
terminalBySession = { open, height }
```

Keep the destination independent from the core selected session. Entering a brief does not silently
select another runtime session. Entering Chat or a Workstream session first selects its complete
host location, waits for the typed result, and then commits the presentation destination. A failed
selection leaves the previous destination visible and presents the typed recovery action.

Persist only browser-local presentation values through `PrimaryViewContext.preferences`: last valid
destination, selected session per Workstream, surface per session, navigation mode and width, and
Terminal open/height per session. Use stable machine/project/workspace/session identities in keys.
On explicit Workstream-row selection, always open the brief even if a session was remembered. On
reload, restore the exact last destination only after both inventories reconcile; otherwise fall
back to the root navigator without guessing.

For the brief's first continuation, reuse the existing deterministic session-selection rule:
remembered active session, otherwise first active session, otherwise first projected session. Show
that session's confirmed `next` value with its source session and stale/failed/missing state. Then
show every session's own `whatChanged`, `remains`, `next`, next-session prompt availability,
references, and anchor. Do not combine those fields into Workstream prose.

## Delivery sequence

### Phase 0 — Establish the rebased integrated baseline

Status: complete. The dirty work was split into coherent commits, the durable lifecycle series was
replayed, current upstream contracts were reconciled, and aggregate verification and production
builds pass. Browser-level lifecycle continuity remains part of final release evidence rather than
a reason to reopen the baseline.

**Exit:** met. The sibling checkout is clean and no uncommitted baseline change remains.

### Phase 1 — Add the generic native-session navigation host

Add a small PI WEB-owned `SessionNavigationHost` to `PrimaryViewContext`, following the immutable
snapshot/watch/dispose shape already proven by `SessionAttentionHost`. Its public view model should
contain only stable presentation data: selected-machine scope, session identity, title/summary
already owned by PI WEB, archived/current status, modified time, complete machine/project/workspace
location, selected identity, sequence, loading/reconnect completeness, and a typed `select`
operation. It must not contain Workstream membership or a create/promote/link action.

Implement catalog loading, cancellation, ordering, and reconnect reconciliation behind one core
module. The snapshot must distinguish complete empty inventory from partial or unavailable
observation. Reuse upstream's current session listing and location machinery after the rebase rather
than opening session files or parsing messages in the plugin. Bound concurrent catalog reads and
retain the last complete snapshot while reconnecting.

Generalize core mounted-surface empty text from “Workstream session” to “Chat” or “selected
session.” Keep `PrimaryViewSurfaceHost` responsible for mounting and refreshing core surfaces. Add
the optional host to both internal and published plugin declarations and document it as a generic,
read-only navigation seam.

**Exit:** a generic test plugin can list and select two differently anchored native Chats inside a
dedicated primary view, preserve that primary view, distinguish loading/reconnect/empty, and do so
without `AppState`, private routes, Workstream vocabulary, or session creation.

### Phase 2 — Lock the paired fixture and destination reducer

Add a deterministic paired fixture in `packages/pi-web-integration/` with at least:

- two existing unmatched PI WEB Chats with different anchors;
- two current Workstreams and one closed Workstream;
- one Workstream with three active sessions on different anchors;
- pending and failed associations, a missing/stale/failed checkpoint, unresolved and answered Human
  Tasks, links, and one anchor-repair case;
- one live ask in an unmatched Chat and one in a Workstream session;
- partial native-session inventory, Workstream reconnect, and an invalid duplicate-home case.

Extract pure modules such as `unified-navigation-state.js` and `workstream-brief-projection.js` from
the current monolithic plugin. The join excludes a Chat only on a positive canonical association
match and refuses to classify while either side is incomplete. The reducer owns destination
validation, back navigation, selection races, per-session surface memory, and invalidation after
closure/session removal.

**Exit:** table-driven Node tests prove every destination transition and fallback without rendering
DOM or spending model tokens.

### Phase 3 — Build the unified navigator and shell frame

Replace the current portfolio-to-three-pane transition with the accepted hierarchy:

1. The root navigator lists **Chats** and **Workstreams**. The Chats heading names the selected
   PI WEB machine so its scope is explicit. Chat rows show PI WEB title, explicit anchor, modified
   time, and live-attention badge. Workstream rows show title, revision/closure,
   unresolved Human Task count, session/checkpoint health, and the deterministic sourced
   continuation.
2. Selecting a Workstream replaces the root list with Workstream identity, a back control, canonical
   status, and its session hierarchy. Clicking the identity opens the brief; clicking a session
   selects its host location and opens Chat.
3. On wide layouts, collapse removes the vertical hierarchy and renders a horizontal strip with
   Workstream identity, Brief, session tabs, and live-attention indicators from the approved host,
   plus New session. Expanding removes the strip. Child-running indicators remain deferred with the
   separate subagent presentation plan. For the root state, collapsed navigation uses one bounded
   horizontally scrollable Chats/Workstreams strip.
4. Add a PI WEB-style resize separator with pointer and keyboard support, bounded width, visible
   focus, and namespaced width persistence. Do not use a permanently wide decorative rail.
5. At narrow width, remove the persistent left pane. A labelled Navigate control opens a focused
   overlay containing the same root or Workstream hierarchy. Close returns focus to the trigger;
   selection moves focus to the brief heading or Chat composer.

Refine the dirty `AppPiMenu` rather than adding another menu. In the active unified dedicated view,
show protected shell utilities and a generic **Open default PI WEB shell** escape path, but omit the
active Workstreams destination so the menu does not duplicate the navigator. Projects/checkouts,
command actions, authentication, connection/recovery, theme/presentation, and settings remain
core-owned. The adapter contributes no copies of those actions.

**Exit:** pointer and keyboard users can move Chat → Workstream brief → Workstream session → root at
desktop and narrow widths; each destination has one active marker and there is no duplicate
Workstream list or simultaneous vertical/horizontal session navigation.

### Phase 4 — Move canonical Workstream context into the middle pane

Replace the overlay/top Workstream drawer with a full middle-pane brief selected by Workstream
identity. Arrange canonical content in this order:

1. title, revision, open/closed state, and per-session checkpoint health;
2. next resumable session and its sourced confirmed continuation, or an explicit missing/stale/
   failed state;
3. unresolved Human Tasks, with materiality and source-session provenance where projected;
4. per-session confirmed updates showing `whatChanged`, `remains`, `next`, next-session prompt and
   references without aggregation;
5. session index with pending/active/failed state and complete anchor;
6. ordinary Workstream links.

A Workstream session receives an adapter-owned **Context** peer beside Chat, Files, and Git. Context
shows the selected session checkpoint, anchor, relevant Workstream Human Tasks and links, and an
**Open full brief** action. Human Task answer and resolve remain separate typed actions. Chat does
not receive Context.

Keep only supported contextual actions. Workstream actions may add an ordinary reference link and
close; session actions may inspect anchor, resume, request/confirm a checkpoint, and repair a typed
missing anchor. New session shows the complete currently selected host location and requires owner
confirmation before the existing pending → host start → confirmed handshake. If the location is
wrong or incomplete, route to Projects/checkouts rather than inheriting hidden state.

**Exit:** the owner can answer what changed, what remains, what needs attention, and where each
session resumes from canonical projection data, and inspection confirms that no combined brief or
new mutation type was invented.

### Phase 5 — Finish session presentation on the shared canvas

Use one core-owned mounted Chat composition for both Chat and Workstream-session destinations. Do
not fork `ChatView`, `PromptEditor`, `AskUserCard`, Files, Git, or Terminal in the adapter.

- Preserve the dirty concise-current-exchange behavior, collapsed earlier conversation, paging,
  scroll anchors, safe Markdown, compact single-question ask, multi-question ask flow, and ask
  focus from `SessionAttentionHost`.
- Keep live asks inline at the Chat tail. Workstream Human Tasks remain in Context/brief and never
  become Chat records.
- Show Chat/Files/Git for a native Chat and Chat/Context/Files/Git for a Workstream session. Remember
  the selected surface per session.
- Keep Terminal as a collapsed bottom dock labelled with the selected complete anchor. Preserve its
  host-owned process and terminal selection while the adapter owns only dock visibility/height.
- In hosted Chat, move compact context-window usage and high-usage warning next to the Prompt Editor's
  existing model/thinking controls, preserving token/cost/warning access without a redundant second
  status strip. Keep default-shell compatibility through an explicit hosted presentation option
  rather than deleting `StatusBar` globally.
- Rebase-compatible upstream message-tree entry points must continue to work from mounted Chat, but
  this phase does not redesign them.

**Exit:** switching among differently anchored Chats and Workstream sessions preserves the correct
transcript, draft, scroll, live ask, model/status, Files/Git checkout, and Terminal scope. No surface
shows data from the previously selected session.

### Phase 6 — Harden desktop, narrow, failure, and compatibility behavior

Cover loading, empty, reconnect, session-selection race, unavailable machine/project/workspace,
missing session, typed missing anchor, closed Workstream, plugin-host absence, malformed fixture,
and failed Workstream mutation. Keep the last known canonical projection visible during reconnect
and label it as such.

The new host remains optional under `apiVersion: 1`. On an older PI WEB host, the adapter must not
call private APIs or crash; it may retain the current Workstreams-only fallback with a clear update
message. Plugin exceptions remain isolated and the Pi menu's default-shell escape path remains
usable.

Verify visible focus, logical heading and landmark order, non-color-only current/stale/failure
labels, `aria-current`/`aria-selected`/`aria-expanded`, status announcements, Escape behavior,
44-pixel coarse-pointer targets, reduced motion, 200% zoom, long titles, many sessions, and bounded
horizontal overflow. A narrow layout must show one focused pane, not compressed side-by-side panes.

**Exit:** all fixture states are truthful and operable at desktop, tiled, 760-pixel transition,
390-pixel, and 320-pixel widths without hiding protected shell controls.

### Phase 7 — Verify, evidence, and release

Run the narrowest suites first, then the complete affected checks:

```sh
# PI WEB fork
npm test -- --run src/client/src/components/appShell/AppPiMenu.test.ts
npm test -- --run src/client/src/components/PiWebApp.primaryViewHost.test.ts
npm test -- --run src/client/src/chatGroups.test.ts src/client/src/components/ChatView.askUser.test.ts
npm test -- --run src/client/src/plugins/sessionNavigationHost.test.ts src/client/src/plugins/sessionLocationResolver.test.ts
npm test -- --run src/server/sessiond.socketOwnership.test.ts src/sessiond/sessiondOwnership.test.ts src/nativeServices/nativeServiceStatus.fixtures.test.ts
npm run typecheck
npm run lint
npm run build:plugin-api
npm run verify

# Pi Workbench
npm run test:workstream-store
npm run test:pi-web-integration
```

Use the paired deterministic fixture for browser evidence; ordinary UI verification must spend no
model tokens. Record screenshots and an interaction log for:

- root navigator with both Chats and Workstreams;
- standalone Chat with a live ask;
- Workstream brief with current, stale, missing, and failed session states;
- Workstream session Chat and Context;
- expanded and collapsed desktop navigation;
- differently anchored Files, Git, and Terminal;
- reconnect with last-known projection, typed anchor repair, empty, and host-unavailable fallback;
- tiled, 760-pixel transition, 390-pixel, 320-pixel, 200% zoom, coarse pointer, and reduced motion.

The browser pass must select every Chat, Workstream, and session; verify Workstream-row-to-brief and
session-row-to-Chat behavior; collapse/expand navigation; open/close narrow navigation; answer a live
ask and a durable Human Task separately; confirm checkpoint failure retains the prior checkpoint;
confirm explicit anchor before new Workstream session launch; and verify focus, draft, scroll, and
Terminal state after switching back.

Write the durable acceptance record beside the adapter and omit machine-local paths, credentials,
session identifiers, and generated user data. Add a PI WEB changeset for generic user-visible core
work and update canonical plugin API documentation. Do not grow the PI WEB README with implementation
detail.

**Exit:** all release gates below pass on the rebased integrated branch and the evidence identifies
the exact commits, commands, fixtures, viewports, and observed results.

## Pull-request and rollout boundaries

Keep delivery reviewable and bisectable:

1. clean upstream rebase plus preserved UI/durable baseline;
2. generic PI WEB session-navigation host, Pi-menu refinement, and hosted telemetry presentation;
3. adapter fixture, reducer, and unified navigation;
4. adapter brief/Context and supported action placement;
5. responsive/accessibility fixes and recorded evidence.

PI WEB commits contain no Workstream semantics and are suitable for later upstream contribution.
Workbench commits contain no copied PI WEB source. Release the PI WEB fork build before or together
with the compatible adapter; an older host receives the explicit fallback rather than a partially
working composition. Rollback selects the prior fork build and adapter commit without migrating or
rewriting Workstream ledgers.

## Assumptions

- The prototype's three-destination hierarchy has owner acceptance; only promotion/linking and
  protocol-extending interactions are withheld.
- The dirty UI foundation is intended to ship after it is split, tested, and rebased; none of its
  uncommitted files is authoritative by itself.
- The durable lifecycle branch is the intended prerequisite baseline. Attended live-service checks
  occur only after any temporary quick-recovery workflow releases lifecycle ownership.
- PI WEB can produce a bounded, complete selected-machine session inventory with stable complete
  locations after the upstream rebase. Phase 1 must prove this before the adapter labels unmatched
  sessions as Chats.
- Current and closed Workstream snapshots are available together for positive association matching.
- The release remains a trusted, privately deployed PI WEB/Workbench installation with current
  supported browsers.

## Risks and mitigations

- **Standalone meaning outruns the contract.** Limit the release to navigating existing unmatched
  PI WEB Chats, keep New Chat guarded, persist no classification, and block on a protocol decision
  before promotion, linking, or creation.
- **Partial inventories misclassify a Workstream session.** Require completeness from both hosts,
  exclude only positive association matches, retain loading/reconnect state, and test duplicate-home
  and late-arriving association cases.
- **The upstream rebase drops or changes behavior.** Rebase in a clean worktree, preserve safety
  refs, resolve by current upstream contracts, rerun focused suites per conflict cluster, and inspect
  the final commit range rather than relying only on a green aggregate test.
- **The UI release regresses durable lifecycle ownership.** Keep native/sessiond modules out of UI
  phases, rerun ownership/status/resolver suites after the rebase, and verify UI restart does not
  replace sessiond.
- **Mounted surfaces leak state across sessions or lose drafts.** Keep one host-owned surface path,
  select complete locations before committing destination state, key memory by full identity, and
  test rapid selection races, reconnect, draft, scroll, ask, Files/Git, and Terminal scope.
- **The adapter monolith becomes untestable.** Extract pure destination/join/brief modules before DOM
  work; keep custom-element rendering thin and test behavior at the smallest layer.
- **The Pi menu or narrow shell strands the user.** Keep a core-owned default-shell escape path,
  test plugin failure and keyboard focus restoration, and never allow the adapter to suppress
  protected controls.
- **Cross-checkout Chat enumeration is slow.** Reuse upstream catalog work, bound concurrency, cancel
  stale scans, publish ordered snapshots, and keep the last complete inventory during reconnect.
- **Presentation work expands into unrelated prototypes.** Treat message tree, subagent cards,
  promotion/linking, rename, notifications, and protocol work as hard deferrals for this release.

## Release exit criteria

The release is ready only when all of the following are true:

- The fork is cleanly rebased onto freshly fetched `upstream/main`, `upstream` is fetch-only, and the
  UI foundation plus durable lifecycle work are present and verified.
- The three destination states, root/workstream navigation, brief, Context, shared surfaces, and
  desktop/narrow handoffs pass automated and browser verification.
- A Workstream row always opens the brief and a session row always opens the correctly anchored Chat.
- Existing Chats are shown only after complete inventory reconciliation; no new Chat can be created,
  promoted, or linked through the Workbench UI.
- No schema, Workstream Store reducer, controller, or typed Workstream operation changed.
- The brief contains only mechanically arranged canonical projection fields and labels missing,
  stale, failed, and unavailable data honestly.
- Pi menu protected controls and default-shell recovery remain reachable in loading, empty, error,
  reconnect, desktop, and narrow states.
- Concise exchange, live asks, durable Human Tasks, drafts, paging, scroll, upstream session tree,
  typed anchor repair, and sessiond continuity show no regression.
- PI WEB `npm run verify`, Workbench Store/integration tests, changesets/docs checks, and recorded
  deterministic browser evidence all pass.
