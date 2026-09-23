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

**Material differences from fork to candidate (`git diff upstream/main..5e263538`):** the candidate lacks session `recent`/`locate`, queue `promote`/`promote-all`, `SessionStatus.extensionStatuses`/`activeToolExecutions`, attachment `reference` fields, and the fork's assistant entry-ID/projection path. Workstream resume and roster require some of these; Chat queue controls, named image attachment behavior and revert/resend need separate checks. The candidate also changes Pi SDK and plugin runtime. The trial did not establish their behavior, authentication, persisted-format compatibility, loaded agent tools/prompts or full Files security. Do not downgrade or replace a running backend based on this result.
