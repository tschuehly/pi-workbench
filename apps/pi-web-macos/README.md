# Pi Workbench for macOS

The native wrapper works today, but it still loads the legacy PI WEB client. The first
[Workbench UI slice](../../docs/plans/workbench-ui.md) will replace that web root with one Chat per
window: graphical text input first, then a toggleable workspace file pane.

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

Startup failures appear in the app window with **Open logs**, **Run doctor**, and **Retry** actions.

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

Use the same controls from a terminal:

```sh
pi-web status --json
pi-web doctor --json
pi-web restart --component ui
pi-web restart --component sessiond
```

Same-origin links stay inside the app. Other links open in the default browser.

## Current keyboard behavior

The native wrapper still exposes tabs:

- `Command-N` — new window
- `Command-T` — new tab
- `Command-W` — close the current tab or window
- `Command-R` — reload
- `Command-[` and `Command-]` — browser history
- `Command-Shift-[` and `Command-Shift-]` — previous or next tab

Slice 1 keeps new window, close, reload, and history navigation. It removes every tab command and
Window-menu tab action so one native window always represents one Chat.
