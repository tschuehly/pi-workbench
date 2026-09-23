# An owned Workbench frontend over PI WEB's protocol

**Status: architecture and daily-use scope selected; delivery plan proposed.** Thomas selected the protocol-only direction, preservation of familiar Chat, and the three surrounding capabilities below. Manual shell work stays in his external terminal app. These are planning decisions, not authorization to implement, delete features, change model policy, install, or restart services.

This revision replaces the draft's proposal to keep importing PI WEB's internal frontend modules. Existing contracts still describe the current implementation; align their ownership wording before implementing this selected direction.

## Selected outcome

Own the frontend in this repository and communicate with PI WEB through its HTTP and WebSocket protocol. Preserve the familiar Chat/composer experience. Port useful code and tests deliberately rather than rebuilding everything or retaining ongoing imports of upstream UI internals.

The daily-use replacement must include:

| Required capability | Scope |
| --- | --- |
| Chat and session selection | Existing/new sessions, composer, transcript, attachments, model/effort controls, steer/stop, queues, questions/dialogs, drafts, paging, and reconnect |
| Workstreams | Find and resume work through checkpoints, Human Tasks, links, and correctly associated sessions |
| Delegation roster | Worker/Subagent identity, goal, status, actual binding, and results awaiting collection; execution remains owned by the harness |
| Files beside Chat | Workspace viewing and editing, with save-safety verification required before cutover |

**Embedded Terminal and Git UI are deferred**, not deleted from the current app or backend. Thomas's external terminal covers manual shell work. Agent shell tools and their output in Chat remain available; this decision does not remove PI WEB's terminal backend or required plugins. An “Open workspace in terminal” action is a separate optional proposal, not a cutover requirement.

The first technical proof can be smaller than this list; the daily-use cutover cannot silently omit a selected capability.

Success means Thomas can do this work, leave, and resume; the frontend builds without PI WEB's frontend source tree; and a subsequent backend revision can be assessed without automatically changing Workbench's UI. A clean-room rewrite, new daemon, generic plugin shell, public frontend SDK, managed Run system, and new UI framework are not goals.

## Ownership and reuse

**PI WEB is the initial backend choice, not the permanent definition of Workbench.** The purpose of owning the frontend is to choose, omit or replace supporting capabilities when actual needs justify it. Terminal can live in an external app now and use a different integration later; that choice should not dictate Chat or Workstream design.

Keep backend-specific transport and validation localized in the owned protocol client. Introduce a replacement where a real need appears, rather than building a generic provider/plugin framework or multiple implementations in advance. Replacement is possible, not necessarily free: changing session backends would still require preserving history, identity and lifecycle semantics.

```text
Workbench-owned frontend and protocol client
                 |
       existing HTTP + WebSocket routes
                 |
PI WEB web/API gateway -> session daemon and backend plugins
                         + Workbench backend/extensions
```

| Owner | Responsibility |
| --- | --- |
| `apps/workbench-web/` (proposed) | Screens, browser state, protocol calls/validation, rendering, client build and tests |
| Existing `apps/pi-web-macos/` | Windows, menus, native bridge, readiness and installation integration |
| Existing Workbench packages/extensions | Workstream Store and coordination, delegation, Worker identity, Working Mode and telemetry |
| Pinned PI WEB backend and required plugins | Sessions, execution, persistence, authentication, files, terminal processes and wire behavior |
| Workbench integration checks | Tested backend revisions, approved agent capabilities, compatibility evidence and rollback |

The browser uses the existing gateway, not the daemon's internal socket. Keep the browser and API same-origin; do not weaken authentication, origin checks, content security policy, or the native bridge's trusted-main-frame restriction to make separation work.

Reuse mature libraries and port useful implementation together with its tests, license and source provenance. Copied code becomes Workbench-maintained code; upstream fixes must be deliberately adopted. Do not load upstream browser plugins as a shortcut that restores automatic UI coupling.

An owned protocol client needs only the operations used by these screens. It is not a second protocol, a replacement server, or a backend-independent framework. Validate incoming data, preserve complete identities and error semantics, and do not import upstream controllers, app state, or source types indirectly through a convenience wrapper. Packaged protocol artifacts could be evaluated later; they are not a prerequisite.

Protocol-only does not mean version-independent. Pin the backend and required plugins, including necessary fork patches. Server-side tools and prompts still require explicit configuration and checking.

## What source inspection establishes

| Area | Evidence and consequence |
| --- | --- |
| Chat | PI WEB's `src/server/sessions/sessionRoutes.ts` exposes creation, history, status, stream snapshots, prompts, queue operations, answers and cancellation. Most needed operations already have routes. |
| Recovery | `src/client/src/controllers/sessionController.ts` combines history, a partial-response snapshot and buffered events using a sequence watermark. Owning the frontend means owning this recovery logic, not merely opening a WebSocket. |
| Delegation | `SessionStatus.extensionStatuses` carries the activity used by `DelegateRoster.ts`. This is disposable runtime status, not durable execution authority; missing status must not mean successful completion. |
| Workstreams | The existing validating client in `packages/pi-web-integration/workstream-client.js` is reusable. Current UI transport uses scoped, revision-aware backend requests; replacing its shell does not require replacing the Store. |
| Files | `workspaceExplorerRoutes.ts` exposes viewing and version-checked writing. The earlier dogfooding checkpoint still had save-security review and installed acceptance unfinished. Required scope is not evidence of readiness. |
| Serving | `buildApp` accepts `clientDist`, but ordinary startup does not expose that choice. Production serving/install integration still needs proof. |

At initial inspection, the canonical PI WEB checkout was at `f17b8aebdbf5c59c4974f653d717f69584eb697a` and the hosting checkout at `bc52ac151a8fe659509410d35079d2bb5f8c11ea`. Neither is selected as the baseline. Checkout HEAD is not proof of running code or served assets. No separate-client build or live protocol acceptance has yet been performed.

Inputs: [requirements](../foundation/requirements.md), [current reuse boundary](../integrations/pi-web/reuse-boundary.md), [UI plan](workbench-ui.md), [session-use evidence](../research/reports/session-interactions-2026-09-20.md), [UI reset evidence](../research/reports/workbench-ui-reset-2026-08-28.md), [native lifecycle instructions](../../apps/pi-web-macos/README.md), and inspected Workstream checkpoints. Historical audits explain needs, not present runtime guarantees.

## Delivery sequence

### 1. Establish the baseline and consumed protocol

**Deliver:** reproducible inputs and a bounded preservation/compatibility checklist.

- Verify running checkout, served build, Pi version, effective configuration and loaded tools/prompts. Separate source, installation and live state.
- Trace the selected workflows into their routes, frames, error responses and state ownership. Check authentication and backend-plugin discovery without the upstream application shell.
- Select an exact tested backend integration revision with its required plugins and fork patches. Record client dependencies separately; no moving branch or accidental sibling checkout is a build input.
- Trace source worth porting and its dependencies. Do not turn preservation of Chat behavior into wholesale copying of the old application state/controller graph.
- Resolve how ad-hoc Chat directories map to registered project/workspace identities required by Files. Do not invent catalog identities or silently register new projects to hide a mismatch.
- Identify existing failures and unfinished Files review. Preserve sessions, Workstream data, Worker records, prototypes and unrelated changes.

**Exit:** owner-confirmed behavior checklist, exact inputs, route evidence, and named gaps. Any material workflow restriction returns to Thomas before implementation depends on it.

### 2. Prove recovery and independent protocol access

**Deliver:** a small owned frontend using an isolated backend, not a daily-use replacement.

- Port only enough Chat and transport code to open an active fixture conversation, display history and partial output, answer a pending interaction, disconnect and recover.
- Preserve the existing ordering between socket subscription, snapshots and buffered events. Test failed joins, reconnect during generation, stale replies after session switches, and daemon-instance changes where relevant. Do not infer an exactly-once guarantee merely from sequence fields.
- Verify drafts, questions and events cannot leak between two windows or sessions. Keep authoritative session state on the server.
- Build without upstream frontend source imports or runtime browser modules. Port validation/types needed by consumed operations; test schema failures at the wire seam.
- Prove production static serving as well as development proxy/assets/WebSockets. Prefer the existing serving seam; propose a small backend integration change if necessary rather than adding a new server by default.

**Exit:** deterministic Chat recovery evidence, isolated build, no live changes. Return for direction if an independent client requires broad backend changes or substantial runtime copying.

### 3. Rehearse an update before completing the UI

**Deliver:** evidence that the selected separation is maintainable.

- Fetch upstream and the fork into an isolated checkout. Keep mirror `main` clean, retain required patches on a fork branch, and never trial an upgrade in the running checkout.
- Select one real candidate revision. Compare consumed wire types, snapshot/event behavior, authentication, plugin transport/revisions, Pi SDK, defaults, tool/prompt contributions and persisted formats.
- Run the same owned client and fixtures against the baseline and candidate. Keep UI code unchanged initially so backend compatibility is observable.
- Adopt, adapt or reject the candidate with explicit evidence. A material protocol gap returns to Thomas; do not silently retreat to importing the upstream UI.

**Exit:** one real update decision before investing in all screens. Re-run the expanded checks after later features are added. An early Chat-only pass does not establish Files or Workstream compatibility.

### 4. Complete the selected daily-use workflows

**Deliver:** four usable capabilities in small, separately verified slices.

1. Finish familiar Chat, composer and session navigation without redesigning them. Preserve validated rendering, attachment handling, paging, scroll and focus behavior, controls, asks and extension dialogs.
2. Port Workstream surfaces onto the existing typed operations and session coordinator. Retain revisions, idempotency, unknown-outcome reconciliation and session-location repair; do not reconstruct Store state in the browser.
3. Port the delegation roster over extension activity. Keep Worker/Subagent lifecycle rules in the existing harness; this selection does not authorize new graphical execution controls.
4. Complete Files with workspace confinement, dirty-edit protection, stale-save rejection and bounded I/O. Obtain independent security review and installed acceptance; Files can no longer be dropped from cutover without owner agreement.
**Also required before cutover: deliberate agent capabilities.** Trial `subsessions: false` in isolation, verifying that the five tracked-subsession tools and their guidance disappear while Workbench delegation remains usable. Decide standalone `spawn_session` separately. Test actual lead/Worker/leaf exposure, supported nesting, cancellation, collection, compaction/wakeup coordination and interrupted Worker receipts. Snapshot approved tool schemas and relevant prompt contributions for update review; these checks are not a new permissions sandbox.

**Exit:** the complete preservation matrix passes. Thomas approves any intentional capability loss; required workflows are not substituted with placeholders.

### 5. Accept and switch the installed app

**Deliver:** the owned frontend in daily use with a rehearsed rollback.

- Run the expanded protocol checks against the selected backend. Independently review changed authentication, Files, lifecycle and capability-sensitive paths.
- Verify native readiness and installation against separate frontend/backend identities. Preserve native notifications, trusted controls and accepted narrow-layout behavior.
- Replace UI/app artifacts without restarting the session daemon wherever supported. If a daemon restart is unavoidable, request explicit authorization and warn that turns, children, asks and terminals may be interrupted. Planning approval is not restart permission. Restart web/API before sessiond if both require it.
- Retain the prior client, backend revision, configuration and compatible state backup. UI rollback must not overwrite session or Workstream data. Check persisted-format compatibility before a backend downgrade; otherwise stop rather than downgrade blindly.
- Keep the current working app available until Thomas accepts the replacement in normal work. Rehearse rollback using isolated state, not the live session store.

**Exit:** installed inputs match tested inputs; every selected workflow works; rollback and remaining limitations are explicit.

### 6. Simplify and maintain deliberately

**Deliver:** fewer competing surfaces and instructions, without losing selected workflows.

- Retire old shell code only after caller tracing and acceptance of the replacement. Preserve backend services, typed clients, coordination and useful fixtures; do not delete `packages/pi-web-integration` wholesale.
- Retire Workstream Atlas only after confirming no unique history/review workflow is lost.
- Keep model bindings in the routing policy, remove stale duplicated model names, and preserve concise role/independence guidance. Do not turn migration into a new model-evaluation program.
- Inspect actual skill catalogs in terminal and RPC. Prefer existing resource-selection mechanisms; obtain approval before removing a used capability. Keep Working Mode behavior and opt-in input auditing unchanged unless separately selected.
- Reconcile README, PRODUCT, foundations, relevant contracts, UI/reuse plans and installation instructions with verified behavior. Do not promote previews or future managed-Run concepts to shipped scope.

For each chosen backend update, repeat phase 3 with the full consumed protocol and agent-input checks, then use phase 5's cutover rules. For owned frontend code, selectively port worthwhile upstream fixes with regression tests and attribution. Prioritize security fixes; a pin is not permission to leave known vulnerabilities unexamined. No automatic upgrade service or generalized compatibility framework is needed.

**Exit:** each removal has evidence and rollback, or is explicitly deferred. Measure reduced maintenance and competing concepts, not arbitrary deleted-line targets.

## Preservation and verification

| Area | Required evidence |
| --- | --- |
| Identity and creation | Complete machine/project/workspace/session identity; uncertain creation does not create duplicates |
| Chat recovery | History and in-flight content reconcile; pending questions/dialogs survive reconnect; stale selection work cannot update another Chat |
| Familiar interaction | Drafts, attachments, editing, model/effort, queues, steer/stop, paging, scroll, message actions, thinking/tool presentation |
| Workstreams | Confirmed checkpoints, Human Tasks, links, revision-safe mutations, correct association and repair |
| Delegation | Activity reflects actual bindings/status; absence is not invented completion; cancellation, collection and nesting remain correct |
| Files | Path confinement, version conflicts, dirty edits, bounded reads/writes, untrusted-content handling and independent review |
| Browser/native lifecycle | Window isolation, keyboard/focus, narrow views, reduced motion, trusted origins, notifications, reload without daemon restart |
| Ownership | Build has no upstream frontend-source dependency; backend changes are checked through consumed routes/events, not UI imports |

Use existing Workbench tests, relevant PI WEB route/recovery/plugin tests, and `packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs`. Adapt its isolated runner for the separately built client; port the relevant behavior tests rather than importing the old controllers just to make tests pass. Native checks are listed in `apps/pi-web-macos/README.md`.

Ordinary checks use deterministic no-model fixtures; record exact commands, results and known baseline failures. Use a bounded live-model smoke for tool selection/delegation that fixtures cannot establish, not a broad model benchmark. Delegate visual inspection and keep source evidence distinct from installed owner acceptance.

Every isolated instance needs its own HOME/state, data directory, daemon socket or port, web port, and owned-process cleanup. Do not inherit the live instance's endpoints. Keep persistent evidence and workspace references outside temporary directories.

## Approval and review status

The architecture, familiar Chat, and required surrounding capabilities are selected. Implementation, deployment and feature removal are not authorized. Resolve material protocol gaps and workflow restrictions with Thomas; keep routine implementation details agent-owned once a bounded slice is accepted. Commit coherent verified units and serialize writers sharing a checkout.

Previous independent-review attempts failed preflight with `ROUTING=BLOCKED`: Claude quota exhausted. This materially revised plan has not received independent review. Author checks cover documentation consistency, links and whitespace only; they do not establish architecture feasibility or runtime correctness.
