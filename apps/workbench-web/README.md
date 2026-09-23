# Owned Chat proof

This is an isolated protocol client, **not** the daily-use Workbench frontend. It displays one existing session's paged history, in-flight assistant text and pending `ask_user` questions. It has no composer, session chooser, attachments, Workstreams, delegation roster or Files.

From the `pi-workbench` root:

```bash
node apps/workbench-web/build.mjs
node --test apps/workbench-web/client.test.mjs
CHROME_BIN=/absolute/path/to/chromium node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs \
  --pi-web-root ../pi-web --owned-client-dist apps/workbench-web/dist
```

The browser check starts a separate fixture web/API, daemon and Chromium with isolated state, socket and ports. It seeds a pending question in the fixture daemon's memory and checks history, paging, answering and reload. The Node tests cover simulated stream ordering, reconnect and gaps; **the browser check does not produce a real model stream or test daemon restart**. No live service is changed. The built assets under `dist/` have no PI WEB frontend-source import. See `NOTICE.md` for provenance and license.
