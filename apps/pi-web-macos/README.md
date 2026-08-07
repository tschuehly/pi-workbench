# Pi Workbench for macOS

A small native macOS app that displays PI WEB using `WKWebView`. It provides native windows,
macOS window tabs, shared website data, standard navigation shortcuts, and restricted same-origin
navigation. It remains a client of PI WEB and does not own Pi sessions or Workbench Run state.

## Run the development environment

Keep the PI WEB checkout next to this repository at `../pi-web`, install the app as described below,
then open it from Finder, Spotlight, the Dock, or:

```sh
pi-web-mac
```

`pi-web-mac` only activates the installed bundle through macOS Launch Services. The AppKit process
opens a window immediately, checks PI WEB's typed lifecycle status asynchronously, starts already
installed services when needed, and loads the development UI at `http://127.0.0.1:8505` after the UI
and session daemon are healthy. PI WEB frontend changes continue to use Vite hot module replacement.
Re-run the app installer after changing native Swift code.

The old entry point remains as a compatibility adapter:

```sh
./apps/pi-web-macos/Scripts/boot-dev.sh
```

It delegates installation and startup to `pi-web install --dev` and `pi-web start`, then activates the
same installed app. It does not create a Workbench-owned supervisor or another session daemon.

## Install a Finder launcher

Install **Pi Workbench.app** in your user Applications folder:

```sh
./apps/pi-web-macos/Scripts/install-app.sh
```

The installer builds the release `PIWebMac` executable, records the resolved PI WEB checkout and CLI
inside the bundle, preflights `pi-web status --json`, installs the split development services, and
atomically replaces the prior app. Re-run it after moving either checkout or changing native code.

You can then launch Pi Workbench from Finder, Spotlight, the Dock, or `pi-web-mac`. Startup failures
appear in the visible app window with **Open logs**, **Run doctor**, and **Retry** actions.

Pass a different `.app` path to choose another installation location:

```sh
./apps/pi-web-macos/Scripts/install-app.sh "/Applications/Pi Workbench.app"
```

Set `PI_WEB_DIR` when the PI WEB checkout is elsewhere:

```sh
PI_WEB_DIR=/path/to/pi-web ./apps/pi-web-macos/Scripts/boot-dev.sh
```

PI WEB dependencies must already be installed with `npm install`.

## Lifecycle actions

Use **Reload** to reload only the current web view. **Restart PI WEB UI** replaces the UI service
without restarting the session daemon. **Restart Session Runtime…** warns before replacing sessiond
because in-flight turns, asks, and terminals cannot migrate. **Open Lifecycle Status** shows the typed
status and doctor reports.

For terminal diagnostics, use:

```sh
pi-web status --json
pi-web doctor --json
pi-web restart --component ui
pi-web restart --component sessiond
```

The wrapper keeps same-origin navigation inside the app and opens other links in the default browser.

## Shortcuts

- `Command-N`: new window
- `Command-T`: new tab
- `Command-W`: close the current tab or window
- `Command-R`: reload
- `Command-[` and `Command-]`: browser history
- `Command-Shift-[` and `Command-Shift-]`: previous or next tab

Use **Window > Move Tab to New Window** and **Window > Merge All Windows** for native macOS tab
management.
