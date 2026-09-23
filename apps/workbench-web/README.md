# Owned Chat proof

This is an isolated protocol client, **not** the daily-use Workbench frontend. It displays one existing session's paged history, in-flight assistant text and pending `ask_user` questions. It has a native-textarea composer with per-window reload drafts, send/queue/stop protocol calls and no-model tests. It has no session chooser, attachments, model controls, full formatted transcript, Workstreams, delegation roster or Files.

From the `pi-workbench` root:

```bash
node apps/workbench-web/build.mjs
node --test apps/workbench-web/client.test.mjs
CHROME_BIN=/absolute/path/to/chromium node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs \
  --pi-web-root ../pi-web --owned-client-dist apps/workbench-web/dist
```

The browser check starts a separate fixture web/API, daemon and Chromium with isolated state, socket and ports. It seeds a pending question in the fixture daemon's memory and checks history, paging, answering, composer controls and draft reload. The Node tests cover simulated stream ordering, reconnect, gaps and send/stop responses; **the browser check does not send a real model prompt, produce a real model stream, test daemon restart or prove drafts across app restarts**. No live service is changed. The built assets under `dist/` have no PI WEB frontend-source import. See `NOTICE.md` for provenance and license.
