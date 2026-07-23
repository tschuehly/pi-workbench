# PI WEB for macOS

A small native macOS wrapper that displays PI WEB using `WKWebView`. It provides native windows,
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

The user-local `pi-web-mac` command runs the same complete stack from any directory:

```sh
pi-web-mac
```

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
