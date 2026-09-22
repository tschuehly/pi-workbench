#!/usr/bin/env python3
"""Opt-in macOS UI regression; needs Accessibility permission. Uses only isolated fixtures."""
import http.server
import json
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import threading
import time

app = Path(__file__).resolve().parent.parent
subprocess.run(["swift", "build", "--package-path", str(app), "-c", "release"], check=True)
bin_dir = subprocess.check_output(["swift", "build", "--package-path", str(app), "-c", "release", "--show-bin-path"], text=True).strip()

with tempfile.TemporaryDirectory(prefix="pi-web-startup-test-") as root:
    log = Path(root, "cli.log")
    cli = Path(root, "cli")
    cli.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$PI_WEB_TEST_LOG"\ncase "$1" in\nstatus) echo "PI WEB services: development (LaunchAgents)";;\ndoctor) echo "fixture doctor report";;\n*) exit 42;;\nesac\n')
    cli.chmod(0o755)
    mode = "waiting"

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/api/pi-web/version":
                component = {"available": True, "stale": False, "installation": {"path": root}}
                body = json.dumps({"packageName": "@jmfederico/pi-web", "components": {"web": component, "sessiond": component}}).encode()
                if mode == "malformed":
                    body = b"not a version report"
                self.send_response(502 if mode == "waiting" else 200)
                self.send_header("Content-Type", "application/json")
            else:
                body = b"<title>PIWebStartupFixture</title><h1>Fixture ready</h1>"
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    executable = Path(root, "PIWebStartupFixture")
    shutil.copy2(Path(bin_dir, "PIWebMac"), executable)
    process = subprocess.Popen([str(executable)], env={**os.environ,
        "PI_WEB_DIR": root, "PI_WEB_CLI": str(cli), "PI_WEB_TEST_LOG": str(log),
        "PI_WEB_URL": f"http://127.0.0.1:{server.server_port}"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def ax(command):
        script = f'tell application "System Events"\ntell (first application process whose unix id is {process.pid})\n{command}\nend tell\nend tell'
        return subprocess.run(["osascript", "-e", script], text=True, capture_output=True, timeout=10)

    def await_text(text, command="get name of every window"):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            result = ax(command)
            if result.returncode == 0 and text in result.stdout:
                return
            if process.poll() is not None:
                raise AssertionError("Fixture app exited")
            time.sleep(0.2)
        details = ax('get entire contents of window "Pi Workbench"').stdout
        raise AssertionError(f"Did not observe {text!r}: {result.stderr or result.stdout}\n{details}")

    try:
        await_text("Pi Workbench")
        # Queue must remain available while HTTP readiness returns 502, not get stuck polling.
        result = ax('click menu item "Open Lifecycle Status" of menu 1 of menu bar item "PI WEB" of menu bar 1')
        assert result.returncode == 0, result.stderr
        await_text("PI WEB Lifecycle Status")
        mode = "malformed"
        await_text("incompatible response", "get entire contents of window \"Pi Workbench\"")
        # The native failure page's doctor action must also run while unready.
        def press_link(name):
            result = ax(f'''set elements to entire contents of window "Pi Workbench"
repeat with element in elements
if role of element is "AXLink" and name of element is "{name}" then
perform action "AXPress" of element
exit repeat
end if
end repeat''')
            assert result.returncode == 0, result.stderr
        press_link("Run doctor")
        await_text("PI WEB Doctor")
        mode = "ready"
        press_link("Retry")
        await_text("Fixture ready", 'get entire contents of window "Pi Workbench"')
        commands = log.read_text().splitlines()
        assert "doctor" in commands and "status" in commands, commands
        assert all(command in ("status", "doctor") for command in commands), commands
        print("PASS: plain-text CLI status, responsive diagnostics during wait, terminal failure, and Retry to ready; no service mutations")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        server.shutdown()
        server.server_close()
