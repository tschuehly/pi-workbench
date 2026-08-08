# Unified PI WEB interface acceptance evidence

Status: **automated gates pass; release browser gate remains blocked by missing controlled session fixtures.**

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

## Release blockers and deviations

The release browser gate is not complete. The isolated environment can seed canonical Workstream
ledgers, but PI WEB does not yet expose a deterministic browser fixture for controlled native
sessions and host-owned Chat/Files/Git/Terminal surfaces. Registering a real project discovered
existing user sessions; those sessions were not used for screenshots or interaction evidence.
Consequently this pass did **not** claim or record:

- a root containing both a controlled Chat and Workstream, or selection of every Chat/Workstream/session;
- a synthetic standalone Chat with a live ask;
- a successfully anchored Workstream session Chat and Context switch;
- differently anchored Files, Git, and Terminal surfaces;
- live-ask answering, draft/scroll/paging retention, or Terminal process retention after switching;
- expanded-to-collapsed desktop navigator interaction;
- opening the closed Workstream;
- explicit-anchor launch confirmation;
- browser screenshots for reconnect and typed anchor repair;
- physical coarse-pointer geometry or native 200% browser zoom.

Those behaviors retain automated coverage where listed above, but the production plan requires both
automation and browser evidence. Release remains blocked until PI WEB supplies a no-model,
non-user-data session fixture (or an equivalent isolated Electron harness), followed by the missing
interaction pass at 200% zoom and with coarse-pointer emulation. No production credentials, user
session data, or generated Run data were added to this record.
