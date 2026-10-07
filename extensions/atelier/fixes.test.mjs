// Regression tests for kernel review 1 (Sol, 2026-10-07), one per finding, and the owner decision on Page paths.
// Browser-side findings 4, 10, 11 and 12 are checked with agent-browser (see the fix-round report).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import atelierExtension, { appendLog, copyKernel, createHost, readLog } from "./index.ts";
import { compose, derive } from "./kernel/atelier.js";

const UNDO = 10_000;
const PAGE = "<!doctype html><title>t</title><div atl-key='a' atl-ver='1'>A</div>";

function project() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "atelier-fix-")));
  const page = path.join(root, "page.html");
  writeFileSync(page, PAGE);
  return { root, page, done: () => rmSync(root, { recursive: true, force: true }) };
}
const dueDecide = (page) => appendLog(page, { origin: "human", type: "decide", decision: "d", option: "A", delivery: "immediate" }, Date.now() - 60_000);

// A fake Pi around the real extension.
function pi(ctx) {
  const tools = new Map(), handlers = {}, messages = [];
  atelierExtension({ registerTool: (t) => tools.set(t.name, t), on: (n, fn) => { handlers[n] = fn; }, sendMessage: (m) => messages.push(m) });
  handlers.session_start({}, ctx);
  const run = (params) => tools.get("atelier").execute("id", params, undefined, undefined, ctx);
  return { handlers, messages, run };
}
const session = (cwd, id) => ({ cwd, isIdle: () => true, sessionManager: { getSessionId: () => `${id}-${process.pid}` } });
const raw = (port, request) => new Promise((resolve, reject) => {
  const s = connect(port, "127.0.0.1", () => s.end(request));
  let out = ""; s.on("data", (d) => { out += d; }); s.on("end", () => resolve(out)); s.on("error", reject);
});

test("1: a receipt waits for agent_settled; an unconfirmed message is re-delivered to the next opener", async () => {
  const p = project();
  dueDecide(p.page);
  const a = pi(session(p.root, "s1a"));
  await a.run({ action: "open", page: "page.html" });
  const message = { role: "custom", ...a.messages[0] };
  a.handlers.message_start?.({ message });
  a.handlers.message_end?.({ message });
  assert.ok(!readLog(p.page).some((e) => e.type === "received"), "not received before the session settles");
  a.handlers.session_shutdown(); // ended before the session file held it
  const b = pi(session(p.root, "s1b"));
  try {
    await b.run({ action: "open", page: "page.html" });
    assert.equal(b.messages.length, 1, "re-delivered");
    const again = { role: "custom", ...b.messages[0] };
    b.handlers.message_end({ message: again });
    b.handlers.agent_settled();
    assert.deepEqual(readLog(p.page).filter((e) => e.type === "received").map((e) => e.of), [[1]]);
  } finally { b.handlers.session_shutdown(); p.done(); }
});

test("2+3: one live session owns a Page's appends and Delivery; a dead owner's lock is stale", async () => {
  const p = project();
  const sent = [];
  const make = (sessionId) => createHost({ root: p.root, sessionId, send: (m, done) => { sent.push(m); done(true); } });
  const a = make("a"), b = make("b");
  try {
    await a.open(p.page);
    await assert.rejects(b.open(p.page), /another live Pi session/, "a second session neither appends nor delivers");
    dueDecide(p.page);
    assert.equal(a.deliverDue(p.page) + b.deliverDue(p.page), 1, "only the owner delivers");
    a.stop();
    await b.open(p.page);
    b.stop();
    const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
    writeFileSync(`${p.page}.events.jsonl.lock`, JSON.stringify({ pid: dead, session: "gone" }));
    const c = make("c");
    await c.open(p.page);
    c.stop();
    writeFileSync(`${p.page}.events.jsonl.lock`, JSON.stringify({ pid: process.ppid, session: "other process" }));
    await assert.rejects(make("d").open(p.page), /another live Pi session/);
  } finally { a.stop(); b.stop(); p.done(); }
});

test("5: a stale start-fallback timer never releases a later held send", async () => {
  const p = project();
  for (const name of ["p1.html", "p2.html", "p3.html"]) { writeFileSync(path.join(p.root, name), PAGE); dueDecide(path.join(p.root, name)); }
  mock.timers.enable({ apis: ["setTimeout"] });
  const s = pi(session(p.root, "s5"));
  try {
    await s.run({ action: "open", page: "p1.html" }); // run 1 starting; fallback timer due at 15 s
    mock.timers.tick(1_000);
    s.handlers.agent_start();
    mock.timers.tick(10_000);
    await s.run({ action: "open", page: "p2.html" }); // run 2 starting at 11 s
    mock.timers.tick(5_000); // 16 s: run 1's timer must not release run 2's hold
    await s.run({ action: "open", page: "p3.html" });
    assert.equal(s.messages.length, 2, "the third send waits for run 2 to start");
    s.handlers.agent_start();
    assert.equal(s.messages.length, 3);
  } finally { s.handlers.session_shutdown(); mock.timers.reset(); p.done(); }
});

test("6: a symlinked Event Log or Kernel copy is refused", () => {
  const p = project();
  const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "atelier-outside-")));
  const victim = path.join(outside, "victim.txt");
  writeFileSync(victim, "keep\n");
  try {
    symlinkSync(victim, `${p.page}.events.jsonl`);
    assert.throws(() => appendLog(p.page, { origin: "human", type: "comment", text: "x" }), /symlink/);
    assert.equal(readFileSync(victim, "utf8"), "keep\n");
    symlinkSync(path.join(outside, "planted.js"), path.join(p.root, "atelier.js")); // dangling
    assert.equal(copyKernel(p.root)[0].outcome, "symlink");
    assert.equal(existsSync(path.join(outside, "planted.js")), false);
  } finally { p.done(); rmSync(outside, { recursive: true, force: true }); }
});

test("7: a malformed request target is a 400 and the server stays up", async () => {
  const p = project();
  const host = createHost({ root: p.root, send: () => {} });
  try {
    const { url } = await host.open(p.page);
    const port = Number(new URL(url).port);
    assert.match(await raw(port, `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 400/);
    assert.equal((await fetch(url)).status, 200, "still serving");
  } finally { host.stop(); p.done(); }
});

test("8: malformed events are refused before the log; a line that cannot be composed never throws out of Delivery", async () => {
  const p = project();
  let clock = 1_000_000;
  const sent = [];
  const host = createHost({ root: p.root, now: () => clock, send: (m, done) => { sent.push(m); done(true); } });
  try {
    await host.open(p.page);
    assert.equal(host.postHuman(p.page, { type: "comment", text: "x", quote: { exact: 5 } }).status, 400);
    assert.equal(host.postHuman(p.page, { type: "close", target: "1" }).status, 400);
    assert.equal(readLog(p.page).length, 0);
    assert.equal(host.postHuman(p.page, { type: "comment", text: "ok", junk: "x" }).json.entry.junk, undefined, "unknown fields are dropped");
    // Lines the old server accepted: composing the answer to an option-less Decision throws.
    appendLog(p.page, { origin: "agent", type: "ask", decision: { id: "old" } }, clock);
    appendLog(p.page, { origin: "human", type: "decide", decision: "old", option: "A", delivery: "immediate" }, clock);
    clock += UNDO;
    assert.doesNotThrow(() => host.deliverDue(p.page));
    assert.match(sent.at(-1).content, /#\d+ decide could not be rendered/, "delivered, named as unreadable");
    host.postHuman(p.page, { type: "request", job: "rerun", input: {} });
    clock += UNDO;
    host.deliverDue(p.page);
    assert.ok(sent.some((m) => /Request "rerun"/.test(m.content)), "later events still deliver");
  } finally { host.stop(); p.done(); }
});

test("9: closure and answers are version-scoped; stale items stay open", () => {
  const log = [
    { seq: 1, at: 0, origin: "human", type: "comment", key: "k", ver: "v1", text: "x", delivery: "send" },
    { seq: 2, at: 0, origin: "human", type: "send", delivery: "boundary" },
    { seq: 3, at: 0, origin: "human", type: "close", target: 1, ver: "v1", delivery: "record" },
    { seq: 4, at: 0, origin: "agent", type: "ask", decision: { id: "d", key: "k", question: "?", options: [] } },
    { seq: 5, at: 0, origin: "human", type: "decide", decision: "d", option: "A", key: "k", ver: "v1", delivery: "immediate" },
  ];
  assert.equal(derive(log, () => "v1").openThreads.length + derive(log, () => "v1").toAnswer.length, 0);
  const moved = derive(log, () => "v2");
  assert.equal(moved.openThreads.length, 1, "closed on v1, content now v2: open again");
  assert.equal(moved.toAnswer.length, 1, "answered on v1: to answer again");
  const checked = derive([...log, { seq: 6, at: 0, origin: "human", type: "close", target: 1, ver: "v2" }, { seq: 7, at: 0, origin: "human", type: "decide", decision: "d", option: "A", key: "k", ver: "v2" }], () => "v2");
  assert.equal(checked.openThreads.length + checked.toAnswer.length, 0);
});

test("B: a Page outside the project serves only its own directory", async () => {
  const p = project();
  const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "atelier-elsewhere-")));
  const dir = path.join(outside, "pages");
  mkdirSync(path.join(dir, "data"), { recursive: true });
  writeFileSync(path.join(dir, "far.html"), PAGE);
  writeFileSync(path.join(dir, "data", "runs.json"), "[1]");
  writeFileSync(path.join(outside, "secret.txt"), "no");
  symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "link.txt"));
  writeFileSync(path.join(p.root, "project.json"), "{}");
  dueDecide(path.join(dir, "far.html"));
  const s = pi(session(p.root, "sB"));
  try {
    const { url } = (await s.run({ action: "open", page: path.join(dir, "far.html") })).details;
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/~[0-9a-f]+\/far\.html$/);
    const base = url.replace(/far\.html$/, "");
    const origin = new URL(url).origin;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(`${base}atelier.js`)).status, 200, "Kernel copied beside it");
    assert.equal((await fetch(`${base}data/runs.json`)).status, 200);
    assert.equal((await fetch(`${base}..%2Fsecret.txt`)).status, 404, "no traversal");
    assert.equal((await fetch(`${base}link.txt`)).status, 404, "no symlink out");
    assert.equal((await fetch(`${origin}/project.json`)).status, 200, "project files as before");
    assert.equal(s.messages.length, 1, "undelivered events replayed");
    const page = new URL(url).pathname.slice(1);
    const post = await fetch(`${origin}/.atelier/events?page=${encodeURIComponent(page)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "comment", text: "hi" }) });
    assert.equal(post.status, 200);
    assert.equal(readLog(path.join(dir, "far.html")).at(-1).text, "hi");
    const port = new URL(url).port;
    assert.match(await raw(Number(port), `GET /${page} HTTP/1.1\r\nHost: evil.example:${port}\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 403/, "Host check (130)");
  } finally { s.handlers.session_shutdown(); p.done(); rmSync(outside, { recursive: true, force: true }); }
});

// Re-check of review 1 (Sol): one regression test per finding.
test("R1: concurrent hosts on fresh Pages: exactly one claims each Page", async () => {
  const p = project();
  const pages = Array.from({ length: 100 }, (_, i) => path.join(p.root, `p${i}.html`));
  const start = Date.now() + 1_500;
  const child = `import { claimPage } from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
const pages = JSON.parse(process.argv[1]); const won = [];
while (Date.now() < ${start}) {}
for (const [i, page] of pages.entries()) { try { claimPage(page, "c"); won.push(i); } catch {} }
console.log(JSON.stringify(won));
process.stdin.resume().on("end", () => process.exit());`; // stay alive (lock not stale) until every child has tried
  const children = [];
  try {
    const runs = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
      let out = "";
      const c = spawn(process.execPath, ["--input-type=module", "-e", child, JSON.stringify(pages)]);
      children.push(c);
      c.stdout.on("data", (d) => { out += d; if (out.includes("\n")) resolve(JSON.parse(out)); });
      c.on("error", reject);
      c.on("close", (code) => reject(new Error(`child exited ${code}`)));
    })));
    const claims = new Map();
    for (const won of runs) for (const i of won) claims.set(i, (claims.get(i) ?? 0) + 1);
    assert.deepEqual(pages.map((_, i) => claims.get(i) ?? 0).filter((n) => n !== 1), [], "every Page has exactly one owner");
  } finally { children.forEach((c) => c.stdin.end()); p.done(); }
});

test("R2: a Comment thread may only reference an earlier Comment; a bad reference never hangs replay", async () => {
  const p = project();
  const host = createHost({ root: p.root, send: () => {} });
  try {
    await host.open(p.page);
    assert.equal(host.postHuman(p.page, { type: "comment", text: "self", thread: 1 }).status, 400, "self reference");
    const first = host.postHuman(p.page, { type: "comment", text: "root" }).json.entry;
    assert.equal(host.postHuman(p.page, { type: "comment", text: "forward", thread: first.seq + 5 }).status, 400, "forward reference");
    assert.equal(host.postHuman(p.page, { type: "comment", text: "reply", thread: first.seq }).status, 200);
  } finally { host.stop(); p.done(); }
  const legacy = [
    { seq: 1, at: 0, origin: "human", type: "comment", text: "self", thread: 1, delivery: "send" },
    { seq: 2, at: 0, origin: "human", type: "comment", text: "a", thread: 3, delivery: "send" },
    { seq: 3, at: 0, origin: "human", type: "comment", text: "b", thread: 2, delivery: "send" },
  ];
  // In a child with a timeout: a looping replay must fail, not hang the suite.
  const replay = spawnSync(process.execPath, ["--input-type=module", "-e", `import { derive } from ${JSON.stringify(new URL("./kernel/atelier.js", import.meta.url).href)}; console.log(derive(${JSON.stringify(legacy)}).threads.length);`], { timeout: 5_000, encoding: "utf8" });
  assert.equal(replay.stdout.trim(), "2", "a self or forward reference starts its own thread");
});

test("R3: composition names an entry it cannot render instead of throwing, for Delivery and Copy", () => {
  const bad = { seq: 4, at: 0, origin: "human", type: "decide", decision: "old", option: "A", delivery: "immediate" };
  const good = { seq: 5, at: 0, origin: "human", type: "comment", text: "fine", delivery: "immediate" };
  const log = [{ seq: 3, at: 0, origin: "agent", type: "ask", decision: { id: "old" } }, bad, good, { seq: 6, at: 0, origin: "kernel", type: "unconfirmed", of: [4, 5] }];
  let text;
  assert.doesNotThrow(() => { text = compose("page.html", "", [bad, good], log); });
  assert.match(text, /#4 decide could not be rendered/);
  assert.match(text, /#5 Comment/);
});
