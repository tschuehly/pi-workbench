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
run the full installer only when interrupting active sessions is acceptable. `install --dev`
replaces services, including the session daemon. For an existing installation, prefer `--app-only`.

```sh
./apps/pi-web-macos/Scripts/install-app.sh
```

The installer:

1. builds the release `PIWebMac` executable;
2. records the resolved PI WEB checkout and CLI in the app bundle;
3. installs the split development services through `pi-web install --dev`; and
4. atomically replaces the previous app.

The default destination is your user Applications folder. To choose another location:

```sh
./apps/pi-web-macos/Scripts/install-app.sh "/Applications/Pi Workbench.app"
```

If PI WEB is not at `../pi-web`, set its location for the installer:

```sh
PI_WEB_DIR=/path/to/pi-web ./apps/pi-web-macos/Scripts/install-app.sh
```

After changing native Swift code, replace only the app without touching running services:

```sh
./apps/pi-web-macos/Scripts/install-app.sh --app-only
```

This preserves the existing bundle's checkout, CLI, and server URL unless explicitly overridden.
The app-only option invokes no lifecycle commands.

## Open the development app

Launch **Pi Workbench.app** from Finder, Spotlight, or the Dock. From a terminal, use:

```sh
pi-web-mac
```

`pi-web-mac` activates the installed bundle through macOS Launch Services. The app opens a window
immediately and probes `/api/pi-web/version` through the configured UI URL. It loads
`http://127.0.0.1:8505` only when both the web API and session daemon report available, not stale,
and running from the configured checkout.
If unavailable, it uses `pi-web status`'s exit code to decide whether to run `pi-web start`.
It does not parse CLI display text or require the unsupported `status --json` option. PI WEB frontend changes continue
to use Vite hot module replacement.

The window recovers on its own. An unreachable server, a restarting half, or a partially running
stack shows progress and keeps probing runtime readiness, then reloads the page once PI WEB reports
available again. A prolonged readiness wait shows **Open logs**, **Run doctor**, and **Retry**
while continuing to probe. Configuration or CLI failures require **Retry** after correction.

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
- **About Service Restarts…** explains that the current CLI ignores `--component`; it restarts
  the entire stack, including active sessions. The menu invokes no lifecycle command.
- **Open Lifecycle Status** shows the CLI's human-readable service status; **Run doctor** shows its
  diagnostic report.

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

Two readiness limitations to distinguish:

- The API watcher can outlive its own server process — a killed child, or the dev port still held
  when it starts. `tsx watch` then waits for a file change instead of restarting, so the API stays
  unreachable while the UI serves 502s.
- `pi-web status` reports service-manager process state, not API responsiveness. The wrapper now
  checks the runtime endpoint instead. Check `curl -sf http://127.0.0.1:8505/api/pi-web/version`
  when the UI shows 502.

Terminal diagnostics (no service mutation):

```sh
pi-web status
pi-web doctor
```

`pi-web restart` restarts the whole stack and can interrupt all active sessions. Do not use
`--component` to attempt a UI-only restart with the current CLI.

Regression checks:

```sh
bash apps/pi-web-macos/Scripts/native-notifications.test.sh
bash apps/pi-web-macos/Scripts/readiness.test.sh
bash apps/pi-web-macos/Scripts/install-app.test.sh
PI_WEB_TEST_URL=http://127.0.0.1:8505 bash apps/pi-web-macos/Scripts/readiness.test.sh
```

The optional live check probes readiness without starting or restarting services. Set
`PI_WEB_TEST_CHECKOUT` as well to verify the running checkout identity.

The native startup regression opens an isolated fixture app and checks diagnostics during a 502,
an incompatible response, and Retry recovery. It requires macOS Accessibility permission for the
terminal, uses a fake CLI and local HTTP server, and does not touch installed services:

```sh
python3 apps/pi-web-macos/Scripts/startup.test.py
```

Same-origin links stay inside the app. Other links open in the default browser.

## Keyboard behavior

- `Command-N` — open another independent Chat window
- `Command-W` — close the current window
- `Command-R` — reload the current Chat
- `Command-[` and `Command-]` — browser history

Native tabs and their menu commands are disabled so one macOS window always represents one Chat.
