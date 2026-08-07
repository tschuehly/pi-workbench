# Durable PI WEB macOS lifecycle and session-anchor recovery plan

Status: proposed. The [quick recovery plan](pi-web-macos-quick-recovery.md) is already running and exclusively owns live PI WEB lifecycle changes until it finishes. Durable implementation starts in one isolated implementation workspace and must not touch the live stack during recovery.

## Outcome

The Pi Workbench macOS app becomes the reliable entry point to the existing PI WEB development services. Opening the app is idempotent: one native wrapper is visible, PI WEB's native-service manager owns one durable session daemon and one replaceable web/UI service, and every supported launch path delegates to that same authority.

A Workstream session with a missing checkout anchor can be repaired through typed PI WEB and Workstream interfaces. Restarting PI WEB is not presented as a repair for malformed durable Workstream state.

## Observed failures

The installed app currently starts a detached supervisor and returns from its bundle executable. Every Finder or Dock launch can therefore create another supervisor and `PIWebMac` process. Direct development commands can simultaneously compete with PI WEB's installed `com.pi-web.*` LaunchAgents for port `8505` and the session-daemon socket. On the observed machine, six wrappers and two session daemons existed while the health endpoint still reported green. A healthy port does not prove single ownership.

The affected Workstream contains an active session association without `machineId`, `projectId`, or `workspaceId`. The Pi session still exists, but PI WEB can resolve an anchorless session only inside the currently selected workspace. The resulting unavailable-session message survives every restart because the missing anchor is canonical Workstream data.

## Invariants

- PI WEB's native-service module is the only lifecycle authority. Pi Workbench must not create a competing service manager or another set of LaunchAgents.
- The session daemon survives native-wrapper and web/UI replacement.
- Session-daemon singleton ownership is enforced where the Unix socket is bound, not only by launcher convention.
- No process is killed merely because it owns a port or socket; executable identity and owner acknowledgement are required.
- PI WEB remains a typed Workstream client. It must not rewrite `workstreams.json` directly or infer a checkout from transcript text.
- Session-anchor repair preserves the existing session identifier and one-home-Workstream rule.
- Incomplete discovery, ambiguity, and machine failure fail closed.
- The durable-fix workspace never starts, stops, installs, or restarts the live PI WEB services while quick recovery is running.

## Implementation workspace

Use one durable-fix workspace for the whole plan rather than creating a worktree per phase or per session. Because the implementation crosses two independent Git repositories, that workspace contains the minimum safe pair of coordinated Git worktrees:

```text
~/IdeaProjects/pi-workbench.durable-lifecycle/   # branch: fix/durable-pi-web-lifecycle
~/IdeaProjects/pi-web.durable-lifecycle/         # fork branch: fix/durable-pi-web-lifecycle
```

Create both once at the start and reuse them through all durable phases. “One workspace” cannot technically be one Git worktree because `pi-workbench` and `pi-web` have separate `.git` histories. Do not edit either existing dirty checkout, and do not create additional implementation worktrees unless this plan is explicitly split later.

Before creating the PI WEB worktree, fetch `upstream` and `origin`, branch from the intended fork base, and keep `upstream` fetch-only. Configure the Workbench worktree to resolve its sibling PI WEB checkout to `../pi-web.durable-lifecycle` for tests and development.

While quick recovery runs:

- use only pure, fake-process, temporary-directory, and isolated-socket tests;
- allocate non-live test ports and temporary `PI_WEB_DATA_DIR`, config, socket, and LaunchAgent roots;
- do not invoke `pi-web install`, `start`, `stop`, `restart`, or `uninstall` against the user account;
- defer browser, AppKit, Launch Services, and live session acceptance to Phase 5.

## Target design

### 1. Deepen PI WEB's existing native-service module

Keep `pi-web install --dev`, `start`, `stop`, `restart`, `status`, `logs`, `doctor`, and `uninstall` as the lifecycle interface. Extend this existing module rather than adding `pi-web-stack` or `works.pi.workbench.*` jobs.

Add component-scoped operations:

```text
pi-web restart --component ui
pi-web restart --component sessiond
pi-web status --json
pi-web doctor --json
```

An ordinary UI restart replaces `com.pi-web.ui-dev` and leaves the session-daemon PID unchanged. Restarting sessiond is a separate warned operation because it can abort in-flight turns and terminals. The JSON status schema separates:

- `ownership`: `managed | unmanaged | conflict | absent`;
- `health`: `healthy | starting | unhealthy | unknown`;
- `instances[]`: verified PID, executable identity, service-manager label, and component version.

A managed and unmanaged instance can therefore be reported together instead of being flattened into one status word.

### 2. Enforce singleton ownership at the sessiond socket

Change sessiond startup so it does not unconditionally delete `sessiond.sock`. Before binding, sessiond obtains a shared machine-local ownership lock and probes an existing socket:

1. If the lock owner and socket are live, startup fails with a typed duplicate-owner error.
2. If the lock is stale and the socket does not respond, startup removes only the verified stale artifacts and binds.
3. If ownership cannot be proven, startup fails closed and directs the user to `pi-web doctor`.

The same guard applies whether sessiond starts through LaunchAgents, a terminal, tests, or an old launcher. This closes the seam that lifecycle scripts alone cannot protect.

`doctor` detects old Workbench supervisors, duplicate wrappers, direct development process trees, and installed-service drift. Cleanup is attended: it lists verified identities and requires explicit acknowledgement before stopping duplicates. It states that persisted transcripts can be reopened but in-flight turns, asks, and terminals cannot be migrated.

### 3. Make the macOS app a real single-instance AppKit application

Build and copy the release `PIWebMac` executable into `Pi Workbench.app`, and make that binary the bundle executable. Do not put a long-running shell process in front of AppKit and do not detach AppKit from Launch Services.

The AppKit process opens a startup window immediately, then invokes PI WEB's lifecycle interface asynchronously:

1. Inspect `pi-web status --json`.
2. Start already-installed development services when stopped.
3. Wait for typed web and sessiond health.
4. Load PI WEB, or show an actionable error with **Open logs**, **Run doctor**, and **Retry**.

The installer resolves and records the PI WEB CLI/checkout used by the app in a generated bundle configuration, then runs `pi-web install --dev`. Installation is atomic: service preflight succeeds before replacing the existing app. Reinstalling updates both the app and development service definitions. Moving either checkout requires rerunning the installer; no generated LaunchAgent points through the Workbench repository.

The `pi-web-mac` command activates the installed bundle through `/usr/bin/open`; it never runs another wrapper binary. Finder, Dock, Spotlight, and CLI launches consequently route reopen events to one AppKit process.

Native actions have distinct meanings:

- **Reload** reloads one web view.
- **Restart PI WEB UI** invokes component-scoped UI restart.
- **Restart session runtime** warns about in-flight activity and restarts sessiond only after confirmation.
- **Open lifecycle status** displays the existing PI WEB status/doctor results.

### 4. Add typed, fail-closed session-location resolution

Extend the generic PI WEB session host with typed selection errors and a resolver:

```text
resolveSessionLocation({ machineId, sessionId })
  -> found(location, evidence)
   | ambiguous(locations)
   | missing
   | unavailable(failedScopes)
```

`machineId` is required; cross-machine search is never implicit. PI WEB searches registered project workspaces using exact session identity and catalog `cwd`, not message content. It returns `found` only after the complete machine scan succeeds. A failed workspace request yields `unavailable`, never a false unique match or false missing result.

`select` and `open` return typed failure codes for missing anchor, unavailable machine, unavailable project, unavailable workspace, missing session, and transport failure. The Workbench adapter offers repair only for an anchor-specific failure.

### 5. Add append-only Workstream anchor repair

Add a `session.anchor.repaired` semantic record. It names an active `sessionId` and complete `machineId`, `projectId`, and `workspaceId`, with producer and record provenance. The reducer updates only the projected anchor and does not create another session association.

The Workstream Store enforces only invariants available from its ledger:

- the Workstream is open;
- the session is active in this Workstream;
- the projected anchor is incomplete or explicitly marked unresolved;
- the request uses the current revision and a fresh idempotency key;
- the session remains assigned to one Workstream.

PI WEB owns catalog verification as a precondition. To prevent a stale browser result, the trusted PI WEB plugin service rechecks the resolver evidence immediately before appending and records a bounded resolution receipt in the repair payload. The Workstream contract must define that receipt as evidence, not Store-owned truth about the external session catalog.

PI WEB presents **Repair session location** after an anchor-specific failure. A unique match is shown for owner confirmation; multiple matches require selection; `missing` and `unavailable` explain different recovery actions. Closed Workstreams remain immutable and cannot be repaired.

New launch already records location in pending and confirmed records. Tighten validation so newly confirmed associations require a complete location while retaining read compatibility for legacy ledgers.

## Delivery sequence

### Phase 0 — Create the durable-fix workspace

1. Create the coordinated Pi Workbench and PI WEB worktrees under the paths above, both using `fix/durable-pi-web-lifecycle` in their respective repositories.
2. Verify both worktrees are clean and that the original checkouts remain unchanged.
3. Configure all test state, sockets, ports, and generated service definitions under temporary roots.
4. Record that quick recovery owns live lifecycle operations; durable work may proceed only through isolated tests until that ownership is released.

Exit: one reusable implementation workspace exists, both repository worktrees are clean, and no durable test can address the live service paths by default.

### Phase 1 — Capture both failures

1. Add a sessiond contention test: two direct starts and managed-versus-direct starts must not unlink or steal a live socket.
2. Add native-service status fixtures for one managed instance, unmanaged instance, duplicates, stale lock, and ownership conflict.
3. Add a macOS installer test proving the bundle executable is AppKit rather than a detached launcher.
4. Add a Workstream/PI WEB fixture with an existing active session whose anchor is missing; assert the exact unavailable-session symptom.

Exit: fast deterministic commands reproduce duplicate runtime ownership and anchorless-session failure.

### Phase 2 — Harden PI WEB lifecycle ownership

1. Implement socket ownership and stale-artifact handling in PI WEB sessiond.
2. Extend the native-service status and doctor schemas with ownership, health, and cardinality.
3. Add component-scoped restart without changing the sessiond PID during UI restart.
4. Detect old `boot-dev.sh`/supervisor trees as unmanaged conflicts; require attended cleanup.

Exit: no supported or direct launch can create a second live socket owner, and status exposes every detected instance.

### Phase 3 — Replace the macOS launcher

1. Install the compiled AppKit binary as `CFBundleExecutable`.
2. Start AppKit first and perform lifecycle checks asynchronously.
3. Route `pi-web-mac` and app launch through Launch Services and PI WEB's existing services.
4. Remove the detached Workbench supervisor and change `boot-dev.sh` into a compatibility adapter that calls `pi-web install --dev`, starts services, and opens the app.

Exit: concurrent Finder, Dock, Spotlight, and CLI launches activate one app and add no service processes.

### Phase 4 — Repair session anchors

1. Add typed selection errors and complete-scan resolution in PI WEB.
2. Update the authoritative Workstream and interface contracts with repair semantics and the resolution receipt.
3. Add `session.anchor.repaired` validation, projection, type declarations, transition tests, and client validation.
4. Add the Workbench repair control and confirmation flow.
5. Repair the affected PhotoQuest session through the UI and verify Chat, Files, Git, Terminal, Resume, and checkpoint actions.

Exit: the original Workstream opens its existing session after repair and remains resumable without manually selecting its workspace.

### Phase 5 — Replace the temporary recovery workflow

Begin only after quick recovery reports completion and explicitly releases live lifecycle ownership.

1. Run enhanced `doctor` from the durable PI WEB worktree against the machine state left by quick recovery and capture wrappers, services, sockets, and any direct process trees.
2. Confirm no important turn, ask, or terminal is in flight before replacing runtime ownership.
3. Reinstall Pi Workbench.app through the durable installer and verify one owner per component.
4. Repair the legacy PhotoQuest session anchor through the new typed UI flow; keep the quick-recovery replacement session as valid Workstream history.
5. Remove temporary operator steps that the new lifecycle and repair interfaces supersede.
6. Update `apps/pi-web-macos/README.md`; update PI WEB's canonical install and FAQ pages for lifecycle troubleshooting without expanding either root README.

## Verification

Run the narrowest tests first from the coordinated durable-fix workspace, followed by complete affected suites. Before Phase 5, every lifecycle test must use fake or temporary service roots and must not address the live user LaunchAgent domain.

```sh
bash apps/pi-web-macos/Scripts/install-app.test.sh
npm run test:workstream-store
npm run test:pi-web-integration
(cd ../pi-web && npm test -- --run <native-service-sessiond-resolver-tests>)
(cd ../pi-web && npm run verify)
(cd apps/pi-web-macos && swift build -c release)
```

Complete an attended macOS acceptance pass:

1. Migrate an installation containing old `com.pi-web.*` jobs and detached Workbench supervisors without creating competing jobs.
2. Launch concurrently with `/usr/bin/open`, Finder, and `pi-web-mac`; assert one AppKit instance.
3. Attempt a direct second sessiond start; assert it cannot unlink or steal the managed socket.
4. Start a Pi turn, run UI restart, and confirm the sessiond PID and turn remain intact.
5. Confirm sessiond restart warns that in-flight work cannot be migrated.
6. Exercise status for managed plus unmanaged duplicates and partial health failure.
7. Exercise resolver unique, ambiguous, missing, unavailable/partial, cross-machine, stale complete-anchor, and closed-Workstream cases.
8. Repair the anchorless PhotoQuest session, restart wrapper and UI, then resume it without workspace selection.
9. Run `pi-web uninstall` and confirm PI WEB configuration, sessions, and Workstream storage remain intact.

## Rollback

`pi-web uninstall` remains the only service uninstall path and preserves user configuration and data. Reinstalling the previous Pi Workbench.app restores the prior wrapper without modifying sessions or Workstreams. If managed startup fails after rollback, PI WEB's documented manual commands remain available; `status` must report those processes as unmanaged rather than claiming ownership.
