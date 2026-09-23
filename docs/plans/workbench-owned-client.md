# A minimal Workbench client with controlled PI WEB updates

**Status: proposed for Thomas's review.** This plan authorizes no implementation, deletion, model-policy change, installation, or service restart. It develops the owner's requested direction; it does not supersede existing contracts until accepted.

## Outcome

Own Workbench's UI and agent capability choices in this repository. Reuse useful PI WEB runtime and UI modules at an explicitly selected revision, without automatically adopting its product hierarchy or new agent tools.

Success means Thomas can do his existing daily work, leave, and resume; Workbench changes no longer require editing its application root inside PI WEB; and one subsequent PI WEB update can be evaluated, adopted, or rejected without redesigning the harness.

This is an extraction followed by selective simplification, not a clean-room rewrite. A separate repository, replacement session daemon, public component framework, and managed Run system are out of scope.

## Evidence and starting point

- The PI WEB fork already mounts `WorkbenchApp` rather than `PiWebApp`. Its root imports internal session/auth controllers, transport, routing, themes, Chat, composer, and Workbench-specific screens. Moving one file will not remove those dependencies.
- `buildApp` in PI WEB's `src/server/app.ts` accepts `clientDist`; ordinary startup in `src/server/index.ts` does not expose that choice. Separate client serving is a candidate seam, not a proven installable configuration.
- PI WEB's Vite configuration also owns proxying, assets, and a workaround that prevents its development reload transport from blocking application WebSockets. These behaviors need explicit disposition during extraction.
- PI WEB tracked subsessions and Workbench Subagents/Workers have separate launch, completion, ownership, and result paths. `subsessions: false` is an existing PI WEB control; it does not disable standalone `spawn_session`. The reported hierarchy regression has not been reproduced.
- At planning time, the canonical PI WEB checkout is at `f17b8aebdbf5c59c4974f653d717f69584eb697a`; the hosting checkout is at `bc52ac151a8fe659509410d35079d2bb5f8c11ea`. Checkout HEAD is not proof of the running daemon or served assets. Neither SHA is selected as the new baseline by this plan.
- The UI dogfooding Workstream records the Files save-security review and installed-app acceptance as unfinished. Source completion is not deployment or owner acceptance.
- Some introductions still describe graphical features as unimplemented, while the [UI plan](workbench-ui.md) records shipped behavior. Preserve verified behavior, not stale scope statements.

Inputs: [requirements](../foundation/requirements.md), [reuse boundary](../integrations/pi-web/reuse-boundary.md), [session-use evidence](../research/reports/session-interactions-2026-09-20.md), [UI reset evidence](../research/reports/workbench-ui-reset-2026-08-28.md), [native lifecycle instructions](../../apps/pi-web-macos/README.md), and the inspected Workstream checkpoints. Historical audits explain a need; they are not current runtime verification.

## Proposed ownership

| Owner | Responsibility |
| --- | --- |
| `apps/workbench-web/` (new) | HTML/TypeScript entry, Workbench composition, owned screens, client build, focused UI tests |
| Existing `apps/pi-web-macos/` | Native windows, menus, trusted native bridge, readiness, installation integration |
| Existing Workbench packages/extensions | Workstream state and coordination, delegation, Worker identity, Working Mode, telemetry |
| Pinned PI WEB source/build | Session daemon, server, authentication, session persistence, transport, validated clients, selected reusable UI modules |
| Workbench integration configuration/tests | Exact upstream/fork revision, approved capabilities, compatibility checks, controlled adoption |

Keep server and browser same-origin from the user's perspective. Do not solve extraction by weakening authentication, origin checks, content security policy, or the native bridge's trusted-main-frame restriction.

Reuse current internal modules initially, with a small explicit import surface. This remains version-coupled reuse, not a claim that PI WEB exports a stable frontend SDK. Preserve licenses and attribution for moved or copied source.

## Sequence

### 1. Establish a trustworthy baseline

**Deliver:** an agreed preservation list and reproducible build inputs, before moving code.

- Inspect running checkout/build identity, loaded Pi version, effective configuration, and agent-visible tools and prompt contributions. Separate disk, installed, and running state.
- Trace Workbench-owned files and their transitive imports. Identify shared modules, server patches still required, and legacy shell code reachable from the current entry.
- Select an exact tested PI WEB integration commit, retaining its upstream base and required fork patches. Record exact dependency inputs through the existing package/lockfile machinery; a moving branch or arbitrary sibling checkout is not a pin.
- Keep unresolved Files work separate: either baseline the accepted deployed capability or finish its existing review/acceptance first. Do not silently ship that work through this migration.
- Preserve local prototypes, pending changes, sessions, Workstream data, and Worker records. Record existing test failures separately from migration regressions.

**Exit evidence:** Thomas accepts the preservation list; a clean isolated build identifies its inputs; relevant existing checks have recorded results. No live service changes.

### 2. Prove the client can live here

**Deliver:** one complete existing Chat path built from `apps/workbench-web/` against the pinned PI WEB revision.

- Move the Workbench entry/composition and necessary owned screens with minimal behavior changes. Keep shared Chat, composer, and runtime modules upstream where practical. Do not redesign the UI or prune features in the same change.
- Prove deterministic dependency resolution across the two source trees, including one compatible Lit runtime, styles, assets, dynamic imports, and shared types. Refuse a mismatched dependency checkout rather than silently using it.
- Prefer the existing static-client serving seam. If it cannot support production startup, propose the smallest explicit integration change. Do not add another server or duplicate the protocol by default.
- Carry forward only necessary Vite proxy, asset, and WebSocket behavior. Verify development and production separately rather than assuming a successful dev page proves packaging.
- Update the existing acceptance runner to accept the separately built Workbench client. Reuse its isolated runtime fixtures.

**Exit evidence:** clean build; existing/new session selection, Chat, composer, asks/dialogs, reconnect, and two-window isolation work through the real routes. The live app remains unchanged.

**Stop condition:** if reuse requires copying a substantial runtime or building a broad component framework, return with the concrete dependency and two bounded alternatives before continuing.

### 3. Make agent capabilities deliberate

**Deliver:** an explicit Workbench launch configuration and regression check for what the agent receives.

- Trial `subsessions: false` in the isolated runtime. Verify the five tracked-subsession tools and their guidance are absent, while Workbench Subagent/Worker tools remain usable. Decide standalone `spawn_session` separately; do not change it by implication.
- Inspect lead, Worker, and leaf tool sets in their actual launch paths. Test Workbench's foreground-only nested leaf rule, unsupported nesting rejection, cancellation, result collection, and completion wakeups. Do not assume the host's tools propagate into RPC children.
- Check the compaction/wakeup barrier and interrupted Worker receipt behavior. Keep these safeguards while reducing duplicate instructions.
- Capture approved tool names/schemas and host/extension prompt contributions in bounded deterministic fixtures. An upstream addition or change must produce a reviewable diff, not silently become Workbench policy. This is an update gate, not a new permissions framework or sandbox.
- Inventory optional packages and project skills. Use native resource selection where it fits; avoid another Working Mode-dependent catalog engine. Check terminal and RPC separately, preserve explicit invocation and required guidance, and obtain approval before removing a used capability.

**Exit evidence:** one understood delegation path by default, proven lead/Worker/leaf exposure, and an isolated end-to-end smoke. Thomas accepts the loss of any intentionally disabled workflow before live activation.

### 4. Prune only demonstrated duplication

**Deliver:** small removals, each with its own evidence and reversible commit.

| Candidate | Condition before removal or simplification |
| --- | --- |
| Legacy plugin-owned application shell | Reachability audit proves the new entry does not need it; retain live plugin services, typed clients, session coordination, and fixtures |
| Separate Workstream Atlas surface | Thomas confirms no unique history/review workflow is lost; retain canonical Store data and useful history access |
| Repeated model names and routing prose | Keep binding truth in the routing policy; retain concise role/independence guidance and update stale examples |
| Broad standing skill discovery | Compare actual catalogs and real tasks; retain project capabilities on demand rather than deleting their implementation |
| Stale product/status documentation | Reconcile verified current state in README, PRODUCT, foundations, relevant contracts, UI plan, and reuse instructions without turning proposals into shipped facts |

Keep current Working Mode behavior during extraction. Do not promote the four-axis preview, Stateless Model Calls, or managed-Run concepts as part of this work. Keep input auditing opt-in; it already captures nothing by default. Empty placeholder directories are not meaningful runtime savings.

**Exit evidence:** each removal names its replacement or absence of need, callers checked, checks run, and rollback. No percentage or line-count reduction target; less maintenance and fewer competing concepts are the outcomes.

### 5. Accept and switch the installed app

**Deliver:** the Workbench-owned client in daily use, with a known rollback.

- Run the preservation matrix below, relevant deterministic checks, and independent review of changed authentication, file, lifecycle, and capability boundaries.
- Verify native readiness and installation against the selected runtime and client identities. Replace UI/app artifacts without restarting the session daemon wherever supported.
- Before any unavoidable daemon restart, request explicit authorization and warn that running turns, children, terminals, and asks may be interrupted. A plan approval is not restart permission. If both services require restart, the web/API process goes first.
- Retain the previous client, runtime revision, configuration, and compatible state backup. A UI rollback must not overwrite session or Workstream data. Runtime rollback requires a persisted-format compatibility check; otherwise stop rather than downgrade blindly.
- Thomas exercises the installed app in normal work, then accepts the slice. Preserve the previous working deployment until that check passes.

**Exit evidence:** installed identity matches the tested inputs; daily workflows pass; rollback is rehearsed in isolation; remaining issues are explicit rather than hidden behind a green build.

### 6. Rehearse one controlled PI WEB update

**Deliver:** a repeatable update procedure exercised on a real candidate revision.

1. Fetch upstream and the fork into an isolated checkout. Keep upstream-mirror `main` clean and use the fork integration branch for required patches; never modify the running checkout to try an update.
2. Review changes since the accepted pin: imported UI modules, wire types, session lifecycle, configuration defaults, tools/prompts, Pi SDK, dependency/security changes, and persisted formats. New product features are candidates, not automatic adoption.
3. Build the candidate with the same Workbench source and approved configuration. Run baseline acceptance plus targeted checks for affected behavior and compare agent-input fixtures.
4. Investigate regressions or changed defaults. Thomas accepts material behavior changes; no new tools, model bindings, or skill policy enter unnoticed.
5. Adopt the candidate by advancing the recorded pin and required integration changes together, or reject it and keep the working version. Cutover follows phase 5's safety rules.

Evaluate revisions we choose to adopt, not every upstream commit. Prioritize security fixes rather than leaving a pin indefinitely unexamined. Do not add an automatic upgrade service or a generalized dependency-management framework.

**Exit evidence:** one candidate update is adopted or rejected with inspectable evidence, and the accepted build remains reproducible.

## Preservation and verification matrix

| Workflow to preserve | Required evidence |
| --- | --- |
| Choose workspace; start/resume a Chat | Complete machine/project/workspace/session identity; uncertain launch cannot duplicate sessions |
| Compose and control work | Editing, drafts, attachments, model/effort controls, queue ordering, steer, stop, live questions, extension dialogs |
| Read and navigate conversation | Paging, message actions, thinking/tool presentation, scroll restoration, reload and reconnect |
| Resume a Workstream | Stored overview, per-session checkpoints, Human Tasks, revision-safe answers, correct session association |
| Observe delegated work | Child name/goal/status, actual binding, completion, cancellation, collection, Worker resumption and nesting limits |
| Use multiple windows and phone/narrow views | No draft/session/event leakage; keyboard access, focus, contrast, and accepted narrow-layout behavior |
| Use Files, if accepted into the baseline | Workspace confinement, dirty-edit protection, stale-save rejection, bounded I/O, and independent security review |
| Replace UI/native artifacts | Other sessions and daemon keep running; trusted origins, notifications, and native controls retain accepted behavior |

Start with `npm test`, the relevant PI WEB tests, and `packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs`; adapt that runner rather than inventing a parallel suite. Native checks are listed in `apps/pi-web-macos/README.md`. Record exact commands/results and known baseline failures; do not waive failures on the changed path as unrelated.

Ordinary compatibility checks use deterministic no-model fixtures. Use a bounded live model smoke for tool choice, delegation, and completion behavior that fixtures cannot establish. Compare only the binding or prompt behavior that changed; a few tasks screen regressions, not statistical superiority across all models.

Every isolated instance needs its own HOME/state, data directory, session-daemon socket or port, web port, and owned process cleanup. Never inherit the live instance's `PI_WEB_*` endpoints. Delegate visual inspection; preserve source assertions separately from installed owner acceptance.

## Decisions and stopping points

Thomas approves this direction and the phase-1 preservation list before implementation. Later decisions stay local: selected baseline and serving/build seam, each capability loss, Files readiness, and live cutover. Routine implementation within an accepted slice stays agent-owned.

Each phase ends with evidence and one coherent commit or small reviewable series; no next phase starts merely because a plan lists it. Shared checkout writers remain serialized. Deletion follows a working replacement, and a failed gate leaves the current app untouched.

The whole effort is complete when the owned client is accepted, approved pruning is finished or explicitly deferred, the active agent surface is checked, one upstream-update rehearsal is complete, and rollback and documentation match what actually runs.

## Review status

The preceding read-only inventory had two source scouts; neither was an independent architectural verdict. A fresh independent review of this plan failed preflight with `ROUTING=BLOCKED`: Claude quota exhausted. Author checks passed for local links, six-phase structure, absence of machine-local paths, and whitespace. These checks do not substitute for independent architectural review; the plan remains a draft, not implementation-ready.
