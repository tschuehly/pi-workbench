# Unified PI WEB shell prototype-fidelity release plan

Status: proposed governing remediation plan. The superseded UI-only plan is frozen as historical
baseline evidence; no further release mutation is approved until the owner approves this plan.

## Why this plan exists

The production implementation used the correct canonical prototype,
[`pi-web-unified-chat-workstream-prototype.html`](../research/reports/pi-web-unified-chat-workstream-prototype.html),
but the previous production plan narrowed and reinterpreted it. The result implements useful
navigation and Workstream mechanics, yet it does not realize the prototype as one coherent PI WEB
shell.

The most visible divergence is structural. Production opens Workstreams as a separate dedicated
primary view, presents an all-items landing page with a large heading and two long columns, and
recreates shell mechanics inside the Workbench adapter. The prototype keeps one compact global
shell, one persistent hierarchy, and one selected middle destination. It never uses a portfolio
landing page as a normal destination.

The previous release evidence also stopped before controlled native-session browser acceptance. It
proved several synthetic Workstream states but did not prove live asks, successful anchored session
selection, host-owned Chat/Files/Git/Terminal switching, state retention, promotion/linking,
message history, child-execution inspection, or operational installation. A clean repository and
green unit tests therefore did not establish a releasable installed product.

This plan supersedes the release-completion claim in
[`pi-web-unified-ui-production.md`](pi-web-unified-ui-production.md). Its commits remain the starting
baseline; its incomplete acceptance record remains evidence, not proof of completion.

## Outcome

Ship the accepted prototype as the default **Workbench shell profile** in PI WEB:

- one PI WEB-owned global toolbar with protected controls;
- one compact, persistent Chats and Workstreams hierarchy;
- one selected middle destination: standalone Chat, Workstream brief, or Workstream session;
- host-owned Chat, Files, Git, and Terminal surfaces, plus Workbench-owned Context where applicable;
- mutually exclusive expanded vertical and collapsed horizontal navigation;
- a focused narrow overlay instead of compressed side-by-side panes;
- prototype-faithful density, hierarchy, attention markers, menus, and responsive behavior;
- truthful standalone Chat creation, promotion, linking, Workstream rename, message history, and
  bounded child-execution inspection after their required protocol and host seams are approved;
- deterministic browser evidence for every supported state and an installed-app smoke that starts
  the same verified composition.

The default PI WEB composition remains a recoverable profile. The Workbench profile cannot hide
settings, authentication, connectivity, recovery, command actions, Projects/checkouts, or the
profile-reset path.

Full release acceptance requires both shell fidelity and interaction fidelity. An intermediate
shell-fidelity build may be used for attended evaluation, but it must remain labelled pre-release
until every required interaction and operational gate in this plan passes.

## Fidelity contract

The canonical HTML prototype is the interaction and visual reference. Production need not copy its
fixture data or implementation, but it must preserve these observable relationships:

1. The global toolbar, left hierarchy, middle destination, optional right surface, and Terminal dock
   read as one system.
2. The owner always sees a selected destination after reconciliation; an all-items landing page is
   not a steady state.
3. Selecting a Workstream opens its brief. Selecting a session opens its Chat only after its complete
   location is selected successfully.
4. Expanded vertical and collapsed horizontal navigation never appear together.
5. Standalone Chats and Workstream sessions use the same host-owned conversation composition.
6. Live `ask_user` decisions remain inline in Chat. Durable Human Tasks remain in Workstream brief
   and Context.
7. Files, Git, Terminal, drafts, paging, scroll, asks, and model/status state remain scoped to the
   selected complete session identity.
8. Shell actions have one PI WEB-owned menu. Workstream, session, and standalone-Chat actions use
   separate contextual menus.
9. Real data remains scannable. Long prompts never become unbounded navigation labels, Chats cannot
   push Workstreams out of reach, and attention outranks passive history.
10. Loading, reconnect, partial inventory, typed selection failure, and plugin failure preserve
    protected shell controls and the last truthful destination.
11. Workstream creation remains reachable from the Workstreams section or an equally explicit
    Workbench action; prototype omission cannot remove this contract-required V1 control.
12. Selected-session context usage shows used tokens, capacity, percentage, and a high-usage warning
    beside the composer without creating a second status bar.

Create and maintain a conformance matrix beside the acceptance record. Every prototype interaction
must be classified as **implemented**, **blocked by pending authority**, or **rejected by an explicit
owner decision**. “Deferred” without an owner decision is not a release disposition.

## Ownership and module seams

### PI WEB core

PI WEB owns reusable shell capability and protected behavior:

- shell profiles and profile recovery;
- global toolbar and Pi menu;
- fixed composition regions and responsive mechanics;
- expanded, collapsed, and narrow navigation behavior;
- resize bounds, focus restoration, inertness, scrims, zoom, coarse-pointer, and reduced-motion
  behavior;
- host-owned Chat, Files, Git, and Terminal composition;
- generic session navigation, selection, attention, status, preferences, and lifecycle;
- isolation of plugin failures.

Implement the already planned Shell Profile seam from
[`customization-plan.md`](../integrations/pi-web/customization-plan.md), rather than exposing arbitrary
DOM or making the adapter a page builder. Internally, PI WEB may deepen this through one composed-shell
module with fixed regions. Its interface must use qualified contributions and generic descriptors,
not Workstream vocabulary, selectors, broad `AppState`, private Lit elements, or arbitrary markup.
The default and Workbench profiles provide the two real adapters that justify the seam.

### Pi Workbench adapter

`packages/pi-web-integration/` owns Workbench meaning:

- joining complete native-session inventory with canonical Workstream associations;
- standalone-Chat versus Workstream-session presentation;
- destination reduction and selection-before-commit behavior;
- Workstream/session navigation content and attention badges;
- mechanical Workstream brief and Context projections;
- typed Workstream actions, receipts, reconnect state, and anchor repair;
- Workbench profile contribution and canonical paired fixture.

The adapter must stop owning global toolbar geometry, protected-control gutters, responsive shell
media queries, focus traps, scrims, and generic resizers. Split the current monolith into deep modules
whose interfaces are also their test surfaces; do not add another wrapper around the 3,000-line
custom element.

### Workstream Store and contracts

The Store remains authoritative for Workstream association, checkpoints, Human Tasks, links,
revision, closure, and repair. Prototype interactions that change domain meaning begin with an
approved contract and decision change. UI code cannot invent promotion, linking, rename, or
standalone ownership semantics.

## Delivery sequence

### Phase 0 — Reset release truth and lock conformance

1. Retain the previous production plan as the frozen historical baseline and state that no approved
   release plan governs further mutation until the owner approves this proposal.
2. Reconcile `AGENTS.md`, `docs/README.md`, the implemented Workbench UI plan, the message-tree plan,
   and the continuation-extension plan so each routes future shell work here without pretending this
   proposal is already approved.
3. Fetch both `upstream` and `origin` in PI WEB. Keep `upstream` fetch-only, develop only on the fork's
   `pi-workbench` branch or a review branch derived from it, and publish only to `origin`.
4. Record exact starting commits for both repositories and create safety refs before implementation.
5. Build the prototype conformance matrix, including desktop and narrow screenshots for every
   prototype destination and interaction.
6. Classify each row by owning module, required authority, implementation status, and direct evidence.
7. Record the current live failures: separate Conversation/Workstreams entry, centered root landing,
   real-data list overflow, broken or absent controlled native-session evidence, and installation
   dependence on a mutable symlink.
8. Obtain owner approval for the remediation direction and intent to design protocol expansion. The
   exact contract amendment receives a separate Principal Judgment in Phase 6 before semantic code.
9. Confirm the approval/prerequisite state of the message-tree, child-execution, and Workstream
   continuation plans; full release cannot silently defer a prototype row or strand a selected
   continuation control during shell migration.

**Exit:** the matrix has no unclassified prototype behavior, cross-document routing is coherent,
repository remotes and branches satisfy policy, the old release is visibly not ready, and the owner
has approved this plan's direction. Standalone-Chat protocol mutation remains blocked until the
Phase 6 amendment text is separately approved; continuation keeps its own approval and contract path.

### Phase 1 — Build the no-model acceptance harness first

Create the missing red-capable browser loop before changing the shell.

PI WEB owns a deterministic, test-only native-session fixture behind existing runtime and dependency
seams. It must use production routes, controllers, selection logic, mounted surfaces, and browser
code while substituting only bounded external/runtime dependencies. Do not add a production fixture
endpoint or read real user sessions.

The fixture supplies:

- at least five opaque native session identities on distinct complete anchors, including two with
  live conversation fixtures;
- deterministic transcript paging, drafts, scroll positions, context usage, and one live ask;
- isolated Files and Git state;
- deterministic Terminal processes and output;
- reconnect, partial inventory, unavailable location, missing anchor, and successful repair states;
- fixed clocks and stable display identities.

Only the paired Workbench fixture classifies those opaque identities as standalone or associated;
PI WEB fixture code contains no Workstream vocabulary. The Workbench repository owns
`packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs`, one command that starts the
isolated stack, drives the actual UI, cleans up, and returns pass/fail without model calls.

**Exit:** the harness reproduces the current composition mismatch and can exercise every native
session/surface blocker listed in `unified-ui-acceptance-evidence.md` in seconds.

### Phase 2 — Implement the PI WEB shell-profile seam

Implement the planned Shell Profile module and keep it deliberately small:

- default primary view;
- ordered qualified navigation and surface contributions;
- initial bounded panel visibility and sizes;
- presentation-profile recommendation;
- profile title, description, and provenance;
- fixed context-bar, status, surface-strip, and contextual-action contribution locations using
  generic descriptors, qualification, ordering, overflow, and error isolation;
- explicit select, preview, reset, persistence, and missing-plugin fallback.

PI WEB renders the fixed regions and protected controls. It also owns generic toolbar geometry,
surface-strip mechanics, action overflow, and contextual menu behavior; the adapter contributes
labels, state, and typed callbacks through fixed descriptors. A profile chooses registered
contributions; it cannot inject shell markup or suppress recovery. Make activation transactional so
invalid or throwing contributions return to the last valid profile.

Prove the seam with the existing default composition, a generic fixture composition, and the
Workbench composition. Add plugin declarations, documentation, compatibility tests, and a PI WEB
changeset.

**Exit:** the Workbench profile can be selected as the default composition, the default PI WEB
profile remains one action away, and no Workstream term appears in PI WEB core or public types.

### Phase 3 — Replace the landing page with one persistent Workbench composition

Refactor the adapter around one retained shell source. Remove the root portfolio destination and the
separate render trees for root, Chat, and Workstream shells.

The retained composition behaves as follows:

- native Chat: root Chats/Workstreams hierarchy plus host-owned Chat;
- Workstream: selected Workstream hierarchy plus middle-pane brief;
- Workstream session: the same hierarchy plus Chat/Context/Files/Git and Terminal;
- collapsed: horizontal destinations only;
- narrow: PI WEB-owned focused navigation overlay.

After inventory reconciliation, restore the last valid selected destination. If none exists, use
this stable order: the already selected core native session when classified and complete; the first
attention-bearing visible destination; the first visible Chat; the first open Workstream brief; then
the first closed Workstream brief. Auto-selection may select an existing host session for display,
but it never starts, resumes, attaches, mutates, or appends Workstream state. At cold start, a failed
host selection renders a recoverable selection-failure destination inside the persistent shell; it
does not fall back to the removed landing page or guess another session. After a destination exists,
a later selection failure keeps that prior middle destination visible. Use an in-shell empty state
only when both inventories are complete and empty.

Keep **New Workstream** in the Workstreams section header or an equally explicit Workbench action.
Creating it continues to use the existing typed V1 control; removing the landing page cannot remove
Workstream creation.

Extract at least shell-source, Workstream actions, brief/Context view, and installation-independent
service modules. Preserve the existing pure reducer and projection modules. Remove adapter CSS and
logic now owned by PI WEB.

**Exit:** there is one shell, one navigator, one toolbar, and one middle destination. No steady-state
screen resembles the current large `Chats + Workstreams` landing page.

### Phase 4 — Restore prototype visual hierarchy and real-data scale

Run a side-by-side fidelity pass against the canonical prototype in GitHub Dark and Light themes.
Use PI WEB semantic presentation tokens; do not paste the prototype stylesheet into production.

Required corrections include:

- the prototype's 52-pixel desktop toolbar and two-row 96-pixel narrow toolbar unless the owner
  explicitly accepts a documented divergence;
- the prototype's 300-pixel default hierarchy with keyboard/pointer bounds from 220 to 520 pixels;
- selected, attention, running-child, stale, failed, and closed states that do not rely on color;
- bounded Chat and session rows with concise PI WEB-owned titles, ellipsis, and inspectable full text;
- independently reachable Chats and Workstreams at hundreds of native sessions;
- no raw multi-paragraph prompt used as a navigation label;
- content-first brief and session surfaces without oversized marketing headings or decorative space;
- one contextual action area and one Terminal dock;
- long-title, many-session, empty, loading, reconnect, and partial-inventory fixtures.

Add semantic browser assertions and accepted screenshot baselines. Pixel comparison protects the
accepted production baseline after owner judgment; it supplements interaction assertions rather
than replacing them.

Treat 900/901 pixels as the canonical responsive handoff from the prototype. Also test 760, 390,
and 320 pixels as stress widths; changing the handoff requires an explicit owner-approved
conformance-matrix divergence.

**Exit:** an owner-reviewed comparison board shows the same hierarchy, density, placement, toolbar
handoff, and attention order as the prototype at desktop, tiled, 901, 900, 760, 390, and 320 pixels.

### Phase 5 — Complete currently authorized destination behavior

Close all gaps that fit existing authority:

- Workstream row → full mechanical brief;
- session row → select complete location → host Chat;
- Chat/Context/Files/Git switching;
- checkout-labelled Terminal dock;
- live ask versus durable Human Task separation;
- checkpoint propose/correct/confirm/failure retention;
- explicit anchor selection for new Workstream sessions;
- typed anchor repair;
- reconnect and rapid-selection races;
- per-session draft, paging, scroll, surface, status, and Terminal retention;
- **Continue in new session** in per-session checkpoint actions after the approved continuation plan
  supplies its typed operation and shared coordination module;
- context-window used tokens, capacity, percentage, compact meter, and high-usage warning beside the
  composer in both hosted and default-compatible presentations.

The brief remains a mechanical projection; do not generate a combined narrative. Fix failures at
the owning module seam rather than adding adapter retries or DOM inspection.

**Exit:** every currently authorized prototype row in the conformance matrix has automated and
browser Primary Evidence.

### Phase 6 — Approve and implement prototype-required protocol expansion

Phase 0 approves only the intent to design this expansion. Before this phase, complete the approved
continuation plan's separately reviewed host probes and contract/shared-module extraction that
creates `packages/workstream-session-coordination/`. Those prerequisite commits retain their owning
plan and must not be folded into this phase.

Then present the exact standalone decision, Workstream contract, schema, Store-interface, and PI
WEB-interface amendments for a separate owner Principal Judgment. Coordinate overlapping contract
text with the continuation amendment rather than replacing it. The standalone amendment must settle
these Material Questions:

1. A standalone Chat is PI WEB-native state, not automatically a Workstream or managed Run.
2. Starting a standalone Chat requires an explicit complete location but no Workstream association.
3. Promotion preserves the native conversation identity and creates exactly one Workstream home
   through an idempotent, recoverable handshake.
4. Linking keeps the Chat standalone and records a typed reference without implying ownership.
5. Workstream rename is an append-only, revision-checked mutation.
6. Partial failure, retry, reconnect, duplicate promotion, unlinking, closure, and rollback have
   explicit projections and receipts.

Do not overload ordinary `link.upsert` or compose several existing mutations unless the amended
contract proves the resulting operation atomic, idempotent, and recoverable. Extend the shared
`packages/workstream-session-coordination/` module specified by the continuation and message-tree
plans; do not build a second coordinator.

Then implement:

- explicit **New Chat** with complete anchor selection;
- **Promote into a Workstream** while preserving transcript and session identity;
- **Link to Workstream** while retaining standalone ownership;
- Workstream rename;
- their menus, confirmations, receipts, failure states, and deterministic tests.

**Exit:** all four interactions survive response loss, retry, web restart, and sessiond continuity,
and their canonical projections match the approved contract.

### Phase 7 — Integrate message history and bounded child execution

Use the existing plans rather than inventing competing semantics:

- Amend [`pi-web-message-tree.md`](pi-web-message-tree.md) so it explicitly owns the prototype's
  Double-Escape entry in addition to its History button, continue-from-entry, fork correlation, and
  Workstream coordination. Today it owns the tree but not that shortcut.
- [`pi-web-subagent-conversation-cards.md`](pi-web-subagent-conversation-cards.md) owns structured
  bounded child-execution presentation.

Obtain any still-missing approval for these plans, land or complete their prerequisites, then
integrate their accepted surfaces into the Workbench profile. Also preserve the continuation plan's
**Continue in new session** control in the selected session's checkpoint actions; it is a dependent
contract interaction rather than a prototype conformance row. Child executions remain subordinate
evidence under the parent session, never peer Workstream sessions. History remains an overlay/route
from Chat, not permanent global navigation. If the owner rejects either interaction, record that
explicit rejection in the conformance matrix; an unstarted plan is not a release deferral.

**Exit:** the prototype’s history and child-inspection scenarios pass without changing Workstream
home semantics or duplicating session navigation.

### Phase 8 — Harden responsive, accessible, and failure behavior

Exercise the complete composition with pointer, keyboard, screen reader semantics, coarse pointer,
reduced motion, 200% native zoom, long content, many sessions, reconnect, plugin failure, and profile
fallback.

Verify landmark and heading order, visible focus, focus restoration, Escape behavior, inert
backgrounds, announcements, non-color status, 44-pixel coarse targets, bounded overflow, and one
focused pane at narrow widths. Automated emulation covers coarse pointer, reduced motion, and zoom;
an attended macOS app pass records physical coarse-pointer geometry where available and native 200%
zoom because a headless still image cannot prove either condition. Test profile activation and
contribution failures independently so a Workbench failure cannot strand shell recovery.

**Exit:** no protected control, destination, action, or recovery path is hidden or unreachable in
any required state.

### Phase 9 — Make installation and upgrade part of acceptance

Replace the mutable, manually maintained plugin link as the release contract. Use PI WEB’s supported
package/plugin discovery or an atomic Workbench installer that records and validates immutable
checkout/package provenance. The installed app must verify that its configured PI WEB checkout,
CLI, LaunchAgents, Workbench plugin, and selected profile agree before reporting ready.

Add `status`/`doctor` coverage for broken plugin links, missing profile contributions, stale
checkouts, duplicate process trees, and version skew. Replace the symlink instructions in
`packages/pi-web-integration/README.md` in the same phase. Installation, update, disable, rollback,
and uninstall must preserve Pi sessions and `~/.pi-workbench/workstreams`. UI restart must leave the
session-daemon PID and in-flight session state unchanged.

**Exit:** a fresh isolated installation opens the Workbench profile without manual linking; an
upgrade and rollback both remain operable; `doctor` reports healthy ownership and no conflicts.

### Phase 10 — Full release acceptance

Run focused checks after each phase and complete checks before release:

```sh
# PI WEB
npm run typecheck
npm run lint
npm run build:plugin-api
npm run verify
npm run build

# Pi Workbench
npm run test:workstream-store
npm run test:pi-web-integration
npm test

# Both repositories
git diff --check
```

Run PI WEB changeset and documentation checks for every generic user-visible core change, not only
the shell-profile commit.

The browser harness must select every Chat, Workstream, session, surface, menu, history state, and
child execution; exercise every mutation and failure; switch anchors; preserve drafts/scroll/Terminal;
and cover every required viewport and input mode. Record exact commands, commits, fixture versions,
screenshots, interaction results, and visual diffs without credentials, real session identifiers,
or machine-local user data.

Obtain two independent final judgments:

1. prototype fidelity and reader-visible truth;
2. architecture, protocol, lifecycle, and regression safety.

Resolve every blocker/high finding. Present the comparison board and residual risks for owner
Acceptance. Only then change this plan and the status header in
`packages/pi-web-integration/unified-ui-acceptance-evidence.md` from blocked to released.

**Exit:** every conformance row is implemented or explicitly rejected by owner decision, all checks
pass, the installed app opens the verified Workbench profile, both repositories are clean, and the
owner can compare the realized shell directly with the canonical prototype.

## Commit and review boundaries

Keep every phase reviewable and bisectable. PI WEB and Workbench changes use separate commits and
changesets where repository ownership differs. A phase is complete only after focused tests,
`git diff --check`, coherent diff review, independent review, plan-status update, and clean commit.
Do not combine shell-profile infrastructure, adapter migration, protocol changes, and lifecycle
installation in one commit or pull request.

Recommended pull-request sequence:

1. Workbench-owned cross-repository acceptance runner plus PI WEB's test-only native-session fixture;
2. generic PI WEB shell profiles and composed-shell implementation;
3. Workbench persistent composition and visual fidelity;
4. currently authorized destination behavior and complete evidence;
5. approved standalone/promotion/link/rename protocol and implementation;
6. message-history and child-execution integration;
7. responsive/accessibility hardening;
8. installation, lifecycle, and final evidence.

## Rollback

- Keep the default PI WEB profile immutable and always available.
- Retain the current dedicated Workstreams view as an older-host fallback for one compatibility
  release, but never present it as the prototype-faithful result.
- Version browser-local profile and presentation preferences; older builds ignore them safely.
- Make new Store records append-only and backward-readable before any protocol release.
- Rollback changes presentation/profile selection first; it never rewrites Workstream ledgers or
  deletes sessions.
- Disable a failing Workbench contribution and return to the default profile without restarting
  sessiond.
- Preserve pre-phase safety refs until installed-app acceptance and rollback drills pass.

## Principal risks

- **Shell profiles become arbitrary replacement hooks.** Restrict the interface to fixed regions,
  qualified contributions, bounded defaults, and protected recovery.
- **Workbench semantics leak into PI WEB.** Require generic fixture/profile tests and scan PI WEB
  core/public declarations for Workstream vocabulary.
- **The adapter remains a shallow monolith.** Replace shell implementation with deep modules whose
  interfaces carry state and typed actions, and delete superseded CSS/logic.
- **Visual tests bless the wrong design.** Require owner judgment on side-by-side prototype evidence
  before accepting production baselines.
- **Real data destroys prototype density.** Test hundreds of Chats, long prompts, many Workstreams,
  mixed attention, and independent scrolling before visual acceptance.
- **Promotion creates split ownership.** Specify and test idempotent coordination, response loss,
  duplicate operations, and reconciliation before exposing the control.
- **Fixtures diverge from production.** Substitute only runtime dependencies and drive production
  routes, controllers, selection, surface, and browser code.
- **Upgrade ordering strands users.** Keep new hosts additive, preserve fallback and default profile,
  and test old/new PI WEB and adapter combinations.
- **Operational state is mistaken for repository state.** Make installed plugin/profile/lifecycle
  health a release gate, not a manual afterthought.

## Release exit criteria

The release is ready only when:

- the Workbench profile opens by default as one coherent shell and the default profile remains
  recoverable;
- production matches the canonical prototype’s hierarchy, density, placement, attention order,
  menus, and responsive handoffs under owner-reviewed side-by-side evidence;
- no centered root landing, duplicate Conversation/Workstreams composition, duplicate navigation,
  or duplicate shell control remains;
- every prototype interaction has implementation evidence or an explicit owner rejection;
- standalone creation, promotion, linking, and rename follow approved typed contracts;
- message history and child execution follow their existing authoritative plans;
- native Chat, brief, session, Context, Files, Git, Terminal, asks, Human Tasks, checkpoints,
  anchors, reconnect, and state retention pass the isolated browser harness;
- desktop, tiled, 901, 900, 760, 390, 320, native 200% zoom, physical or explicitly unavailable
  coarse-pointer evidence, reduced motion, keyboard, and assistive semantics pass;
- installation, start, UI restart, update, disable, rollback, and doctor drills pass without losing
  sessions or Workstream data;
- PI WEB and Workbench complete suites pass, independent final reviews have no blocker/high finding,
  repositories are clean, and the owner grants Acceptance.
