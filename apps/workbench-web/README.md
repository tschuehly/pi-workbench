# Owned Workbench client (candidate)

The standalone client uses PI WEB HTTP/WebSocket protocols and copied, attributed presentation assets; its built files do not import PI WEB frontend source. It is **not installed for daily use**. Keep the current PI WEB client and daemon until Thomas accepts this replacement.

## What works in the isolated client

- **Chat:** registered project/workspace/session selection; paged history, reconnect, in-flight text, pending questions and confirm/select/input extension dialogs; native-textarea drafts, model/thinking controls, send/steer/queue/stop, and bounded inline PNG/JPEG/GIF/WebP attachments. Tool calls and thinking render as inert structured text, not PI WEB's full rich tool UI.
- **Workstreams:** revision-paired, scoped Store listing/inspection, confirmed checkpoints, Human Tasks and links; exact idempotent answers and creation with lost-response reconciliation. Blank and checkpoint sessions save an exact, reviewable prompt **without sending it**. An uncertain session POST stays locked until startup-token lookup confirms its identity; a pending association can be reconciled without another POST. Anchorless sessions can be located by a complete registered-local-workspace scan and repaired only after an exact recheck and explicit confirmation.
- **Roster:** projects actual session extension-status role/model/effort and running versus uncollected states; unavailable status never becomes fabricated completion.
- **Files:** registered local workspace tree and bounded, inert text viewing; version-checked UTF-8 edits, stale-write rejection, dirty-navigation confirmation, and uncertain-save recheck. Binary, truncated and unverified files are read-only. No ad-hoc external root is granted by the frontend.

At narrow widths, Chat, Workstreams and Files occupy one pane at a time with Chat navigation controls retained. Embedded Terminal and Git UI are deferred; external terminal and agent shell tools remain on the backend.

## Verify without touching the live daemon

From the `pi-workbench` root, with the pinned `../pi-web` fork checkout and Chromium installed:

```bash
node apps/workbench-web/build.mjs
node --test apps/workbench-web/*.test.mjs packages/workstream-session-coordination/test/coordination.test.js
CHROME_BIN=/absolute/path/to/chromium node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs \
  --pi-web-root ../pi-web --owned-client-dist apps/workbench-web/dist
node packages/pi-web-integration/scripts/run-workbench-static-smoke.mjs ../pi-web apps/workbench-web/dist --native
```

The browser check starts separate web/API, daemon and Chromium processes with isolated HOME, configuration, state, socket and ports. It exercises all four capabilities, including a lost Workstream session response, exact-prompt restoration after reload, checkpoint continuation and registered-location repair. The native smoke installs only an isolated app bundle; WKWebView renders the chooser, edits an unsent title, opens a registered fixture Chat and Files pane, reads and edits a file, then retains the draft after a competing versioned write causes a conflict. It restores the prior client assets while checking unchanged sessions, Workstreams, launch ledger, config and backend revision. Neither check installs over the live app or restarts its daemon. Add `--screenshots-dir .review/owned-ui` to the browser command for rendered image evidence; visual review must stay separate from automated assertions.

## Limits before daily-use acceptance

- Browser roster status is injected into a real isolated daemon response. Read-only live status GETs during genuine Subagent and Worker→foreground-leaf executions returned running actual role/model/effort/activity through the owned parser. Both Worker dispatches and leaves completed successfully; live terminal-uncollected and cancellation presentation remain untested. The credential-free fixture has no model, so model switching, an actual model stream, and model consumption of an image are unproven.
- In-memory pending dialogs are not demonstrated across daemon restart. Staged image bytes do not survive tab reload; unsent Chat text survives same-tab reload, not a proven app restart. Remote machine selection, general file attachment/delivery, and rich extension tool presentation are absent.
- The [initial cross-family Files review](../../packages/pi-web-integration/evidence/owned-files-security-review-2026-09-23.md) covers older revisions; the [final-patch read-only review and Linux check](../../packages/pi-web-integration/evidence/owned-files-postfix-review-2026-09-23.md) are separate-context, not cross-family post-fix sign-off. No-follow reads/listing and bounded enumeration have tests; a directory with over 1,000 entries is explicitly incomplete. Installed Files acceptance and the owner's external-root policy decision remain open.
- Isolated native Files interaction and data-safe rollback are **not** an installed daily-use trial. Thomas must inspect the installed client and explicitly accept it before a live switch.

See `NOTICE.md` for copied UI provenance and license.
