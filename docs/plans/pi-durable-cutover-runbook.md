# Pi Durable cutover runbook: the Durable instance (install, promote, roll back)


Spec: [pi-durable-cutover-spec.md](pi-durable-cutover-spec.md). First installed 17 Nov 2026 from pi-workbench `4fa8282` and pi-web `a43ca38c` (branches `feat/durable-host-slice1-20261022` and `feat/durable-chat-slice1-20261022` on the tschuehly forks).

## What the Durable instance is

| | Legacy instance | Durable instance |
|---|---|---|
| URL | http://127.0.0.1:8505/ | http://127.0.0.1:8506/ |
| Links | `~/IdeaProjects/pi-workbench.installed`, `pi-web.installed` | `~/IdeaProjects/pi-workbench.durable-installed`, `pi-web.durable-installed` |
| Builds | `~/.pi-workbench/installed/` | `~/.pi-workbench/installed-durable/` |
| Data, socket, settings | `~/.pi-web`, `~/.config/pi-web/config.json` | `~/.pi-web-durable` (`sessiond.sock`, `config.json`, `logs/`) |
| launchd labels | `com.pi-web.sessiond`, `com.pi-web.web` | `com.pi-web-durable.sessiond`, `com.pi-web-durable.web`, one `com.pi-workbench.durable-host.<family>` per open Chat family |
| New Chat | legacy Chat | Durable Chat (`PI_WEB_DURABLE_DEFAULT=1`) |

The Durable session daemon runs with `PI_WEB_DURABLE_HOST_LAUNCHD=com.pi-workbench.durable-host`: each Chat family's host is its own launchd job, with its plist and socket in `~/.pi-web-durable/hosts/` (never in `~/Library/LaunchAgents`, so nothing starts at login). Hosts outlive the daemon, and a restarted daemon reattaches them. `promote-installed` always writes this setting and refuses a PI WEB build whose daemon does not read it.

The Durable services run with `PI_WEB_PI_PACKAGE_AUTO_INSTALL=0`, so they never write `~/.pi/agent/settings.json`. `PI_WEB_DURABLE_HOST` names the Durable host inside the build folder: `~/.pi-workbench/installed-durable/pi-workbench-<sha12>/packages/durable-pilot/src/chat-host-main.ts`, never the `*.durable-installed` link. The Durable instance shares `~/.pi/agent` (logins, packages, skills) read-only and the Workstream store `~/.pi-workbench/workstreams`.

Always run the Durable commands with a `promote-installed` that knows `--instance` (this branch or later). The legacy `~/IdeaProjects/pi-workbench.installed/scripts/promote-installed` is older: it prints its usage and exits 2 on `--instance`, so it changes nothing.

## Install (first time)

Interrupts: nothing. The legacy instance keeps running; nothing ran on :8506 before.

```bash
WB=<pi-workbench sha of the pushed Durable branch>
PW=<pi-web sha of the pushed Durable branch>
git -C ~/IdeaProjects/pi-workbench fetch origin && git -C ~/IdeaProjects/pi-web fetch origin   # origin = the tschuehly forks; makes both shas resolvable
P=~/IdeaProjects/pi-workbench.feat-durable-host-slice1-20261022/scripts/promote-installed   # any checkout of the Durable branch; after install, pi-workbench.durable-installed

# Record the legacy state to compare afterwards.
launchctl print gui/$(id -u)/com.pi-web.sessiond | grep -m1 'pid ='
shasum ~/.pi/agent/settings.json ~/Library/LaunchAgents/com.pi-web.*.plist ~/.config/pi-web/config.json
readlink ~/IdeaProjects/pi-workbench.installed ~/IdeaProjects/pi-web.installed

$P --instance durable prepare $WB $PW    # builds both folders: pi-web npm ci + build; pi-workbench npm ci at the root and in packages/durable-pilot
$P --instance durable switch $WB $PW     # schedules the job in 10 s; prints its log path
wait-until --timeout 600 --file ~/.pi-workbench/installed-durable/jobs/<stamp>/job.log --match 'promoted|rollback done|ROLLBACK FAILED|refused'
```

The job copies the legacy PI WEB settings once into `~/.pi-web-durable/config.json` (read only on the legacy file; `PI_WEB_PORT=8506` overrides its port), links `~/.pi-web-durable/plugins/pi-workbench`, writes and boots the two `com.pi-web-durable.*` plists, and waits up to 90 s for the pi-workbench plugin on :8506.

## Checks after install or promotion

```bash
curl -fsS http://127.0.0.1:8506/api/plugins | grep -o '"id":"pi-workbench"[^}]*"state":"[a-z]*"'
launchctl print gui/$(id -u)/com.pi-web-durable.sessiond | grep -m1 'pid ='
# Legacy unchanged: same PID, same hashes, same links as recorded before.
launchctl print gui/$(id -u)/com.pi-web.sessiond | grep -m1 'pid ='
shasum ~/.pi/agent/settings.json ~/Library/LaunchAgents/com.pi-web.*.plist ~/.config/pi-web/config.json
readlink ~/IdeaProjects/pi-workbench.installed ~/IdeaProjects/pi-web.installed
```

Then open http://127.0.0.1:8506/, click New Chat, send a prompt: the Chat is a Durable Chat (it lists its host's capabilities; `curl -s "http://127.0.0.1:8506/api/sessions?cwd=<folder>"` shows `capabilities` on it).

Running Durable hosts, with the PID and the revision folder each runs from:

```bash
launchctl list | grep com.pi-workbench.durable-host
node -e 'for (const c of Object.values(require(process.env.HOME + "/.pi-web-durable/session-runtimes.json").chats)) if (c.host) console.log(c.host.label, c.host.pid, c.host.revision)'
```

After a promotion the same labels and PIDs are still there, with their old `revision` until the family moves to new host code (C3).

## Host lifetime

- A Chat stays on the host code it started with. While a newer build is live, the Chat shows "Host `<sha>` (new Chats run `<sha>`)" with **Upgrade host** and **Upgrade now**. No Chat ever moves to older Pi Durable code, or when either Pi Durable version cannot be read.
- **Upgrade host** refuses while the Chat is busy (running turn, queued input, open question, children, background bash, Atelier Pages); otherwise it closes the host in order and the next message starts it on current code.
- **Upgrade now** works whatever runs. The button names what repeats ("Upgrade now (repeats: the running turn, running children)" or "nothing repeats"). The host closes in order (telemetry `session.shutdown` reason `upgrade-restart`), the new host starts at once and resumes by itself (`session.restart` reason `upgrade-restart`). Recovery is the crash path: an in-flight answer is requested again, a safe tool reruns, an unsafe foreground tool is held for the owner with its output kept and never rerun; children, background bash, open questions, queued input and Atelier Pages carry over. If the new host does not start, the Chat goes back to its old host code and the error says so. Onto newer Pi Durable code the closed store is copied first (`<store>.pre-upgrade`), and a failed start puts that copy back before the old code reopens it; the attempted store stays beside it as `<store>.failed-upgrade`. A second click joins the upgrade already running. Each step is recorded in `session-runtimes.json`: a daemon that restarts mid-upgrade resends the owed resume, or rolls back. A host on code from before Upgrade now cannot resume by itself: it waits, paused, for the next message.
- An idle close (below) also moves a pinned Chat: it reopens on current code. The pin moves rather than goes away, so a daemon rolled back to older code still reopens the Chat on the code that last opened its store.
- Automatic upgrade, off by default (`PI_WEB_DURABLE_AUTO_UPGRADE=1` in the daemon's environment): a pinned Chat shows "Upgrade pending" with **Cancel**, and restarts as Upgrade now does once only work that survives a restart remains (open questions, background bash, watchers, Atelier Pages). A running turn, queued input, a running tool or children make it wait. The host makes the final check itself as it closes, with input held off, and refuses if work arrived; host code from before that check is never pending. Cancel keeps that Chat pinned across daemon restarts, until a newer build is live. A failed start rolls back and leaves an inbox notice.
- Ending a Chat (Stop) closes its host in order and cancels its background bash jobs. If the host has crashed, Stop cancels the jobs with a one-off `--end-jobs` run of the host code, without starting the model. `POST /api/sessions/durable-hosts/stop` does that for every Durable Chat (no button).
- A host that has been idle for 2 h with nothing pending closes by itself; the Chat reopens on its next message. A host that served Atelier Pages stays until its Chat ends.
- A lost daemon (promotion, crash, kill) never ends a host or its jobs.
- Host launchd plists carry the daemon's environment minus variables named like secrets (`*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_CREDENTIAL(S)`). Commands in Durable Chats therefore don't see e.g. `GH_TOKEN`; tools sign in through their own config.

## Promote

```bash
P=~/IdeaProjects/pi-workbench.durable-installed/scripts/promote-installed
$P --instance durable switch <wb-sha> <pw-sha>              # full: both services
$P --instance durable switch-workbench <wb-sha>             # Workbench plugin and skills only
$P --instance durable switch-web <pw-sha>                   # PI WEB web/API only
```

- `switch` keeps Durable Chats running: it restarts only `com.pi-web-durable.sessiond` and `.web`, never a `com.pi-workbench.durable-host.*` job. Streams, subagents, Workers, background bash and open questions go on in their hosts; the new daemon reattaches every host and browsers reconnect. Chats opened before the first switch with launchd hosts ran as the daemon's children; that one switch still closes them, and they reopen paused.
  - Before it changes anything, `switch` checks that the new daemon can reattach every running host: same host protocol as each host's revision folder, and launchd hosts on. Otherwise it refuses (exit 7, nothing changed) and lists the families, e.g. `com.pi-workbench.durable-host.<family>: protocol 2, revision <folder>`. The job checks again when it starts. Close those Chats first, or wait for C3's family upgrade; `--force` does not skip this check.
  - It refuses (exit 3) while the Durable daemon itself has subagents, workers or commands under it; hosts and their children do not count. `--force` (after `--instance durable`) skips that check.
  - New families start on the new build's Durable host from this switch on; running families keep their revision.
- `switch-workbench` interrupts nothing: it repoints `pi-workbench.durable-installed`. The running daemon keeps the Durable host it started with until the next `switch`.
- `switch-web` restarts only `com.pi-web-durable.web`; browsers reconnect. It refuses (exit 5) when the session daemon's code changed; use `switch` then.

Each successful command prunes `~/.pi-workbench/installed-durable/` (keeps live, the rollback, every build a running Durable host runs from, builds named by the Durable or host plists or a Workstream, in use, or retired after the oldest running Pi process started). It removes nothing when it cannot read `session-runtimes.json`.

## Roll back

- Automatic: a `switch` whose services do not become healthy in 90 s restores the previous Durable plists, links and plugin link, boots them and checks health (`rollback done` in the job log, exit 1; `ROLLBACK FAILED` means exit 4: check `~/.pi-web-durable/logs/`). It never touches a host: the restored daemon reattaches them.
- To the previous revision (after 1.5.2, see the two-step rule below): each command prints its `roll back:` line; for `switch`, use the `wb=` and `pw=` of the earlier `start` line in `~/.pi-workbench/installed-durable/jobs/*/job.log`:
  `$P --instance durable switch <previous-wb-sha> <previous-pw-sha>`
- Back to the legacy instance: open http://127.0.0.1:8505/. Nothing to switch; Durable Chats stay readable on :8506. To stop the Durable instance:
  `launchctl bootout gui/$(id -u)/com.pi-web-durable.web; launchctl bootout gui/$(id -u)/com.pi-web-durable.sessiond`
  Its hosts keep running (and keep working) until stopped one by one, which interrupts that family's Chats: `launchctl bootout gui/$(id -u)/com.pi-workbench.durable-host.<family>` for each label from `launchctl list` above.
  Start it again: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pi-web-durable.sessiond.plist; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pi-web-durable.web.plist`
- **Pi Durable 1.5.2 → 1.4.0 is one-way for every Chat 1.5.2 has opened.** 1.5.2 upgrades the Chat's store (`pi.live` v3), and a 1.4.0 host refuses to open it ("has newer version 3 than 1"). After rolling the instance back to a 1.4.0 build, such a Chat stays on its pinned 1.5.2 host: it shows "Host `<sha>` (new Chats run `<sha>`)", and **Upgrade host** refuses ("This Chat was opened by a newer Pi Durable (1.5.2); the current host is 1.4.0") and leaves it running and readable. Do not delete the 1.5.2 build while such Chats exist (prune keeps it while a Chat is pinned to it; never remove it by hand): without it, the Chat falls back to the 1.4.0 host and cannot be opened until that build is reinstalled. The store itself stays intact.
- **Promote 1.5.2 in two steps, so every rollback keeps the guard.** The refusal above lives in PI WEB, not in the host. Step 1: promote the PI WEB build that has the guard (pi-web `cbcddf45` or later) with the 1.4.0 host. Step 2: promote the 1.5.2 host with that same PI WEB build. Rolling back step 2 then restores the guarded PI WEB with the 1.4.0 host. Never roll PI WEB back past step 1 while a Chat 1.5.2 has opened exists: an older PI WEB's Upgrade host closes the 1.5.2 host, drops the pin and opens the Chat under 1.4.0, which refuses it; the Chat is unreadable until it is upgraded again.

## Prune by hand

```bash
$P --instance durable prune           # dry run: lists keep/remove
$P --instance durable prune --apply
```

A legacy `promote-installed prune` looks only at `~/.pi-workbench/installed/` and never removes Durable builds.

## Known limits

- `pi-web install|restart|status|doctor` know only the legacy labels (`com.pi-web.*`, logs in `~/.pi-web/logs`). Never run them for the Durable instance: they act on the legacy one. That is also why `promote-installed` writes the Durable plists itself (same keys as `pi-web install`).
- A legacy `promote-installed switch` ignores every process of the Durable instance (anything under `installed-durable/`), so open Durable Chats never block a legacy promotion.
- Durable Chats load skills and prompts from the packages in the shared `~/.pi/agent/settings.json`, which name the legacy builds.
- Workstream "continue in Chat" links still open the legacy instance.
- `~/.pi-web-durable/config.json` is copied from the legacy settings once; later changes on either instance stay there.
- Disk: each Durable pi-workbench build carries about 0.8 GB of `node_modules` (root peers plus `packages/durable-pilot`).
- A protocol change between the running hosts and a new PI WEB build blocks `switch` (exit 7) until those families close or are upgraded.
- Builds a stopped Chat is pinned to are kept by prune (about 0.8 GB each) until that Chat is upgraded.
- A host running code from before the end-cancels-jobs fix ignores that signal: its jobs survive Stop until the Chat is upgraded.
- A rollback to a Durable install from before launchd hosts would restore a daemon that forks hosts and does not reattach launchd ones; those keep running unattached. Roll back only to builds that have launchd hosts.
- After a failed-health rollback, prune lists the failed build as `rollback`. Remove it by hand (`git -C ~/IdeaProjects/pi-web worktree remove --force <folder>`, then its `.prepared` marker) so a later manual roll back cannot pick it.
- Memory (AC8, 17 Nov trial): each idle Durable Chat costs about 219 MiB against 65 MiB legacy (its own host process, about 163 MiB): 2.39× legacy at 10 Chats, 2.74× at 20. The 2 h idle close bounds it.
