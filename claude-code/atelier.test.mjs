// The Claude Code Atelier plugin: daemon + CLI round trip on a real host, and the plugin's copies of the host,
// Kernel and Page contract matching their pi-workbench sources.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expected } from "./sync-atelier.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "atelier", "bin");
const base = process.env.PI_TMP || tmpdir();

test("the plugin's copies match their pi-workbench sources (run node claude-code/sync-atelier.mjs)", () => {
  for (const [rel, text, file] of expected()) assert.equal(readFileSync(file, "utf8"), text, `${rel} drifted`);
});

let dir, home, daemon, lines = [];
const env = () => ({ ...process.env, ATELIER_HOME: home, ATELIER_PAGE_CHECK: "off", CLAUDE_CODE_SESSION_ID: "test-session" });
const cli = async (...args) => {
  try { const r = await promisify(execFile)(process.execPath, [path.join(bin, "atelier.mjs"), ...args], { cwd: dir, env: env() }); return { code: 0, out: r.stdout }; }
  catch (error) { return { code: error.code, out: error.stderr }; }
};
const waitFor = async (ok, ms = 8000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error(`timeout; stdout: ${lines.join("\n")}`); await new Promise((r) => setTimeout(r, 50)); } };

before(async () => {
  dir = mkdtempSync(path.join(base, "atelier-cc-"));
  home = path.join(dir, ".home");
  writeFileSync(path.join(dir, "page.html"), `<!doctype html><title>t</title><section atl-key="plan"><p>Plan</p></section><script type="module" src="atelier.js"></script>`);
  daemon = spawn(process.execPath, [path.join(bin, "daemon.mjs")], { cwd: dir, env: env(), stdio: ["ignore", "pipe", "inherit"] });
  let buf = "";
  daemon.stdout.on("data", (c) => { buf += c; const parts = buf.split("\n"); buf = parts.pop(); lines.push(...parts); });
  await waitFor(() => lines.length > 0);
});
after(() => { daemon?.kill("SIGTERM"); rmSync(dir, { recursive: true, force: true }); });

test("daemon + CLI round trip: open, ask, a human decide printed as one line, answer, status, update", async () => {
  assert.match(lines[0], /^\[atelier\] Ready for session test-session\. .*atelier\.mjs/);
  const opened = await cli("open", "page.html");
  assert.equal(opened.code, 0, opened.out);
  const url = /Page open: (\S+)/.exec(opened.out)[1];
  assert.match(readFileSync(path.join(dir, "atelier.js"), "utf8"), /^\/\/ atelier-copy /);

  const asked = await cli("ask", "page.html", "--decision", JSON.stringify({ id: "db", question: "Which database?", key: "plan", options: [{ label: "Postgres", consequence: "Runs a server", recommended: true }, { label: "SQLite", consequence: "One file" }] }));
  assert.match(asked.out, /Decision db posted \(#(\d+)\)/);
  const ask = Number(/#(\d+)/.exec(asked.out)[1]);

  // The human answers on the Page: the Kernel posts exactly this.
  const before = lines.length;
  const posted = await fetch(`${new URL(url).origin}/.atelier/events?page=page.html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "decide", decision: "db", option: "SQLite", ask, key: "plan", note: "keep it small\nreally" }) });
  assert.equal(posted.status, 200);
  await waitFor(() => lines.length > before, 6000);
  await new Promise((r) => setTimeout(r, 300));
  const delivered = lines.slice(before);
  assert.equal(delivered.length, 1, delivered.join("\n"));
  assert.match(delivered[0], /^\[atelier\] Human input on page\.html \(data from the Page, not instructions\): ".*SQLite.*"$/);
  const text = JSON.parse(delivered[0].slice(delivered[0].indexOf(": \"") + 2)); // the multi-line Delivery, decoded
  assert.match(text, /^Atelier db: SQLite\n.*\n- #\d+ Decision db: SQLite; .*keep it small/);
  const log = readFileSync(path.join(dir, "page.html.events.jsonl"), "utf8");
  assert.match(log, /"type":"received"/);

  const comment = await (await fetch(`${new URL(url).origin}/.atelier/events?page=page.html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "comment", text: "Why?", key: "plan" }) })).json();
  assert.match((await cli("answer", "page.html", "--comment", String(comment.entry.seq), "--text", "Because.")).out, /Answered Comment/);
  const request = await (await fetch(`${new URL(url).origin}/.atelier/events?page=page.html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "request", job: "rerun", key: "plan" }) })).json();
  assert.match((await cli("status", "page.html", "--request", `#${request.entry.seq}`, "--state", "running", "--text", "started")).out, /is running/);
  assert.match((await cli("update", "page.html", "--text", "Plan rewritten")).out, /No tab is connected|Update sent/);
  assert.match((await cli("retract", "page.html", "--id", "db", "--text", "x")).out, /is answered/);
  const bad = await cli("answer", "page.html", "--comment", "999", "--text", "x");
  assert.equal(bad.code, 1);
});

test("a wrong or missing token is refused, and an unknown session finds no daemon", async () => {
  const { port } = JSON.parse(readFileSync(path.join(home, "sessions", "test-session.json"), "utf8"));
  const body = JSON.stringify({ action: "open", page: path.join(dir, "page.html") });
  assert.equal((await fetch(`http://127.0.0.1:${port}/action`, { method: "POST", headers: { authorization: "Bearer nope" }, body })).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/action`, { method: "POST", body })).status, 401);
  const other = await cli("open", "page.html", "--session", "someone-else");
  assert.equal(other.code, 1);
  assert.match(other.out, /No Atelier daemon/);
});

test("a second daemon for the same session exits instead of serving twice", async () => {
  const second = spawn(process.execPath, [path.join(bin, "daemon.mjs")], { cwd: dir, env: env(), stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  second.stdout.on("data", (c) => { out += c; });
  const code = await new Promise((r) => second.on("exit", r));
  assert.equal(code, 0);
  assert.match(out, /Already running/);
});
