# Verification receipt

Status: **PASS** — final static and headless runs complete.

- 40 Components and 11 Patterns exist and are indexed exactly once.
- 310 local Markdown links/anchors resolve; 21 inline/external scripts parse under Node v26.7.0.
- 41 HTML files open in isolated headless Chromium with no uncaught page errors.
- 19 scripted candidates pass interaction checks, including filtering, keyboard input exclusion,
  disclosure, deep links, real flow levels, dialogs, media-size controls and bridge validation.
- 39 Components total at most 85 lines each including README/code. The four-file, cross-document
  review-bridge is 149 lines; its explicit trust checks justify the documented size exception.
- No machine-local absolute paths, production data, runtime dependencies or external script loads
  are introduced. Browser session and loopback test server close in the check's finally block.

- V1 · verified: first run stopped at review-filter because the test dispatched a non-bubbling
  synthetic change, unlike a real select interaction. Root delegation is correct; the test now
  bubbles input/change. No Component workaround added.
- V2 · verified: bridge receiver serializes only validated locator fields, ignoring unknown fields
  (including cyclic extras). Origin/source rejection at both ends, malformed locators, node
  replacement, pin selection, picking and cancellation all pass.

Commands:
- `node extensions/atelier/candidates/check.mjs`
- `node extensions/atelier/candidates/check.mjs --browser`

The check covers candidate/index parity, local documentation links/anchors, line budget, inline and
external JavaScript syntax, every HTML open and selected native interactions. Browser runtime errors
fail the run. It does not establish visual polish, source truth, Kernel integration, actual video
playback or owner acceptance. No real source media or customer data is bundled.

No initial-context files, tool definitions, skills or packages are changed by this directory;
context-usage measurement is not applicable to these explicitly loaded candidate files.
