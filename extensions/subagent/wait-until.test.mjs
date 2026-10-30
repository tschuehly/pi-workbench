import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./wait-until.mjs", import.meta.url).pathname;
const later = (ms, fn) => setTimeout(fn, ms);

function waitUntil(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "--every", "0.05", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => resolve({ code, out }));
  });
}

const dir = mkdtempSync(join(tmpdir(), "wait-until-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test("returns once a file appears, silent until then", async () => {
  const file = join(dir, "done");
  later(150, () => writeFileSync(file, ""));
  const { code, out } = await waitUntil("--timeout", "5", "--file", file);
  assert.equal(code, 0);
  assert.match(out, /file .*done exists/);
  assert.equal(out.trim().split("\n").length, 1, "no progress output while waiting");
});

test("matches a log line written later, even before its newline", async () => {
  const file = join(dir, "build.log");
  writeFileSync(file, "[INFO] compiling\n");
  later(100, () => appendFileSync(file, "[INFO] tests\n"));
  later(200, () => appendFileSync(file, "[INFO] BUILD FAILURE"));
  const { code, out } = await waitUntil("--timeout", "5", "--file", file, "--match", "BUILD (SUCCESS|FAILURE)");
  assert.equal(code, 0);
  assert.match(out, /\[INFO\] BUILD FAILURE/);
});

test("rescans a log that was truncated and rewritten", async () => {
  const file = join(dir, "rewritten.log");
  writeFileSync(file, "old run line one\nold run line two\n");
  later(150, () => writeFileSync(file, "DONE\n"));
  const { code, out } = await waitUntil("--timeout", "5", "--file", file, "--match", "^DONE$");
  assert.equal(code, 0);
  assert.match(out, /DONE/);
});

test("returns when a process exits; times out with exit 124 while it runs", async () => {
  const sleeper = spawn("sleep", ["30"]);
  try {
    const running = await waitUntil("--timeout", "0.3", "--pid", String(sleeper.pid));
    assert.equal(running.code, 124);
    assert.match(running.out, /timed out after 0\.3s.*pid \d+ still running/s);
    later(100, () => sleeper.kill());
    const exited = await waitUntil("--timeout", "5", "--pid", String(sleeper.pid));
    assert.equal(exited.code, 0);
    assert.match(exited.out, /pid \d+ exited/);
  } finally { sleeper.kill(); }
});

test("the first of several conditions wins", async () => {
  const file = join(dir, "never.log");
  writeFileSync(file, "still building\n");
  const { code, out } = await waitUntil("--timeout", "5", "--file", file, "--match", "BUILD", "--pid", "999999");
  assert.equal(code, 0);
  assert.match(out, /pid 999999 exited/);
});

test("reruns a command until it succeeds and prints its output; reports the last failure on timeout", async () => {
  const marker = join(dir, "ready");
  later(150, () => writeFileSync(marker, "green"));
  const ok = await waitUntil("--timeout", "5", "--cmd", `cat ${marker}`);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /command succeeded/);
  assert.match(ok.out, /green/);
  const failing = await waitUntil("--timeout", "0.3", "--cmd", "echo checks pending; exit 3");
  assert.equal(failing.code, 124);
  assert.match(failing.out, /command exit 3: checks pending/);
});

test("a hanging command cannot outlive the timeout", async () => {
  const started = Date.now();
  const { code } = await waitUntil("--timeout", "0.5", "--cmd", "sleep 30");
  assert.equal(code, 124);
  assert.ok(Date.now() - started < 5000);
});

test("waits for a URL to answer 2xx", async () => {
  let calls = 0;
  const server = createServer((_req, res) => { calls += 1; res.statusCode = calls < 3 ? 503 : 200; res.end(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/health`;
    const { code, out } = await waitUntil("--timeout", "5", "--url", url);
    assert.equal(code, 0);
    assert.match(out, /url .* answered 200/);
  } finally { server.close(); }
});

test("rejects a call without a condition or with an invalid one", async () => {
  assert.equal((await waitUntil("--timeout", "5")).code, 2);
  assert.equal((await waitUntil("--match", "x", "--pid", "1")).code, 2, "--match needs --file");
  assert.equal((await waitUntil("--file", "x", "--match", "(")).code, 2);
  assert.equal((await waitUntil("--timeout", "soon", "--pid", "1")).code, 2);
  assert.equal((await waitUntil("--pid", "abc")).code, 2);
});
