# Isolated owned-Chat backend update trial — 2026-09-23

**Decision: keep the tested fork backend for the next slice; do not adopt upstream `a923302` as a daily-use replacement.** The same independently built Chat proof passes on both, but the candidate lacks fork-specific operations needed by the selected daily-use UI. This is a Chat-only compatibility check, not acceptance of Workstreams, roster, Files, installed assets or agent inputs.

| Input | Exact revision |
| --- | --- |
| Owned client | `pi-workbench` `716d449` (`apps/workbench-web/dist/`, built once) |
| Baseline backend | `../pi-web` `5e263538c37e75832ab607e836fdea898c77a34e`, PI WEB `1.202609.0`, Pi `0.85.1` |
| Candidate backend | upstream `a923302505fcf6fe9c935f8c2550264ce7705954`, PI WEB `1.202609.1`, Pi `0.87.0` |

The candidate was checked out detached in a **separate persistent worktree**. `npm ci` and `npm run build` passed there. The stock candidate deletes the controlled fixture server, so the unchanged acceptance runner initially failed at `ERR_MODULE_NOT_FOUND: src/server/fixtureServer.ts`. Apply the accompanying `upstream-a923302-isolated-fixture.patch` (SHA-256 `bf35533d588207065c6c147c81847f3ad361e4460146255a978d2d6ab7518fa2`) only to that trial worktree. It copies the fork's controlled fixture and adds a guarded daemon-memory pending-ask hook; it is **test instrumentation**, not an adopted backend change. Candidate build TypeScript check passed with the patch. The first trial also hit `EACCES` launching one Chromium cache binary; switching to the executable Chromium 1228 binary succeeded. The orphaned fixture process groups from that failed launcher were terminated and their owned root removed; runner error handling was corrected afterward.

From the Workbench repository, after building the client once, the relevant checks were:

```sh
node apps/workbench-web/build.mjs
# In the detached candidate worktree: npm ci, npm run build, git apply <the patch>
CHROME_BIN=/absolute/path/to/chromium node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs --pi-web-root ../pi-web --owned-client-dist apps/workbench-web/dist
CHROME_BIN=/absolute/path/to/chromium node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs --pi-web-root ../pi-web-upstream-trial-a923302 --owned-client-dist apps/workbench-web/dist
```

Both isolated runs reported **5/5 passing checks**, `CLEANUP_RESULT.rootRemoved: true`, and exited successfully. They exercised real backend history/paging and a real pending ask/answer/reload with the **same owned assets**. Asset SHA-256: `index.html` `8347647823abb4d496fcbb8f68c9547b6c55e2522805fe9e9d79610cf836d5e8`, `main.mjs` `53475a45722373e53e3ee54aa3fde3628ceb03cfcff7d341b3eda1170c22dc71`, `client.mjs` `6a5ab9179d4dda5975e20ec0b6dda7dca1ecaeb38c03e3513adfd66f3a059ead`. Each run used a fresh HOME, data directory, Unix socket, web/browser ports and process cleanup; neither used the live instance.

## Expanded retry after owned Files/Workstreams/roster slices

On pi-workbench `f739f1c`, the same built owned client passed **35/35** isolated browser checks and **35/35** Node tests against the pinned fork `5e263538`; the fixture checked a real Workstream Store answer and a real workspace Files read, expected-version save, stale conflict, bounded read and traversal rejection. `CHROME_BIN="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell" node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs --pi-web-root ../pi-web --owned-client-dist apps/workbench-web/dist` completed with `CLEANUP_RESULT.rootRemoved: true`.

The unchanged assets and runner against detached candidate `a923302` **failed in Files**. Its browser loaded the `README.md` text but marked it read-only (`editable:false`, “Unverified text”); the attempted edit could not dirty the file, so the subsequent workspace switch cleared the file detail and the runner stopped before saving. Instrumented rerun identified the failing expression as the missing Files Save button, not a dialog. Candidate `src/server/workspaces/fileContentService.ts` returns text without a `version`, and its write path lacks the fork's expected-version commit helper. The owned client correctly refuses an unsafe blind overwrite. Command: same runner and browser with `--pi-web-root ../pi-web-upstream-trial-a923302`; exit 3 `ACCEPTANCE_ERROR HARNESS_ERROR`; all candidate runs reported `CLEANUP_RESULT.rootRemoved: true`. No backend or live service was changed for this retry. The candidate is **rejected for safe Files editing** unless the versioned read/write seam and security helper are deliberately ported and re-reviewed. Earlier Chat/Workstream/roster steps were traversed but their accumulated checks are not printed when the runner errors, so do not claim a candidate pass for those areas. Continue to pin the fork.

## Final owned-shell compatibility rerun

The unchanged owned build from Workbench **`23994dd`** was exercised against pinned fork **`e7ab4e57`** and detached upstream candidate **`a923302`**. Both runs used the same `apps/workbench-web/dist` bytes (`index.html` SHA-256 `8a859788d812cd4d7dde4cac27b558bb143e7edade897ef9ab6ae987a9e6710a`, `main.mjs` `851682e84c062e2dad6ce2bd6aed27676b9392b3b8ad79c3ec44be10040efff2`). The candidate retains only the controlled-fixture patch listed above; it is not an updated live checkout.

```sh
CHROME_BIN="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell" node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs --pi-web-root ../pi-web --owned-client-dist apps/workbench-web/dist --screenshots-dir "$PWD/.review/owned-ui-20260923"
CHROME_BIN="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell" node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs --pi-web-root ../pi-web-upstream-trial-a923302 --owned-client-dist apps/workbench-web/dist
```

The fork passed **64/64** browser assertions: Chat recovery and controls, real Workstream service creation/answer/association and checkpoint launch, anchor repair, status projection and Files read/edit/confinement. The candidate stopped with a real backend **404** on exact `GET /sessions/workstream-launch/workbench-web%3A…`, required to reconcile a deliberately lost Workstream creation response. The runner exited 3 (`ACCEPTANCE_ERROR HARNESS_ERROR`) and printed no candidate assertion summary before that point; do not infer passes for earlier steps. Both runners reported that isolated web, daemon and Chromium processes exited and their roots were removed. The earlier candidate Files failure (no versioned save seam) independently remains. **Decision unchanged: retain fork `e7ab4e57`; never repeat session creation after this missing lookup.** This trial does not establish candidate plugin/agent-input compatibility or safe candidate adoption.

**Material differences from fork to candidate (`git diff upstream/main..5e263538`):** the candidate lacks session `recent`/`locate`, queue `promote`/`promote-all`, `SessionStatus.extensionStatuses`/`activeToolExecutions`, attachment `reference` fields, the fork's assistant entry-ID/projection path, and versioned Files read/write. Workstream resume and roster require some of these; Chat queue controls, named image attachment behavior and revert/resend need separate checks. The candidate also changes Pi SDK and plugin runtime. The trial did not establish their behavior, authentication, persisted-format compatibility, loaded agent tools/prompts or full Files security. Do not downgrade or replace a running backend based on this result.
