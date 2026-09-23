# Independent Files security review · 2026-09-23

Reviewer: fresh Anthropic `claude-opus-5-5` Pi 0.87.1, run read-only with `read,bash` and telemetry; authoring lead was OpenAI Codex. Command: `npm exec --yes --package=@earendil-works/pi-coding-agent@0.87.1 -- pi --no-session --no-context-files --no-skills --no-extensions -e extensions/telemetry/index.ts -e <installed pi-claude-code-use extension> --tools read,bash --provider anthropic --model claude-opus-5-5 --thinking high -p <bounded review prompt>`. Reviewer examined Workbench `fe5ee82` and fork `97493c2b`; this is its unedited report, not approval of subsequent fixes. Follow-up verification: Workbench `eb19590` fixes finding 3; fork `327b390c` addresses findings 1 and 4. Workbench `031b386` skips unsafe filenames while retaining other entries and restores a rejected workspace picker; fork `ce8265c8` classifies control-heavy text as binary before JSON encoding. Finding 2 needs owner policy direction; finding 5's concurrent local-writer race remains. Finding 6 is mitigated but concurrent deletion during listing is not yet addressed.

---

I found no confinement escape, HTML/script injection, or version-check bypass that the Workbench Files client can trigger on its own. There are six findings: one medium-severity lost-update risk in the client, two medium backend issues, and three low. I didn't edit, run, install or restart anything, so none of this was tested. It all comes from reading the code at the commits you named. I didn't treat the tests as proof.

## Findings (in priority order)

**1. Medium (availability, backend) — a hostile `.pi-web/config.json` in the repo can block every Files request and stall the whole server.**
- `workspaceExplorerRoutes.ts:26,35` call `pathAccessForWorkspaceContext` on every tree and file request, even plain relative ones. The `/files` route at `:101` only does this for absolute paths.
- That call ends in `projectPiWebConfig.ts:24`, which reads the file with `readFile`. That follows symlinks and has no regular-file check, no size limit and no non-blocking open.
- **Repro:**
  - If the repo's `.pi-web/config.json` is malformed JSON, every tree and file request returns 400 and the Files panel stops working.
  - If it's a symlink to `/dev/zero`, each request tries to read about 2 GiB into memory before Node gives up.
  - If it's a FIFO (for example created by a script the agent runs), the open blocks one of Node's 4 file-system worker threads forever. Four such requests stall file access for the whole server.
- **Fix:** only load path-access config for `~`/absolute requests. Open the config with `O_NOFOLLOW|O_NONBLOCK`, check `fstat` for a regular file, and cap the size at about 64 KiB.

**2. Medium (policy, backend; the Workbench client can't reach it) — the repo can widen what the server will read.**
- `projectPiWebConfig.ts:33-36` merges the project's own `.pi-web/config.json` `pathAccess.allowedPaths` into the global config. I saw no trust check.
- **Repro:** the repo commits `{"pathAccess":{"allowedPaths":["~"]}}`. Then `GET …/file?path=~/.ssh/id_rsa` succeeds through `resolveAllowedTarget` (`pathAccessPolicy.ts:83-90`). The tree and preview routes behave the same way.
- `files.mjs:4` (`safePath`) rejects `~`, leading `/`, backslashes and drive letters, so the Workbench client can't exploit this. Other same-origin clients of the same API can.
- **Fix:** don't let repo config widen access. Ignore project-level `allowedPaths` unless the user has explicitly trusted the project, or only let it narrow access.

**3. Medium (integrity, client; depends on the browser, untested) — after a reload the editor can show old text, and saving then overwrites the external change.**
- `main.mjs:75` only writes `source.value = view.buffer` when the textarea isn't focused. The detail panel is rebuilt only when the path changes (`:62`), not when the version changes.
- **Repro:**
  1. Edit a file with the cursor in the textarea, and click Save. This matters in Safari and Firefox on macOS, where clicking a button doesn't move focus off the textarea.
  2. The save gets a 409, so you click Reload and confirm "Discard".
  3. If the disabled-then-re-enabled textarea is still the focused element, it keeps showing your old edit while `state.buffer` holds the reloaded content.
  4. You type one character. `edit(source.value)` puts your stale edit into the buffer, and Save sends the *new* `expectedVersion`. The external change is silently reverted even though the version check passes.
- **Fix:** key the refresh on `path + version`. When the loaded version changes, always set `source.value` from the buffer.

**4. Low (outcome misclassification) — a 409 can arrive after the new content has already been written.**
- In `scripts/workspace-file-write.py:154-165`, the new file is linked in at `:154`. If the second snapshot then fails (`:155`), putting the original back hits `FileExistsError` and the script returns a Conflict (409), but the new content is already on disk.
- Separately, if removing the backup folder fails with anything other than "not empty" (`:190`), the script reports an error *after* it has already sent its success result.
- The client (`files.mjs:126-128`) treats a 409 or other 4xx as "definitely not written". So it reports a conflict when the edit was actually saved. Nothing is lost, because the concurrent change sits in `.pi-web-backup-*`, but the user is misled.
- **Fix:** have the helper return a separate "written but displaced / uncertain" status as a 5xx or dedicated code, and have the client treat it as `unknown`.

**5. Low (race window, backend) — reads and listings can be redirected outside the workspace by a concurrent writer.**
- The server resolves the real path first (`pathAccessPolicy.ts:60-62`), then uses the path name again in `stat`/`open` (`fileContentService.ts:16,43`) and `readdir` (`fileTreeService.ts:13`).
- `O_NOFOLLOW` only protects the last path component. A process writing in the workspace can swap a parent folder for a symlink in between and get outside files read or listed.
- If a FIFO is swapped in after the `stat` check, `open` (no `O_NONBLOCK`, no `fstat` on the open file) blocks a worker thread.
- This needs a concurrent local writer, which usually already has the user's privileges. Writes are not affected, because the helper checks every path component.
- **Fix:** open files the same component-by-component way the write helper does (`O_NOFOLLOW_ANY` on macOS), add `O_NONBLOCK`, and `fstat` the open file to confirm it is a regular file.

**6. Low (availability, safe failures) — hostile names or content make listing or opening fail.**
- One bad entry name makes the whole folder listing fail with "Invalid file tree entry" (`files.mjs:4,31`). Examples: a name starting with `~`, containing `\`, or starting with `C:`.
- A 512 KiB file of control bytes such as `\x01` isn't flagged as binary, because the server only looks for NUL bytes (`fileContentService.ts:210`). JSON escaping expands each byte to 6, so the response passes the 2 MiB client cap (`files.mjs:3,15`) and the file can't be opened.
- A file deleted between `readdir` and `lstat` fails the whole listing (`fileTreeService.ts:22`).
- **Fix:** skip invalid entries one by one; raise the cap or have the server classify these files.

**Also minor (UI):** if `canLeave` refuses a workspace switch (`main.mjs:151,275`), the workspace picker still shows the new workspace while Files stays on the old one.

**Notes, not scored:**
- There is no authentication. The server listens on 127.0.0.1 by default (`index.ts:13`), and Fastify doesn't check Host or Origin; `allowedHosts` only applies to the Vite dev server. So in your model, "authorized" means any same-origin client. DNS rebinding is left out as a remote attack.
- Bidi and invisible characters in names and content are shown as-is.
- On Linux, filenames that aren't valid UTF-8 are converted with replacement characters, so two different files can end up with the same listed name.

## Checked and found sound
- **Untrusted text:** everything is rendered with `textContent` or textarea `.value`. There's no `innerHTML` and the client doesn't use the preview route.
- **Workspace access:** the client only works on local, registered workspaces. The server looks the workspace up through sessiond and checks the IDs it gets back.
- **Symlinks:** they're hidden in the tree. Reads use `O_NOFOLLOW` on the last component. The write helper walks each component without following symlinks (`O_NOFOLLOW_ANY` on macOS) and checks the parent folder is unchanged before committing.
- **Lossless editing:** a file is only editable if the SHA-256 of the re-encoded text matches the server's version and the byte count matches the size. Truncated, binary, unversioned or non-UTF-8 files are view-only.
- **Growth race:** if a file grows between `stat` and read, the saved version is the prefix's hash, so saving gets a 409.
- **Deleted files:** a save to a file deleted since it was loaded gets a 409; the file is not recreated.
- **Uncertain saves:** network errors, 5xx, bad receipts and failed post-save verification all lock further saves. After a reload, `open()` clears the uncertain flag before its request; if that load fails, an old-version resave still gets a 409.
- **Leaving with unsaved edits:** there's a confirmation when switching files or workspaces and on `beforeunload`, and switching is blocked while a save is in flight.

## What I examined
- **Workbench:** `files.mjs`, `main.mjs`, `files.test.mjs`, `catalog.mjs`, `index.html`.
- **Backend:** `pathAccessPolicy.ts`, `fileContentService.ts`, `fileTreeService.ts`, `workspaceExplorerRoutes.ts`, `pathSafety.ts`, `workspaceContext.ts`, `workspaceRouteErrors.ts`, `effectivePathAccess.ts`, `projectPiWebConfig.ts`, `scripts/workspace-file-write.py`, `sessionDaemonWorkspaceCatalog.resolve`, plus the relevant parts of `app.ts`, `index.ts` and `config.ts`.

## Not tested or not reviewed
- Nothing was run: no test suite, no browser, no race or FIFO experiments.
- Not reviewed: the preview service and its CSP, the delete and move routes (the Workbench doesn't use them), sessiond internals, the Fastify body parser, and behaviour on Linux or Windows.
