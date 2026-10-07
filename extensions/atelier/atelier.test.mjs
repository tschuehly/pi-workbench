import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import atelierExtension, { appendLog, copyKernel, createHost, dueMessages, readLog } from "./index.ts";
import { derive } from "./kernel/atelier.js";

const UNDO = 10_000;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "atelier-"));
  const page = path.join(root, "page.html");
  writeFileSync(page, "<!doctype html><title>t</title><div atl-key='a' atl-ver='1'>A</div>");
  return { root, page, done: () => rmSync(root, { recursive: true, force: true }) };
}

// A host on a fake clock; `sent` records each message with the log as it was at send time.
async function hostOn(p, options = {}) {
  let clock = 1_000_000;
  const sent = [];
  const host = createHost({
    root: p.root,
    now: () => clock,
    watchdogMs: options.watchdogMs ?? 60_000,
    send: (message, done) => { sent.push({ message, logAtSend: readLog(p.page).map((e) => e.type) }); done(options.idle ?? true); },
  });
  await host.open(path.join(host.root, "page.html"));
  const page = path.join(host.root, "page.html");
  return { host, page, sent, tick: (ms) => { clock += ms; }, human: (body) => host.postHuman(page, body) };
}

test("an event is appended to the Event Log before it is delivered, and marked delivered after", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    host.agent(page, { type: "ask", decision: { id: "d1", question: "Which?", material: "a", options: [{ label: "A", consequence: "a", recommended: true }, { label: "B", consequence: "b" }] } });
    const r = human({ type: "decide", decision: "d1", option: "B", opened: false });
    assert.equal(r.status, 200);
    assert.deepEqual(readLog(page).map((e) => e.type), ["ask", "decide"], "logged at once");
    assert.equal(host.deliverDue(page), 0, "nothing is delivered inside the undo window");
    tick(UNDO);
    assert.equal(host.deliverDue(page), 1);
    assert.deepEqual(sent[0].logAtSend, ["ask", "decide"], "the log held the event before the send");
    assert.equal(sent[0].message.customType, "atelier:immediate");
    assert.match(sent[0].message.content, /grants no authority/);
    assert.match(sent[0].message.content, /changed from the recommendation "A"; material NOT opened; do not read this as agreement/);
    assert.equal(readLog(page).at(-1).type, "delivered");
    assert.equal(host.deliverDue(page), 0, "in flight events are not sent twice");
  } finally { host.stop(); p.done(); }
});

test("undo inside the window cancels delivery; after the window it is refused", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    const { entry } = human({ type: "request", job: "rerun", key: "a", input: {} }).json;
    tick(9_000);
    assert.equal(human({ type: "undo", target: entry.seq }).status, 200);
    assert.equal(human({ type: "undo", target: entry.seq }).status, 409, "undone once");
    tick(5_000);
    assert.equal(host.deliverDue(page), 0);
    assert.equal(sent.length, 0);
    const late = human({ type: "verdict", key: "a", scale: "1|2|3", value: "2" }).json.entry;
    tick(UNDO);
    assert.equal(human({ type: "undo", target: late.seq }).status, 409, "window closed");
  } finally { host.stop(); p.done(); }
});

test("delivery classes: Record stays in the log, Send batches drafts per group, Immediate goes alone", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    human({ type: "verdict", key: "a", scale: "1|2|3|4|5", value: "4" });
    human({ type: "comment", key: "run-1/turn-1", text: "one" });
    human({ type: "comment", key: "run-1/turn-2", text: "two" });
    human({ type: "comment", key: "run-2/turn-1", text: "three" });
    tick(UNDO);
    assert.equal(host.deliverDue(page), 0, "Record and unsent drafts never wake the agent");
    human({ type: "send", key: "run-1" });
    tick(UNDO);
    assert.equal(host.deliverDue(page), 1);
    assert.equal(sent[0].message.customType, "atelier:send");
    assert.match(sent[0].message.content, /Comments on run-1/);
    assert.match(sent[0].message.content, /"one"[\s\S]*"two"/);
    assert.doesNotMatch(sent[0].message.content, /three|Verdict/);
    host.receipt(sent[0].message.details);
    human({ type: "send" });
    human({ type: "decide", decision: "x", option: "A" });
    tick(UNDO);
    assert.equal(host.deliverDue(page), 2, "the rest of the drafts and the immediate event");
    assert.equal(sent[1].message.customType, "atelier:immediate");
    assert.equal(sent[2].message.customType, "atelier:send");
    assert.match(sent[2].message.content, /"three"/);
    // A Send with nothing to send never starts a turn.
    human({ type: "send" });
    tick(UNDO);
    assert.equal(host.deliverDue(page), 0);
    assert.equal(readLog(page).at(-1).note, "nothing to send");
    // A Page may make a Verdict Immediate.
    human({ type: "verdict", key: "a", scale: "Confirm|Redo", value: "Redo", delivery: "immediate" });
    tick(UNDO);
    assert.equal(host.deliverDue(page), 1);
  } finally { host.stop(); p.done(); }
});

test("events the ended session never delivered go to the next session that opens the Page", async () => {
  const p = project();
  const first = await hostOn(p);
  first.human({ type: "decide", decision: "d", option: "A" });
  first.host.stop(); // the session ended inside the undo window
  assert.equal(first.sent.length, 0);
  const next = await hostOn(p);
  try {
    next.tick(UNDO);
    assert.equal(next.host.deliverDue(next.page, true), 1);
    assert.match(next.sent[0].message.content, /Delivered to this session because it opened the Page/);
    assert.equal(next.sent[0].message.details.replay, true);
  } finally { next.host.stop(); p.done(); }
});

test("open replays at once what an earlier session left undelivered", async () => {
  const p = project();
  appendLog(p.page, { origin: "human", type: "request", job: "rerun", delivery: "immediate" }, Date.now() - 60_000);
  appendLog(p.page, { origin: "human", type: "verdict", delivery: "record", key: "a", value: "3" }, Date.now() - 60_000);
  const sent = [];
  const host = createHost({ root: p.root, send: (m, done) => { sent.push(m); done(true); } });
  try {
    const opened = await host.open(path.join(host.root, "page.html"));
    assert.equal(opened.replayed, 1);
    assert.match(sent[0].content, /Request "rerun"/);
    assert.doesNotMatch(sent[0].content, /Verdict/);
  } finally { host.stop(); p.done(); }
});

test("a message that never starts is marked unconfirmed; a receipt confirms it", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p, { watchdogMs: 20 });
  try {
    human({ type: "decide", decision: "a", option: "A" });
    human({ type: "decide", decision: "b", option: "B" });
    tick(UNDO);
    host.deliverDue(page);
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual(readLog(page).at(-1), { ...readLog(page).at(-1), type: "unconfirmed", of: [1, 2] });
    host.receipt(sent[0].message.details);
    const st = derive(readLog(page));
    assert.equal(st.status(readLog(page)[0]), "delivered");
  } finally { host.stop(); p.done(); }
});

test("a busy session arms the watchdog only at agent_settled", async () => {
  const p = project();
  const { host, page, tick, human } = await hostOn(p, { watchdogMs: 20, idle: false });
  try {
    human({ type: "decide", decision: "a", option: "A" });
    tick(UNDO);
    host.deliverDue(page);
    await new Promise((r) => setTimeout(r, 50));
    assert.notEqual(readLog(page).at(-1).type, "unconfirmed", "follow-up still queued behind the run");
    host.settled();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(readLog(page).at(-1).type, "unconfirmed");
  } finally { host.stop(); p.done(); }
});

test("events on an earlier version are marked, stay open, and can be re-bound", () => {
  const log = [
    { seq: 1, at: 0, origin: "human", type: "comment", key: "run/t1", ver: "v1", text: "wrong", delivery: "send" },
    { seq: 2, at: 0, origin: "human", type: "send", delivery: "boundary" },
    { seq: 3, at: 0, origin: "human", type: "verdict", key: "run/t1", ver: "v1", value: "2", delivery: "record" },
    { seq: 4, at: 0, origin: "agent", type: "ask", decision: { id: "d", key: "run/t1", question: "?", options: [] } },
    { seq: 5, at: 0, origin: "human", type: "decide", decision: "d", option: "A", key: "run/t1", ver: "v1", delivery: "immediate" },
  ];
  const same = derive(log, () => "v1");
  assert.equal(same.threads[0].stale, false);
  const moved = derive(log, () => "v2");
  assert.equal(moved.threads[0].stale, true);
  assert.equal(moved.openThreads.length, 1, "stays open until the human checks it");
  assert.equal(moved.verdicts.get("run/t1").stale, true);
  assert.equal(moved.decisions[0].stale, true);
  const still = derive([...log, { seq: 6, at: 0, origin: "human", type: "still", target: 1, ver: "v2" }], () => "v2");
  assert.equal(still.threads[0].stale, false);
  const fixed = derive([...log, { seq: 6, at: 0, origin: "human", type: "close", target: 1, ver: "v2" }], () => "v2");
  assert.equal(fixed.openThreads.length, 0);
});

test("threads, drafts and Requests replay with revisions on rework", () => {
  const log = [
    { seq: 1, at: 0, origin: "human", type: "comment", key: "k", text: "draft", delivery: "send" },
    { seq: 2, at: 0, origin: "human", type: "request", job: "rerun", delivery: "immediate" },
    { seq: 3, at: 0, origin: "agent", type: "status", target: 2, state: "done", revision: 1 },
    { seq: 4, at: 0, origin: "human", type: "rework", target: 2, note: "again", delivery: "immediate" },
    { seq: 5, at: 0, origin: "agent", type: "status", target: 2, state: "done", revision: 1 },
  ];
  const st = derive(log);
  assert.equal(st.drafts.length, 1);
  assert.equal(st.openThreads.length, 0, "unsent drafts carry no open state");
  assert.equal(st.requests[0].revision, 2);
  assert.equal(st.requests[0].state, null, "a status for the earlier revision is stale");
  const answered = derive([...log, { seq: 6, at: 0, origin: "human", type: "send" }, { seq: 7, at: 0, origin: "agent", type: "answer", target: 1, text: "ok" }, { seq: 8, at: 0, origin: "human", type: "comment", thread: 1, text: "thanks", delivery: "send" }]);
  assert.deepEqual(answered.threads[0].msgs.map((m) => m.seq), [1, 7, 8]);
});

test("the Kernel copy is stamped and never overwrites a local change", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atelier-copy-"));
  try {
    assert.deepEqual(copyKernel(dir).map((c) => c.outcome), ["copied", "copied"]);
    assert.match(readFileSync(path.join(dir, "atelier.js"), "utf8"), /^\/\/ atelier-copy 1\.0\.0 sha256:[0-9a-f]{64}/);
    assert.deepEqual(copyKernel(dir).map((c) => c.outcome), ["current", "current"]);
    const file = path.join(dir, "atelier.js");
    const edited = `${readFileSync(file, "utf8")}\n// local fix\n`;
    writeFileSync(file, edited);
    assert.equal(copyKernel(dir)[0].outcome, "changed");
    assert.equal(readFileSync(file, "utf8"), edited, "the local change survives");
    // An unchanged older copy is reported, not replaced (decision 114).
    const old = "// atelier-copy 0.9.0 sha256:" + "0".repeat(64) + " old\n";
    const body = "export {};\n";
    writeFileSync(file, old.replace("0".repeat(64), createHash("sha256").update(body).digest("hex")) + body);
    assert.equal(copyKernel(dir)[0].outcome, "behind");
    assert.match(readFileSync(file, "utf8"), /0\.9\.0/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the page server serves project files read-only and takes events only for open Pages", async () => {
  const p = project();
  writeFileSync(path.join(p.root, "data.json"), "{\"n\":1}");
  const host = createHost({ root: p.root, send: () => {} });
  try {
    const { url } = await host.open(path.join(host.root, "page.html"));
    const base = new URL(url).origin;
    assert.equal((await fetch(`${base}/data.json`)).status, 200);
    assert.equal((await fetch(`${base}/atelier.js`)).headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status, 404);
    assert.equal((await fetch(`${base}/data.json`, { method: "PUT" })).status, 405);
    const post = (page, body) => fetch(`${base}/.atelier/events?page=${page}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post("other.html", { type: "comment", text: "x" })).status, 404);
    assert.equal((await post("page.html", { type: "rm -rf" })).status, 400);
    const ok = await (await post("page.html", { type: "comment", key: "a", text: "hi", seq: 99, origin: "agent" })).json();
    assert.equal(ok.entry.origin, "human", "the server, not the page, sets origin and seq");
    assert.equal(ok.entry.seq, 1);
    const listed = await (await fetch(`${base}/.atelier/events?page=page.html&since=0`)).json();
    assert.equal(listed.entries.length, 1);
    const ranged = await fetch(`${base}/data.json`, { headers: { range: "bytes=0-2" } });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), "{\"n");
  } finally { host.stop(); p.done(); }
});

test("the extension delivers as an atelier follow-up message and records the receipt", async () => {
  const p = project();
  const root = realpathSync(p.root);
  // An earlier session's settled, undelivered Decision answer waits in the log.
  appendLog(path.join(root, "page.html"), { origin: "agent", type: "ask", decision: { id: "d", question: "Ship?", options: [{ label: "Yes", consequence: "ships", recommended: true }, { label: "No", consequence: "waits" }] } }, Date.now() - 60_000);
  appendLog(path.join(root, "page.html"), { origin: "human", type: "decide", decision: "d", option: "Yes", delivery: "immediate" }, Date.now() - 60_000);
  const tools = new Map(), handlers = {}, messages = [];
  atelierExtension({ registerTool: (t) => tools.set(t.name, t), on: (n, fn) => { handlers[n] = fn; }, sendMessage: (m, o) => messages.push({ m, o }) });
  const tool = tools.get("atelier");
  for (let i = 1; i <= 8; i += 1) assert.match(tool.description, new RegExp(`\\n${i}\\. `), `rule ${i}`);
  const ctx = { cwd: p.root, isIdle: () => true, sessionManager: { getSessionId: () => `s-atelier-${process.pid}` } };
  handlers.session_start({}, ctx);
  const run = (params) => tool.execute("id", { page: "page.html", ...params }, undefined, undefined, ctx);
  try {
    await assert.rejects(run({ action: "update" }), /Open page.html first/);
    const opened = await run({ action: "open" });
    assert.match(opened.content[0].text, /^Page open: http:\/\/127\.0\.0\.1:\d+\/page\.html/);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].o, { triggerTurn: true, deliverAs: "followUp" });
    assert.equal(messages[0].m.customType, "atelier:immediate");
    assert.equal(messages[0].m.display, true);
    assert.match(messages[0].m.content, /^Atelier Page page\.html/);
    assert.match(messages[0].m.content, /kept the recommendation/);
    handlers.message_end({ message: { role: "custom", ...messages[0].m } });
    handlers.agent_settled();
    assert.deepEqual(readLog(path.join(root, "page.html")).slice(-2).map((e) => e.type), ["delivered", "received"]);
    await assert.rejects(run({ action: "ask", decision: { id: "e", question: "?", options: [{ label: "A", consequence: "" }, { label: "B", consequence: "" }] } }), /exactly one recommended/);
    const asked = await run({ action: "ask", decision: { id: "e", question: "?", options: [{ label: "A", consequence: "", recommended: true }, { label: "B", consequence: "" }] } });
    assert.match(asked.content[0].text, /End your turn/);
    assert.match((await run({ action: "update" })).content[0].text, /No tab is connected/);
    await assert.rejects(run({ action: "answer", comment: 1, text: "x" }), /Comment/);
    await assert.rejects(run({ action: "open", page: "../outside.html" }), /No Page file/);
  } finally { handlers.session_shutdown(); p.done(); }
});

test("a second send waits until the first one's run has started", async () => {
  const p = project();
  const root = realpathSync(p.root);
  const old = Date.now() - 60_000;
  appendLog(path.join(root, "page.html"), { origin: "human", type: "request", job: "a", delivery: "immediate" }, old);
  appendLog(path.join(root, "page.html"), { origin: "human", type: "comment", text: "c", delivery: "send" }, old);
  appendLog(path.join(root, "page.html"), { origin: "human", type: "send", delivery: "boundary" }, old);
  const tools = new Map(), handlers = {}, messages = [];
  atelierExtension({ registerTool: (t) => tools.set(t.name, t), on: (n, fn) => { handlers[n] = fn; }, sendMessage: (m) => messages.push(m) });
  const ctx = { cwd: p.root, isIdle: () => messages.length === 0, sessionManager: { getSessionId: () => `s-atelier-hold-${process.pid}` } };
  handlers.session_start({}, ctx);
  try {
    await tools.get("atelier").execute("id", { action: "open", page: "page.html" }, undefined, undefined, ctx);
    assert.deepEqual(messages.map((m) => m.customType), ["atelier:immediate"], "the send is held while the first run starts");
    handlers.agent_start();
    assert.deepEqual(messages.map((m) => m.customType), ["atelier:immediate", "atelier:send"]);
  } finally { handlers.session_shutdown(); p.done(); }
});

test("dueMessages skips in-flight events and covers only drafts before the Send", () => {
  const log = [
    { seq: 1, at: 0, origin: "human", type: "comment", key: "a", delivery: "send" },
    { seq: 2, at: 0, origin: "human", type: "send", delivery: "boundary" },
    { seq: 3, at: 0, origin: "human", type: "comment", key: "a", delivery: "send" },
  ];
  assert.deepEqual(dueMessages(log, UNDO).map((m) => m.seqs), [[1, 2]]);
  assert.deepEqual(dueMessages(log, UNDO, UNDO, new Set([1, 2])), []);
});
