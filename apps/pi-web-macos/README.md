# Pi Workbench for macOS

The native wrapper loads one Pi Chat per window. A new window first asks for a workspace and a new
or existing session, then mounts PI WEB's Chat and PromptEditor without the legacy application shell.
The file pane remains deferred to the next [Workbench UI checkpoint](../../docs/plans/workbench-ui.md).

The app uses AppKit and `WKWebView` for native windows, shared website data, lifecycle status, and
same-origin navigation. PI WEB owns sessions and runtime state. The wrapper owns neither Pi
sessions, Workstreams, nor Runs.

## Install the app

Keep PI WEB beside this repository. The installer prefers `../pi-web.durable-lifecycle` when present,
then `../pi-web`; `PI_WEB_DIR` overrides both. Install PI WEB's dependencies with `npm install`, then
run:

```sh
./apps/pi-web-macos/Scripts/install-app.sh
```

The installer:

1. builds the release `PIWebMac` executable;
2. records the resolved PI WEB checkout and CLI in the app bundle;
3. checks `pi-web status --json`;
4. installs the split development services; and
5. atomically replaces the previous app.

The default destination is your user Applications folder. To choose another location:

```sh
./apps/pi-web-macos/Scripts/install-app.sh "/Applications/Pi Workbench.app"
```

If PI WEB is not at `../pi-web`, set its location for the installer:

```sh
PI_WEB_DIR=/path/to/pi-web ./apps/pi-web-macos/Scripts/install-app.sh
```

Reinstall after moving either checkout or changing native Swift code.

## Open the development app

Launch **Pi Workbench.app** from Finder, Spotlight, or the Dock. From a terminal, use:

```sh
pi-web-mac
```

`pi-web-mac` activates the installed bundle through macOS Launch Services. The app opens a window
immediately, checks PI WEB lifecycle status, starts installed services when needed, and loads
`http://127.0.0.1:8505` after the UI and session daemon are healthy. PI WEB frontend changes continue
to use Vite hot module replacement.

The window recovers on its own. An unreachable server, a restarting half, or a partially running
stack shows progress and keeps polling lifecycle status, then reloads the page once PI WEB reports
healthy again. Failures that need a decision still show **Open logs**, **Run doctor**, and
**Retry**, and the page keeps retrying behind them.

## Compatibility entry point

The older command still works:

```sh
./apps/pi-web-macos/Scripts/boot-dev.sh
```

It delegates installation and startup to `pi-web install --dev` and `pi-web start`, then activates
the same app. It does not create another supervisor or session daemon.

If PI WEB is not at `../pi-web`, set its location explicitly:

```sh
PI_WEB_DIR=/path/to/pi-web ./apps/pi-web-macos/Scripts/boot-dev.sh
```

## Lifecycle safety

- **Reload** reloads only the current web view.
- **Restart PI WEB UI** replaces the UI service without restarting the session daemon.
- **Restart Session Runtime…** warns before replacing `sessiond`; in-flight turns, asks, and
  terminals cannot migrate.
- **Open Lifecycle Status** shows typed status and doctor reports.

## Working on the Workbench while using it

Sessions, subagents, and durable workers all live in `sessiond`. The UI service holds no session
state, so **editing UI or API code is safe**: each half of the UI service restarts itself, and the
window reconnects without losing sessions, running child Pis, or worker dispatches.

Restarting the session runtime is the destructive boundary. `sessiond` shutdown ends each session,
which the Subagent extension answers by cancelling every running execution, so a restart drops
in-flight turns, asks, terminals, background subagent results, and running worker dispatches. Worker
*identity* survives in the worker registry on disk, and the next dispatch resumes that worker's
persisted session; the interrupted dispatch does not come back. Session-runtime code therefore
changes only at a point where losing that work is acceptable.

Two known ceilings, both recoverable with `pi-web restart --component ui`:

- The API watcher can outlive its own server process — a killed child, or the dev port still held
  when it starts. `tsx watch` then waits for a file change instead of restarting, so the API stays
  unreachable while the UI serves 502s.
- `pi-web status` reports `uiDev` from process presence, so it can read `healthy` while the API port
  answers nothing. Check `curl -sf http://127.0.0.1:8504/api/pi-web/version` when the UI shows 502.
  An `unmanaged` instance in `pi-web status --json` means a leftover process from an earlier
  generation is holding the port; stop it before restarting the service.

Use the same controls from a terminal:

```sh
pi-web status --json
pi-web doctor --json
pi-web restart --component ui
pi-web restart --component sessiond
```

Same-origin links stay inside the app. Other links open in the default browser.

## Keyboard behavior

- `Command-N` — open another independent Chat window
- `Command-W` — close the current window
- `Command-R` — reload the current Chat
- `Command-[` and `Command-]` — browser history

Native tabs and their menu commands are disabled so one macOS window always represents one Chat.
