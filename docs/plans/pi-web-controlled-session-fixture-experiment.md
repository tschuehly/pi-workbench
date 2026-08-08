# Controlled PI WEB session fixture experiment

Status: approved experiment plan; implementation not started. This is the detailed execution companion for Phase 1 of the approved governing [`pi-web-unified-shell-prototype-fidelity.md`](pi-web-unified-shell-prototype-fidelity.md) plan. It does not change Workstream or session protocol meaning.

## Outcome

Provide a deterministic, no-model, non-user-data way to run PI WEB with controlled native sessions. The fixture must let browser automation exercise host-owned Chat, Files, Git, and Terminal surfaces and Workbench-owned Chat/Workstream classification without discovering or modifying the user's real sessions.

If the experiment succeeds, one Workbench-owned command starts the isolated stack, reproduces the current composition mismatch, drives every native session and surface blocker listed in `packages/pi-web-integration/unified-ui-acceptance-evidence.md`, cleans up, and returns pass or fail in seconds. This is red-capable infrastructure for the governing remediation plan, not completion of the superseded UI-only release gate. If the production seams cannot provide a required state, the experiment ends as **partial — blocker recorded** and names the prerequisite or narrower Electron alternative.

## Experiment question

Can PI WEB expose controlled persisted sessions and session activity to its ordinary production clients while keeping fixture setup outside production runtime behavior?

The experiment passes only if the browser sees the same public session-navigation, Chat, Files, Git, Terminal, draft, scroll, ask, and location behavior used for ordinary sessions. A DOM-only mock or Workbench adapter fabrication does not answer the question.

## Boundaries

### Included

- A temporary PI WEB data directory and temporary repositories/workspaces.
- At least five opaque native session identities on distinct complete anchors, including two with live conversation fixtures; the paired Workbench fixture alone classifies them as unmatched or associated.
- Deterministic transcript paging, drafts, scroll positions, context usage, one live `ask_user` state, Files/Git content, Terminal processes/output, fixed clocks, and stable display identities.
- Complete and partial native-session catalog states, reconnect, unavailable location, missing anchor, successful typed repair, session selection, and cleanup.
- Browser automation at desktop, the canonical 901/900-pixel handoff, 760, 390, and 320 pixels, plus emulated 200% zoom, reduced motion, and coarse pointer. Physical coarse-pointer geometry, native zoom, and assistive-technology claims remain later attended evidence under the governing plan.
- Reuse of the production `SessionNavigationHost`, `PrimaryViewSurfaceHost`, session-location resolver, and Workbench plugin.

### Excluded

- Model calls, provider credentials, copied user sessions, or the user's normal PI WEB data directory.
- A second session catalog implementation in the Workbench adapter.
- Workstream schema changes, synthetic Workstream associations inferred from the fixture, or any fixture endpoint or conditional fixture behavior reachable in a production code path.
- Claims about physical touch hardware, native zoom, or assistive technology that the automation environment cannot prove.

## Isolated workspace

The governing AFK overlay supplies one coordinated pair of owned Workbench/PI WEB branches, worktrees, and runtime roots. Standalone attended execution may create `exp/controlled-session-fixture` worktrees only after the plan commit. Neither path uses `main` or another run's state. Use the resulting Workbench evidence commit as base and PI WEB commit `75442b9` unless Phase 0 records a newer fork baseline. Before creating it, fetch both `upstream` and `origin`, keep `upstream` fetch-only, and retain `safety/unified-ui-before-upstream-rebase` until the governing plan's browser verification completes.

All runtime state lives under a fresh owned root. Workbench owns one reusable guard/process module at `packages/pi-web-integration/scripts/lib/isolated-pi-web-stack.mjs`; this runner creates it and continuation probes consume it rather than implementing another guard. It builds an allowlisted environment from scratch; pins `HOME`, `XDG_CONFIG_HOME`, `PI_WEB_DATA_DIR`, `PI_WEB_CONFIG`, `PI_WEB_PROJECTS_FILE`, `PI_WEB_MACHINES_FILE`, `PI_WEB_SESSIOND_SOCKET`, `PI_WEB_PORT`, `PI_WEB_AGENT_DIR`, `PI_CODING_AGENT_DIR`, `PI_WEB_AGENT_SESSION_DIR`, and `PI_CODING_AGENT_SESSION_DIR`; sets `PI_WEB_OFFLINE=1`, `PI_OFFLINE=1`, and `PI_WEB_SKIP_VERSION_CHECK=1`; and removes `PI_WEB_SESSIOND_URL`, `PI_WEB_SESSIOND_PORT`, and proxy/provider/auth variables. Preflight requires `os.homedir()` and every resolved data/config/session/service path plus ports to belong to the experiment.

## Delivery sequence

### Phase 0 — Map the production session path

1. Lock repository ownership: PI WEB owns the deterministic test-only native-session fixture behind bounded dependency seams; Workbench owns `packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs`, the cross-repository process/browser runner and paired Workstream fixture.
2. Identify the narrowest existing PI WEB APIs that create or load a persisted session, publish catalog state, expose messages, and mount Files, Git, and Terminal.
3. Identify how `ask_user`, drafts, scroll anchors, context usage, and Terminal process identity are currently persisted or held in live state.
4. Write a fixture contract listing inputs, generated state, fixed clock, public observations, and cleanup obligations.
5. Prove PI WEB data and Pi session storage are redirected to fresh temporary roots before any catalog read.
6. Add a named PI WEB test-only entry point, `src/server/fixtureServer.ts`, that calls `buildApp` with bounded substituted dependencies and serves built client assets. `src/server/app.testSupport.ts` is Vitest-bound and cannot serve this browser role. The production server imports neither test entry point and gains no fixture conditional or endpoint.
7. Start isolated `sessiond` through the shared Workbench guard. Assert `PI_WEB_SESSIOND_URL` is absent, registry overrides are owned, and every spawned session file stays under the temporary root; never connect to the normal daemon.
8. Create a red runner skeleton at `packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs` that starts isolated dependencies, invokes one deliberately failing browser assertion against the current composition, cleans up on success/failure/signal, and returns the browser result as its exit status.

Exit: the design names the production seams the fixture will drive and contains no Workstream semantics in PI WEB core.

### Phase 1 — Create deterministic native sessions

1. Implement `src/server/fixtureServer.ts` plus a fixture builder that creates temporary repositories and at least two different workspace anchors.
2. Create controlled native session files through PI WEB or Pi session APIs rather than handwritten partial JSON where an API exists.
3. Seed bounded transcripts with stable identifiers, timestamps, titles, paging depth, and one branch.
4. Add controlled context-usage state and a live-ask source without invoking a model. If either cannot reach the browser through a production seam with only bounded dependency substitution, stop and classify the experiment as **partial — blocker recorded** rather than parsing or mutating private UI state.
5. Ensure every generated identifier and path is test-local and omitted from committed evidence.

Exit: the ordinary native-session catalog reports a complete controlled inventory and contains no real user session.

### Phase 2 — Exercise host-owned surfaces

1. Start PI WEB against the isolated state and register the temporary projects/workspaces.
2. Select each controlled session through `SessionNavigationHost` using its complete location.
3. Verify Chat transcript, draft, paging, and scroll restoration.
4. Verify Files and Git show the selected temporary workspace.
5. Open a harmless Terminal command in each anchor and verify process and dock state remain scoped after switching.
6. Exercise partial catalog, reconnect, missing location, unavailable host, and successful location-repair states without changing fixture truth in the Workbench adapter.

Exit: automated assertions prove every surface follows the selected complete session identity.

### Phase 3 — Pair with canonical Workstreams

1. Seed canonical Workstream ledgers with the existing Workbench evidence script or a bounded extension of it.
2. Associate only the designated controlled sessions through canonical records.
3. Verify unmatched sessions appear under Chats only after both inventories are complete.
4. Verify Workstream rows open briefs and associated session rows open the correctly anchored Chat and Context surfaces.
5. Answer a live ask and a durable Human Task separately.
6. Confirm failed checkpoint replacement retains the previous checkpoint and anchor repair remains typed.

Exit: the paired fixture covers both native Chats and canonical Workstreams without inferred associations.

### Phase 4 — Record release evidence

1. Run the Workbench-owned acceptance runner as the primary experiment command and prove its first current-composition assertion is red for the expected fidelity mismatch while native-session/surface fixture assertions execute deterministically.
2. Run the focused PI WEB and Workbench suites, then the affected aggregate checks.
3. Capture the native-session browser interactions listed in `unified-ui-acceptance-evidence.md` as red-capable evidence for the governing plan.
4. Record exact commits, commands, fixture mode, viewport, and observed result without machine-local paths or session identifiers.
5. Classify every remaining gap as passed, unsupported by the harness, or a product defect.
6. Remove disposable generated state and prove normal PI WEB data and Pi session directories were unchanged.

Exit: the red-capable harness reproduces the current shell mismatch and all reachable native-session blockers, or the evidence classifies the result as partial and names a narrower unresolved prerequisite. It does not declare the superseded UI-only release complete.

## Browser driver and verification

Use the existing PI WEB precedent in `scripts/capture-screenshots.mjs`: discover system Chromium through `CHROME_BIN` and drive it over CDP with an owned temporary user-data directory and debugging port. Do not add a second browser dependency for this experiment. The primary runner fails with typed `BROWSER_UNAVAILABLE` when no supported Chromium binary is present; it cannot report a partial pass.

Minimum automated coverage:

- complete, empty, partial, reconnecting, and unavailable session inventories;
- unmatched Chat and positively associated Workstream sessions;
- different machine/project/workspace identities;
- transcript paging, live ask, context usage, draft, scroll, Files, Git, and Terminal scope;
- selection races, failed selection preserving the previous destination, and successful typed repair;
- cleanup after browser, web process, and test interruption;
- guards proving the fixture cannot target normal PI WEB data or Pi session directories.

Run focused checks before full verification:

```sh
# PI WEB experiment worktree
npm test -- --run src/client/src/plugins/sessionNavigationHost.test.ts
npm test -- --run src/client/src/components/PiWebApp.primaryViewHost.test.ts
npm run typecheck
npm run lint

# Workbench experiment worktree
node packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs
npm run test:workstream-store
npm run test:pi-web-integration
```

Run PI WEB `npm run verify` and the production build only after the fixture and browser path pass focused checks.

## Pi worker assignment and supervision

One attended Pi worker may implement this experiment in the coordinated workspace. Its assignment must include both worktree paths, the prohibition on real user state and model calls, and the requirement to stop before any live-service operation.

The supervising lead should inspect at semantic boundaries rather than poll continuously:

1. worktree and isolation preflight;
2. fixture contract and first failing test;
3. first controlled session visible through the production catalog;
4. first successful cross-surface switch;
5. paired Workstream classification;
6. final browser evidence and cleanup proof.

Pause the worker immediately if it accesses a normal PI WEB data or Pi session directory, discovers user sessions, proposes Workstream semantics in PI WEB core, or substitutes DOM mocks for production hosts. Stop after one production-seam approach and one narrower isolated-harness alternative fail; record the blocker instead of growing a third fixture architecture.

## Completion criteria

The experiment is complete when `packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs` can create isolated native sessions, launch PI WEB with no model or user data, reproduce the current composition mismatch, drive every required production host through browser automation, and clean up deterministically. If live ask, context usage, repair, or another required state cannot be supplied through production seams, completion is a partial-result report with a precise blocker—not a pass. Promotion into maintained PI WEB test infrastructure requires separate review of fixture API stability and upstream suitability.
