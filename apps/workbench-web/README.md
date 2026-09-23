# Owned Chat proof

This is an isolated protocol client, **not** the daily-use Workbench frontend. It selects registered projects, workspaces and existing sessions, creates a Chat with a single-flight/unknown-outcome lock, and displays paged history, in-flight assistant text and pending `ask_user` questions. Its native-textarea composer has per-window reload drafts and send/queue/stop protocol calls. Model and thinking selectors use each session's available values and server-confirmed status, and disable unavailable choices. While streaming, Send steers; the separate queue button keeps a follow-up for later. Server queue entries can be promoted or cleared, but queue mutation has only deterministic client tests so far. Confirm/select/input extension dialogs rehydrate from daemon status after reload and support answer/cancel; they do not survive a daemon restart. It has no ad-hoc directory mapping, remote-machine picker, attachments, full formatted transcript, Workstreams, delegation roster or Files.

From the `pi-workbench` root:

```bash
node apps/workbench-web/build.mjs
node --test apps/workbench-web/client.test.mjs apps/workbench-web/catalog.test.mjs
CHROME_BIN=/absolute/path/to/chromium node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs \
  --pi-web-root ../pi-web --owned-client-dist apps/workbench-web/dist
```

The browser check starts a separate fixture web/API, daemon and Chromium with isolated state, socket and ports. It seeds a pending question in the fixture daemon's memory and checks history, paging, answering, composer controls, draft reload, registered project/workspace/session navigation and new-session creation/reload, model/thinking option presentation, an isolated thinking-level mutation, and three real extension dialogs opened by an owned fixture extension (confirm/select/input, reload, answer/cancel). The credential-free fixture has no available models, so real model switching remains unproven (deterministic client tests cover the request/response seam). New empty sessions can be transient until a prompt persists them; reload validates the active session status. The Node tests cover simulated stream ordering, reconnect, gaps, send/stop responses and uncertain-create locking, model/thinking and queue validation, stale control replies and queue mutations; **the browser check does not send a real model prompt, produce a real model stream, test daemon restart or prove drafts across app restarts**. An ad-hoc Chat directory not matching exactly one registered workspace remains outside this slice; no catalog identity is invented. No live service is changed. The built assets under `dist/` have no PI WEB frontend-source import. See `NOTICE.md` for provenance and license.
