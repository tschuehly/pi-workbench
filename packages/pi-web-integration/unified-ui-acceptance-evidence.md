# Unified PI WEB interface acceptance evidence

Status: **experimental shell-seam candidate is red-capable; composition migration and release browser gate remain blocked.**

This record covers the unified Chats + Workstreams interface implemented through PI WEB commits
`f655413`, `d8701d5`, `9e113ce`, and `75442b9`, and Workbench commits `7006271`, `e0af015`, `3550267`,
`d780c19`, and `b5f2dec`. The 320-pixel correction, reproducible seed, and captured evidence are in
Workbench commit `292986e`. The browser pass used an isolated PI WEB data directory, the production
Workbench plugin and service, and the synthetic ledger produced by
`evidence/seed-unified-ui.mjs`. It made no model calls and recorded no credentials or real session
identifiers.

## Automated release gates

All commands passed on 2026-08-08.

### PI WEB

- Pi menu: 3 tests.
- primary-view host: 24 tests.
- Chat grouping and live asks: 18 tests.
- session navigation and location resolution: 15 tests.
- sessiond ownership and native status: 17 tests.
- `npm run typecheck`, `npm run lint`, and `npm run build:plugin-api`.
- `npm run verify`: 2,573 passed and 3 skipped across 286 files.
- `npm run build` had already passed for the Phase 6 commit; the only output warning was the existing
  large-chunk advisory.

### Pi Workbench

- `npm run test:workstream-store`: 18 passed.
- `npm run test:pi-web-integration`: 82 passed.
- `git diff --check` passed in both repositories before the Phase 6 commits.

Behavioral unit tests cover complete/incomplete inventories, duplicate homes, empty and malformed
state, selection races, reconnect retention, current/stale/missing/failed checkpoints, closed
Workstreams, typed anchor repair, exact Human Task truth, complete-identity surface/Terminal memory,
and PI WEB live asks. Source/CSS presence assertions additionally guard adapter retained-region,
narrow-overlay, coarse-target, reduced-motion, and responsive-layout wiring; they are not a substitute
for browser geometry or assistive-technology checks.

## Browser interaction log

The pass used Chromium through `agent-browser` against the development build. Reproduce the initial
canonical data with `node packages/pi-web-integration/evidence/seed-unified-ui.mjs <empty-directory>`,
set `PI_WORKBENCH_WORKSTREAM_DIR` to that directory, and load the production plugin from this package.
Answer **Yes** through the UI to produce revision 3, then run the same script with
`--append-checkpoint-failure` to produce revision 4. The screenshots use 1,440×1,000, 1,440×900,
760×900, 390×844, and 320×700 viewports. The reduced-motion screenshot alone used Chromium's mobile
preset at device-pixel ratio 3; the other 390×844 images use device-pixel ratio 1.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Root navigator · 1,440×1,000 | Empty Chats and open/closed Workstreams were labeled separately; no association was inferred. This does not satisfy the required browser case with both a Chat and a Workstream. | `evidence/unified-ui/desktop-root.png` |
| Workstream row · 1,440×1,000 | Opened the canonical brief, not a session Chat. The brief showed current, stale, and missing checkpoint states, a failed session launch, and one unresolved Human Task. | `evidence/unified-ui/desktop-brief.png` |
| Pi-menu escape · 1,440×1,000 | The screenshot shows the Pi menu above the dedicated view with **Open default PI WEB shell** available. The operator then invoked it and observed the ordinary shell; that post-click state is not screenshot-backed. | `evidence/unified-ui/pi-menu-over-dedicated-view.png` |
| 760-pixel handoff · 760×900 | The Sessions modal owned focus while the Workspace remained visually behind its scrim. The operator observed Escape close Sessions and restore focus to **Navigate**. | `evidence/unified-ui/narrow-760-workspace.png`, `evidence/unified-ui/narrow-760-sessions.png` |
| 390/320 widths · 390×844 and 320×700 | The brief remained operable at 390 pixels. After a browser-discovered fix, the 320-pixel Sessions header wrapped all three protected controls without clipping and the page had no horizontal overflow. | `evidence/unified-ui/narrow-390-workspace.png`, `evidence/unified-ui/narrow-320-sessions.png` |
| Reduced motion · 390×844 @3 | The operator verified `prefers-reduced-motion: reduce` through Chromium emulation and observed an operable workspace. The still image records the resulting layout but cannot itself prove the media preference. | `evidence/unified-ui/reduced-motion-390-workspace.png` |
| Durable Human Task · 390×844 | Answering **Yes** advanced the canonical revision and changed the task to the separate **Resolve** action; it did not answer a live ask. | `evidence/unified-ui/human-task-answered.png` |
| Failed checkpoint · 390×844 | A deterministic failed replacement advanced the revision while the prior confirmed continuation remained visible. | `evidence/unified-ui/checkpoint-failure-retains-prior.png` |
| Older host · 1,440×900 | A production custom element with the optional session-navigation host omitted stayed operable in Workstreams-only mode and displayed the explicit **Update PI WEB** message. | `evidence/unified-ui/older-host-fallback.png` |

The pass found two real defects. First, a failed narrow session selection could leave the modal with
no focused descendant, so Escape no longer closed it. Commit `b5f2dec` restores focus to the modal
close control when a retained keyed control cannot be recovered. The same browser sequence then
closed with Escape and returned focus to **Navigate**; source assertions cover both modal call sites,
but full DOM regression coverage still requires the missing browser harness. Second, the 320-pixel
Sessions header clipped **New session**. The release-evidence change makes the modal full-width below
520 pixels, wraps its three actions, and reserves the PI launcher gutter for non-empty status banners
at every width; replacement screenshots verify the visible results.

## Controlled-session experiment candidate

The Phase 1 experiment now supplies a test-only PI WEB server at candidate commit `7be6e24` and a
Workbench-owned isolated runner.
The runner uses a temporary `HOME`, data/config/session roots, Unix socket, ports, browser profile,
repositories, and Workstream Store; it strips provider, credential, proxy, and normal-daemon inputs.
The production server does not import the fixture entry point.

The owned Chromium run selected five opaque sessions at five complete anchors and passed catalog,
transcript paging, Files, Git, Terminal command/output, paired Chats/Workstreams classification, and
responsive-emulation checks. It reproduced the expected red composition check: Workbench still owns
an inner destination navigator beneath PI WEB's global shell. The command returned `partial`, not
pass, with typed `LIVE_ASK_UNREACHABLE` and `CONTEXT_USAGE_UNREACHABLE` blockers. The final
receipt reported the session daemon, fixture web server, and Chromium exited and the runtime root
removed. A process/path recheck found no owned residual process.

Reproduce from owned worktrees and an absent owned runtime root:

```sh
node packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs \
  --pi-web-root <owned-pi-web-worktree> \
  --root <owned-empty-runtime-root>
```

Verification used owned `HOME`, config, cache, and temporary roots. Workbench
`npm --prefix packages/pi-web-integration run check` passed 87 tests. PI WEB `npm run verify`
passed typecheck, lint, knip, 2,576 tests, and 3 documented skips across 287 files; `npm run build`
passed with only the existing large-chunk advisory. A first aggregate attempt used an owned but
overlong macOS socket path and failed five socket tests with `EINVAL`; rerunning from the dedicated
short owned root passed, so no product failure was hidden.

The experiment deliberately remains red/partial until later governing-plan phases remove the
composition mismatch and provide approved no-model seams for pending ask and active context truth.

## Phase 2 shell-profile seam candidate

PI WEB candidate commit `32269d9e7536101aa2f31b59171a50f44f40cbc9` adds a generic public
shell-profile seam with qualified contribution selection, four PI WEB-owned fixed regions, bounded
initial panel state, presentation recommendations, provenance, Settings preview/apply/reset,
versioned browser persistence, missing-plugin fallback, and tab-local quarantine after deterministic
default-view failure. Invalid profile metadata is reported without dropping the plugin's unrelated
contributions. A valid preview survives background reconciliation; an invalid preview cancels back
to its saved composition. Initial panel state applies only on an actual profile transition. The core
profile retains PI WEB's narrow-navigation URL behavior.

The Workbench plugin declares a recommended profile over its existing primary view and includes its
Run panel alongside PI WEB Files, Git, and Terminal. This phase does not remove the existing inner
Workbench shell; that remains the expected Phase 3 red assertion.

The final controlled browser run used Settings to preview and apply the Workbench profile, reloaded a
root URL with no explicit `view`, observed `pi-workbench:workstreams.view` as the selected default,
verified the protected profile toolbar stayed in normal layout flow, and reset to
`core:shell.default` through the Pi menu. The check
`shell-profile-workbench-select-default-reset` passed. The aggregate command intentionally returned
`partial` because `CURRENT_COMPOSITION_MISMATCH`, `LIVE_ASK_UNREACHABLE`, and
`CONTEXT_USAGE_UNREACHABLE` belong to later phases. Cleanup again reported all three owned processes
exited and removed the runtime root.

Final isolated checks:

- PI WEB `npm run verify`: 2,596 passed and 3 documented skips across 290 files; typecheck, lint, and
  Knip passed.
- PI WEB `npm run build`: passed with the existing large-chunk advisory.
- Workbench `npm --prefix packages/pi-web-integration run check`: 88 passed.
- Generic and Workbench composition tests cover qualification, ordering, registration-error
  quarantine, transactional profile selection, explicit-route preservation, no-view defaults,
  mobile navigation decoding, preview restoration, missing-plugin intent retention, panel-state
  reconciliation, render-failure quarantine, fixed-region overflow, disabled reasons, and protected
  reset.
- PI WEB core and public profile types contain no Workstream terminology.

Anthropic cross-family review iteratively found route clobbering, partial plugin registration,
persisted-intent loss, a missing Workbench panel, a default-view gap, tautological browser evidence,
initial-panel replay, mobile navigation regression, preview teardown, stale browser evidence, and
render-failure rearming. Each finding received a focused reproduction and repair. A final raw
Anthropic rerun was unavailable because that CLI reported exhausted extra usage; this is recorded as
a provider degradation rather than a fresh independent pass. The final render-failure finding was
reconciled with a tab-local quarantine test, full verification, a rebuilt client, and a fresh
controlled browser run.

Design judgment keeps region callback failures isolated after activation, treats initial panel sizes
as defaults below explicit user widths, keeps presentation recommendations opt-in, and requires an
explicit user retry or reset before a default view that threw can re-enter the tab.

## Release blockers and deviations

The release browser gate is not complete. This candidate does **not** yet claim live-ask answering,
active context usage, draft/scroll retention, reconnect and typed-repair browser sequences,
expanded/collapsed navigator interactions, closed-Workstream behavior, explicit-anchor launch,
physical coarse-pointer geometry, native zoom, or accepted visual baselines. The older screenshot pass
also did not use the new fixture. Those gaps remain assigned to later governing-plan phases and owner
Acceptance. No production credentials, user sessions, normal PI WEB/Pi/Workbench data, or generated
Run data are committed by this experiment.
