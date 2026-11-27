# Background bash

In an attended lead Pi session, this package overrides the model-callable `bash` tool. Commands run in the background by default, return a job ID immediately, show elapsed time and output bytes in Activity, and send the exit status plus recent output to the Chat when they finish. Every call carries a required short `description` (3–10 plain words) that Chat and Activity show instead of the raw command.

Set `foreground: true` when a following action needs the command's exit status or output before proceeding. A foreground call still runs as a job: it returns the output inline if the command finishes within 30 seconds, otherwise it returns the job ID and the completion arrives like any background job, so a slow command never holds the agent. Foreground output is not streamed while waiting. After a background launch, continue independent work or end the turn; completion arrives automatically. `bash_status` is a diagnostic snapshot, not a way to poll for completion; use `bash_cancel` to stop a job. At most eight jobs per session run concurrently. Background jobs are attended session work, not durable Run jobs.

Jobs survive session shutdown, `/reload`, and PI WEB session-daemon restarts, including promotion. Each job runs under a small detached runner (`runner.mjs`) that leads its own process group, so it no longer belongs to the Pi process or daemon that started it. The runner writes the output log and a one-shot exit record, and kills the job's process group at its `timeout` or, without one, after a 12-hour maximum lifetime. Processes the command deliberately moves into a new session (`setsid`) are outside that group, as with native bash.

The job registry lives at `~/.pi-workbench/background-bash/jobs/<id>/` (directories `0700`, files `0600`):

- `job.json`: ID, command, description, working directory, shell, owner Pi session ID and session file, runner PID and process group, start and expiry times;
- `claim`: written once by the runner before it runs the command, with its PID; a second runner for the same job exits without running it;
- `output.log`: combined stdout and stderr;
- `exit`: exit code, error (timeout, maximum lifetime, vanished runner), or cancellation, written once;
- `delivered`: created once when Pi starts the completion message in the Chat. Sending only queues it, so the marker waits for that acknowledgement.

When a session starts or reloads, the extension reattaches that session's jobs by Pi session ID: running jobs return to Activity and `bash_status`/`bash_cancel`, and jobs that finished meanwhile deliver their normal completion message. A completion without `delivered` is resent on the next attach or when the agent settles, so a cleared queue or a daemon exit cannot lose it; once acknowledged it is never resent. A turn-triggering completion that arrives while a context checkpoint is pending or compacting waits for the session's checkpoint barrier and is sent after the checkpoint is delivered. Completions are delivered only while the owning session is open. Cancellation kills the job's process group after checking that the recorded process is still this job's runner. Records are pruned a week after the job finished.

Legacy Subagents and Workers retain native foreground bash so they cannot exit before a command finishes, and wait with `wait-until` (`extensions/subagent/README.md`); one-shot print/JSON Pi also runs foreground. The `!` user-shell shortcut is unchanged. This extension cannot detach a bash call that was already running before it loaded. A new Pi session or extension reload is needed to activate changes; no PI WEB daemon restart is required.

Durable Chats bind the same runner and registry (`packages/durable-pilot/src/background-bash.ts`): the job ID derives from the Chat and the tool call, the launch intent is committed before the spawn, and the runner's claim makes a rerun after a host kill reattach instead of launching again. Durable records the delivery receipt; the `delivered` marker is not used there.


## Durable child pilot (not legacy parity)

Durable child `bash` waits for the **same runner** instead of using native bash or returning an asynchronous job handle.
It defaults to **1200 seconds**; a positive finite `timeout` override is validated before admission. Start and expiry
commit before launch. The job claim prevents a second launch after host loss; restore stays paused until resumed and
never extends expiry. An expired intent cannot start writes. Missing runner/cleanup evidence is failure/unknown, not success.

Child arguments and the native programmatic result remain compatible: `output`, `truncated`, optional `fullOutputPath`,
and `exitCode`. The retained tail uses native bash's output limits; a truncated result names a complete sanitized sidecar,
not the private raw runner log. Nonzero exits retain their output and code; timeout/abort/supervision failures are errors,
not invented successful exit codes. The lead's background API is unchanged; no child tools are added.

Owned commands carry an inherited identity marker. The runner finds their group, descendants and marked detached
processes (including Playwright Chrome), verifies PID/start identity before signals, then TERM → 1-second grace → KILL.
It records cleanup before the result; early shell exit with remaining descendants is an error, not a detached writer.
This is trusted local supervision, not containment against deliberate environment clearing plus daemonization.
A command may hand off a helper meant to outlive it (an SSH master) by starting it outside the runner's process group
with `PI_MANAGED_COMMAND_RELEASED=<token>` in place of `PI_MANAGED_COMMAND_OWNER=<token>`, same value. The runner
leaves it and its descendants running and lists them in the result's `cleanup.released` as PID/start identities only.
A group member is never released, nor is a marker with another job's token. **Whoever releases a process bounds its
lifetime** (for example `ControlPersist`); the runner does not.
Legacy runner/group semantics are unchanged. The inherited marker is not a credential; process environments are never
published or retained in the ownership receipt (`owned.json` contains only PID/start identities).

After **600 seconds** without captured stdout/stderr, the existing child-stuck reporter sends one redacted
“no observed progress” notice to the parent, deduplicated per command and revalidated before admission. `progressLog`
explicitly names redirected output to observe. Silence is suspicion only; neither output nor restart renews the deadline.
The **900-second** Durable `wait-until` cap stays inside the command default; a silent wait may receive a notice but is
not killed for silence. The existing **1800-second report quiet window + 600-second unread-request grace** still catches
non-command waits, with no duplicate alarm for a managed command. Run the actual work in `bash`, never `cmd &`.
Cancel/end/settle require cleanup; normal host close is restart, not cancellation. Old native uncertain effects remain guarded.

Prove this with `npm --prefix packages/durable-pilot run test:bash-atelier` (install the pinned Playwright dev dependency
and its Chromium once with `cd packages/durable-pilot && npx playwright install chromium`). Tests use seconds, disposable
hosts, a real detached browser, an unrelated sentinel, restart fault windows, cancellation and Worker continuation.

## Write fence (macOS)

On macOS the runner starts every command under Apple's `/usr/bin/sandbox-exec` with a Seatbelt profile built in
`sandbox.mjs` from the job record and the runner's own environment, never from files a command can write. No proven
sandbox means the command does not start (`Sandbox unavailable: …; the command was not run`).

- **Writable:** the chat's git checkout or linked worktree (its `hooks`, `config`, `info`, other worktrees' metadata,
  owner and creator records and `.git` link stay read-only), linked worktrees whose creation receipt
  (`pi-creator.json`) names the chat (or, for a chat started in `scratch/<ws>`, that Workstream), the chat's Workstream scratch folder, `PI_TMP` (the command's `TMPDIR`
  is a short link to it, `~/.pi-workbench/t/<hash>`, so Unix sockets there stay under the 104-byte limit), and the agents' own caches. Never home, `~/IdeaProjects`, Pi's own state, the shared system temp
  folders (unfenced Pi loads compiled extensions from there) or Thomas's caches (`~/Library/Caches`, `~/.cache`,
  `~/.gradle`, `~/.m2`, `~/.npm`, `~/Library/pnpm`): unfenced tools load code from them, e.g. Python's `.pyc` files.
- **Agent caches:** `~/.pi-workbench/sandbox-caches`, through `GRADLE_USER_HOME` (with Thomas's jars read-only via
  `GRADLE_RO_DEP_CACHE`), `MAVEN_USER_HOME` and `-Dmaven.repo.local`, `npm_config_cache`, `pnpm_config_store_dir` and
  `PLAYWRIGHT_BROWSERS_PATH`, `pnpm_config_cache_dir`, `XDG_CACHE_HOME`, `PYTHONPYCACHEPREFIX`, `GOCACHE` and
  `CLANG_MODULE_CACHE_PATH`, plus `XDG_RUNTIME_DIR` (`~/.pi-workbench/sandbox-runtime`, one 0700 folder the runner
  makes and checks, where pnpm 12 keeps its store operation locks instead of the unwritable `/tmp`; fenced commands
  write its contents but cannot replace it or change its mode); a tool without such a setting just does not cache inside the fence. Playwright's browsers are seeded once as an APFS clone of Thomas's; a first fenced build
  downloads its other dependencies again.
- **Git history:** nothing in a granted `.git/objects` can be deleted, renamed or overwritten, except git's temporary,
  lock and keep files, and `objects/info/alternates` is locked (it would let the owner's next gc drop the history);
  commits, branches and fetches work, `git gc` and repack fail inside the fence.
- **Reads:** commands and Durable’s `read`, `grep`, `find`, `ls` and edit preview can read project files and Durable
  session databases. They cannot read `~/Desktop`, `~/Documents`, `~/Downloads`, `~/Pictures`, the `Containers`,
  `Group Containers`, `Mail`, `Messages` and `Safari` folders in `~/Library`, or `~/.pi/agent/auth.json`, including
  through symlinks. A nested Pi (including `scripts/pi-eval.mjs`) cannot use that login inside the fence.
- **Unreachable:** PI WEB's port and the sockets in its data folder (they run `!` commands and prompts unfenced), other
  jobs' host-operation sockets, and Apple events.
- **Host operations** (`host-ops.mjs`): shims first on the fenced PATH forward `workstreams` (no `@file` arguments) and
  `wt switch --create <branch> [--base <ref>]` to the job's runner, which runs them outside the fence with its own
  environment; the worktree is created with git in `<repo>.worktrees/<branch>` beside the main checkout under `~/IdeaProjects`, and the runner writes its
  cleanup owner record (`pi-owner.json`) and its creation receipt (`pi-creator.json`: the creating chat and only the
  Workstream whose scratch folder it started in). Only the receipt grants access: the cleanup record accumulates owners
  (`mac-storage-workspaces --record-owner`), so it would let a chat adopt a worktree it did not create.
  Inside the fence the real `wt` runs only `list`, `switch` and `config` (global options in exact forms only), so no
  `wt remove`, `merge`, `step prune` or alias half-empties a worktree; Thomas removes worktrees, or a Chat with full
  access does (the withdrawn removal host operation could be steered outside the fence).
- **Full access:** a Durable Chat's `/full-access on` runs its lead's commands unfenced after the owner clicks Allow in
  a macOS dialog the host shows; Subagents stay fenced; it ends with `/full-access off` or when the host stops.
- **File-edit tools:** a Durable Chat's `write` and `edit` calls meet the same fence before they run (`writeRefusal`,
  bound in durable-pilot's `extensions.ts`): the grants its commands would get, links resolved, plus nothing inside a
  `.git/objects` folder. `/full-access` lifts it for the lead as for its commands; a host already inside a fence leaves
  its tools to the outer one.
- A fenced command that starts Pi or this runner again runs under the outer fence (`alreadyFenced`).
- **Known limit:** `swift build` fails inside the fence (it nests its own sandbox, writes `~/.swiftpm` and the
  per-user temp folder it gets from macOS, not `TMPDIR`); a Chat that builds Swift uses full access.
