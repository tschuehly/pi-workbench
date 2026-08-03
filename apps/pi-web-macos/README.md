# Pi Workbench for macOS

A small native macOS app that displays PI WEB using `WKWebView`. It provides native windows,
macOS window tabs, shared website data, standard navigation shortcuts, and restricted same-origin
navigation. It remains a client of PI WEB and does not own Pi sessions or Workbench Run state.

## Run the development environment

Keep the PI WEB checkout next to this repository at `../pi-web`, then run:

```sh
./apps/pi-web-macos/Scripts/boot-dev.sh
```

The script starts PI WEB's server, session daemon, plugin watcher, and Vite client; waits for the
development UI at `http://127.0.0.1:8505`; and launches the macOS wrapper. It reuses an existing
development server and stops only a server it started.

PI WEB frontend changes use Vite hot module replacement. Changes under `Sources/PIWebMac/` or to
`Package.swift` automatically rebuild and relaunch the native wrapper through `fswatch`. Install the
watcher with `brew install fswatch` when it is not already available.

The user-local `pi-web-mac` command runs the same complete stack from any directory:

```sh
pi-web-mac
```

## Install a Finder launcher

Install **Pi Workbench.app** in your user Applications folder:

```sh
./apps/pi-web-macos/Scripts/install-app.sh
```

You can then launch Pi Workbench from Finder, Spotlight, or the Dock without opening a terminal. The
app starts the same development stack as `pi-web-mac`. Startup failures appear as a macOS alert,
with details in `~/Library/Logs/PiWorkbench/launcher.log`.

Pass a different `.app` path to choose another installation location:

```sh
./apps/pi-web-macos/Scripts/install-app.sh "/Applications/Pi Workbench.app"
```

Re-run the installer after moving this repository because the generated launcher records its current
location.

Verify paths and requirements without starting anything:

```sh
pi-web-mac --check
```

Set `PI_WEB_DIR` when the PI WEB checkout is elsewhere:

```sh
PI_WEB_DIR=/path/to/pi-web ./apps/pi-web-macos/Scripts/boot-dev.sh
```

PI WEB dependencies must already be installed with `npm install`.

## Run the wrapper only

The wrapper defaults to the installed PI WEB address at `http://127.0.0.1:8504`:

```sh
cd apps/pi-web-macos
swift run PIWebMac
```

Set `PI_WEB_URL` to use another trusted instance. The wrapper keeps same-origin navigation inside
the app and opens other links in the default browser.

## Shortcuts

- `Command-N`: new window
- `Command-T`: new tab
- `Command-W`: close the current tab or window
- `Command-R`: reload
- `Command-[` and `Command-]`: browser history
- `Command-Shift-[` and `Command-Shift-]`: previous or next tab

Use **Window > Move Tab to New Window** and **Window > Merge All Windows** for native macOS tab
management.
