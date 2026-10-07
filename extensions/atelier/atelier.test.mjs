import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import atelierExtension, { appendLog, copyKernel, createHost, dueMessages, readLog } from "./index.ts";
import { compose, derive, diffPreview, keyTexts, palette, threadLayout, wordDiff } from "./kernel/atelier.js";

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
    assert.match(sent[0].message.content, /^Atelier · page\.html \(http:\/\/127\.0\.0\.1:\d+\/page\.html\)\n- #2 Decision d1: B;/, "one header line, then one line per event");
    assert.doesNotMatch(sent[0].message.content, /grants no authority|Answer each Comment/, "the rules live in the tool description");
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
    const late = human({ type: "decide", decision: "a", options: "1|2|3", option: "2", key: "a" }).json.entry;
    tick(UNDO);
    assert.equal(human({ type: "undo", target: late.seq }).status, 409, "window closed");
  } finally { host.stop(); p.done(); }
});

test("delivery classes: Record stays in the log, Send batches drafts per group, Immediate goes alone", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    human({ type: "decide", decision: "a", options: "1|2|3|4|5", option: "4", key: "a", delivery: "record" });
    human({ type: "comment", key: "run-1/turn-1", text: "one", delivery: "send" });
    human({ type: "comment", key: "run-1/turn-2", text: "two", delivery: "send" });
    human({ type: "comment", key: "run-2/turn-1", text: "three", delivery: "send" });
    tick(UNDO);
    assert.equal(host.deliverDue(page), 0, "Record and unsent drafts never wake the agent");
    human({ type: "send", key: "run-1" });
    tick(UNDO);
    assert.equal(host.deliverDue(page), 1);
    assert.equal(sent[0].message.customType, "atelier:send");
    assert.match(sent[0].message.content, /Comments on run-1/);
    assert.match(sent[0].message.content, /"one"[\s\S]*"two"/);
    assert.doesNotMatch(sent[0].message.content, /three|Decision/);
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
    // A Page-declared Decision is Immediate unless its atl-delivery says otherwise.
    human({ type: "decide", decision: "b", options: "Confirm|Redo", option: "Redo", key: "b" });
    tick(UNDO);
    assert.equal(host.deliverDue(page), 1);
    assert.equal(human({ type: "decide", decision: "b", option: "Confirm", delivery: "later" }).json.entry.delivery, "immediate", "unknown classes fall back");
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
    assert.match(next.sent[0].message.content, /^Atelier · page\.html \(http[^)]*\) · replayed from an earlier session\n/);
    assert.equal(next.sent[0].message.details.replay, true);
  } finally { next.host.stop(); p.done(); }
});

test("open replays at once what an earlier session left undelivered", async () => {
  const p = project();
  appendLog(p.page, { origin: "human", type: "request", job: "rerun", delivery: "immediate" }, Date.now() - 60_000);
  appendLog(p.page, { origin: "human", type: "decide", delivery: "record", decision: "a", options: "1|2|3", option: "3", key: "a" }, Date.now() - 60_000);
  const sent = [];
  const host = createHost({ root: p.root, send: (m, done) => { sent.push(m); done(true); } });
  try {
    const opened = await host.open(path.join(host.root, "page.html"));
    assert.equal(opened.replayed, 1);
    assert.match(sent[0].content, /Request "rerun"/);
    assert.doesNotMatch(sent[0].content, /Decision/);
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
    { seq: 3, at: 0, origin: "human", type: "decide", decision: "run/t1", options: "1|2|3", option: "2", key: "run/t1", ver: "v1", delivery: "record" },
    { seq: 4, at: 0, origin: "agent", type: "ask", decision: { id: "d", key: "run/t1", question: "?", options: [] } },
    { seq: 5, at: 0, origin: "human", type: "decide", decision: "d", option: "A", key: "run/t1", ver: "v1", delivery: "immediate" },
  ];
  const same = derive(log, () => "v1");
  assert.equal(same.threads[0].stale, false);
  const moved = derive(log, () => "v2");
  assert.equal(moved.threads[0].stale, true);
  assert.equal(moved.openThreads.length, 1, "stays open until the human checks it");
  assert.equal(moved.decisions.find((d) => d.id === "run/t1").stale, true, "a Page-declared answer on v1");
  assert.equal(moved.decisions.find((d) => d.id === "d").stale, true);
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
    assert.match(readFileSync(path.join(dir, "atelier.js"), "utf8"), /^\/\/ atelier-copy 2\.1\.0 sha256:[0-9a-f]{64}/);
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
    assert.match(messages[0].m.content, /^Atelier · page\.html \(http/);
    assert.match(messages[0].m.content, /kept the recommendation/);
    handlers.message_end({ message: { role: "custom", ...messages[0].m } });
    handlers.agent_settled();
    assert.deepEqual(readLog(path.join(root, "page.html")).slice(-2).map((e) => e.type), ["delivered", "received"]);
    await assert.rejects(run({ action: "ask", decision: { id: "e", question: "?", options: [{ label: "A", consequence: "", recommended: true }, { label: "B", consequence: "", recommended: true }] } }), /at most one/);
    const asked = await run({ action: "ask", decision: { id: "e", question: "?", options: [{ label: "A", consequence: "" }, { label: "B", consequence: "" }] } });
    assert.match(asked.content[0].text, /posted/, "a recommendation is optional (133)");
    assert.match(tool.description, /recommend one option only when you have a basis/);
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

// Decision 133: a Page declares Decisions with atl-decide, and answers stay editable.
const turn = { id: "run/turn-1", key: "run/turn-1", declared: true, options: [{ label: "Confirm", recommended: true }, { label: "Redo", recommended: false }], note: ["Redo"] };

test("a Page-declared Decision posts a decide event whose id is the Key address", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    const r = human({ type: "decide", decision: "run/turn-1", key: "run/turn-1", ver: "v1", options: "Confirm|Redo", rec: "Confirm", option: "Confirm", opened: null, junk: 1 });
    assert.equal(r.status, 200);
    const { seq, at, ...entry } = r.json.entry;
    assert.deepEqual(entry, { type: "decide", decision: "run/turn-1", option: "Confirm", options: "Confirm|Redo", rec: "Confirm", opened: null, key: "run/turn-1", ver: "v1", origin: "human", delivery: "immediate" });
    const st = derive(readLog(page), () => "v1");
    assert.deepEqual(st.decisions.map((d) => [d.id, d.key, d.declared, d.answer.option]), [["run/turn-1", "run/turn-1", true, "Confirm"]], "replays without the Page");
    tick(UNDO);
    host.deliverDue(page);
    assert.match(sent[0].message.content, /\n- #1 Decision run\/turn-1 \(version v1\): Confirm; kept the recommendation$/);
  } finally { host.stop(); p.done(); }
});

test("changing an answer carries the previous option and is delivered as X → Y; undo restores the earlier answer", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    host.agent(page, { type: "ask", decision: { id: "gate-g0", question: "Promote?", options: [{ label: "Promote", consequence: "ships" }, { label: "Revise", consequence: "waits" }] } });
    human({ type: "decide", decision: "gate-g0", option: "Revise" });
    tick(UNDO);
    host.deliverDue(page);
    const changed = human({ type: "decide", decision: "gate-g0", option: "Promote", previous: "Revise" }).json.entry;
    assert.equal(changed.previous, "Revise");
    assert.equal(derive(readLog(page)).decisions[0].answer.option, "Promote", "the newest answer counts");
    tick(UNDO);
    host.deliverDue(page);
    assert.match(sent.at(-1).message.content, /- #\d+ Decision gate-g0: Revise → Promote$/);
    assert.doesNotMatch(sent.at(-1).message.content, /recommendation/, "no recommendation, no receipt");
    const again = human({ type: "decide", decision: "gate-g0", option: "Revise", previous: "Promote" }).json.entry;
    human({ type: "undo", target: again.seq });
    assert.equal(derive(readLog(page)).decisions[0].answer.option, "Promote", "undo applies to each change");
  } finally { host.stop(); p.done(); }
});

test("unanswered Page-declared Decisions count as to answer; atl-note options are declared for the Kernel", () => {
  const log = [{ seq: 1, at: 0, origin: "agent", type: "ask", decision: { id: "d", question: "?", options: [{ label: "A" }, { label: "B" }] } }];
  const st = derive(log, () => null, [turn, { ...turn, id: "run/turn-2", key: "run/turn-2" }]);
  assert.deepEqual(st.toAnswer.map((d) => d.id), ["run/turn-1", "run/turn-2", "d"]);
  assert.deepEqual(st.decisions[0].note, ["Redo"], "the Kernel refuses Redo without a note (browser-checked)");
  const answered = derive([...log, { seq: 2, at: 0, origin: "human", type: "decide", decision: "run/turn-1", key: "run/turn-1", option: "Redo", note: "blurry" }], () => null, [turn]);
  assert.deepEqual(answered.toAnswer.map((d) => d.id), ["d"]);
});

test("Verdict is gone: atl-verdict and verdict events are no longer recognised", async () => {
  const p = project();
  const { host, page, human } = await hostOn(p);
  try {
    assert.equal(human({ type: "verdict", key: "a", scale: "1|2", value: "1" }).status, 400);
    assert.equal(readLog(page).length, 0);
    const kernel = readFileSync(new URL("./kernel/atelier.js", import.meta.url), "utf8");
    assert.doesNotMatch(kernel, /verdict/i);
    assert.equal(derive([{ seq: 1, at: 0, origin: "human", type: "verdict", key: "a", value: "1", delivery: "record" }]).decisions.length, 0);
  } finally { host.stop(); p.done(); }
});

test("the Kernel palette is light unless the Page declares dark", () => {
  assert.doesNotMatch(palette(""), /prefers-color-scheme|#151b23/, "no Page declaration: light, whatever the OS");
  assert.match(palette("normal"), /--atl-bg:#fff/);
  assert.match(palette("light dark "), /^:where\(:root\)\{--atl-bg:#fff.*@media \(prefers-color-scheme:dark\)/, "light dark: follows the OS");
  assert.match(palette(" dark"), /^:where\(:root\)\{--atl-bg:#151b23/);
  assert.doesNotMatch(readFileSync(new URL("./kernel/atelier.js", import.meta.url), "utf8"), /color-scheme:\s*light dark|Canvas|ButtonFace/, "no system colours");
});

test("the delivery message is one header line and one line per event", () => {
  const c = { seq: 6, at: 0, origin: "human", type: "comment", key: "how/step-write", text: "too long", delivery: "send" };
  assert.equal(compose("/abs/dir/atelier.html", "http://127.0.0.1:1/x", [c], [c]), 'Atelier · atelier.html (http://127.0.0.1:1/x)\n- #6 Comment on how/step-write: "too long"');
});

test("a thread shows every message in order; only threads over four messages fold their middle", () => {
  const msgs = (n) => Array.from({ length: n }, (_, i) => ({ seq: i + 1 }));
  assert.deepEqual(threadLayout(msgs(2)), { head: msgs(2), folded: [], tail: [] }, "the human's own Comment stays visible");
  assert.deepEqual(threadLayout(msgs(4)).head.length, 4);
  const long = threadLayout(msgs(7));
  assert.deepEqual([long.head, long.folded, long.tail].map((part) => part.map((m) => m.seq)), [[1], [2, 3, 4, 5], [6, 7]]);
  assert.equal(threadLayout(msgs(7), true).head.length, 7, "expanded");
});

test("Delivery gives each Comment its Key's text from the Page source, and each reply its thread", async () => {
  const p = project();
  writeFileSync(p.page, `<!doctype html><title>t</title><section atl-key="how"><p>Intro</p><div atl-key="step-act" atl-ver="1"><h3>Act &mdash; You comment, rate, decide</h3><p>${"long text ".repeat(30)}</p><img src="x.png"></div><script>let s = "<div atl-key='fake'>";</script></section><script type="module" src="atelier.js"></script>`);
  assert.equal(keyTexts(readFileSync(p.page, "utf8")).has("fake"), false, "script text is not markup");
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    human({ type: "comment", key: "how/step-act", ver: "1", text: "why not?" });
    human({ type: "comment", key: "how/step-act", quote: { exact: "comment, rate", prefix: "You ", suffix: ", decide" }, text: "this bit" });
    const root = human({ type: "comment", key: "how", text: "I think we need to give subagents the tool aswell" }).json.entry;
    tick(UNDO);
    host.deliverDue(page);
    host.agent(page, { type: "answer", target: root.seq, text: `Agreed — it's the biggest gap. ${"x".repeat(300)}` });
    human({ type: "comment", key: "how", thread: root.seq, text: "ok do it" });
    tick(UNDO);
    host.deliverDue(page);
    const [first, second] = sent.map((s) => s.message.content);
    assert.match(first, /\n- #1 Comment on how\/step-act \("Act — You comment, rate, decide long text long text [^"]*…"\) \(version 1\): "why not\?"/);
    assert.match(first, /\n- #2 Comment on the text "comment, rate" in how\/step-act: "this bit"/, "a quoted selection stands for itself");
    assert.match(first, /\n- #3 Comment on how \("Intro Act/);
    assert.match(second, /\n- #6 Reply in thread #3 \(You: "I think we need to give subagents the tool aswell" · Agent: "Agreed — it's the biggest gap\. x{150,}…"\): "ok do it"$/);
    assert.ok(second.split("Agent: ")[1].indexOf("…") <= 200, "earlier messages are clipped to ~200 characters");
  } finally { host.stop(); p.done(); }
});

test("send on save: a Comment goes out after its undo window without a Send; an undone answer is replaced (134)", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    human({ type: "comment", key: "a", text: "saved" });
    tick(UNDO);
    assert.equal(host.deliverDue(page), 1, "no Send needed");
    assert.match(sent[0].message.content, /"saved"/);
    // The Kernel replaces an unsent answer by undoing it and posting the new one with the old previous.
    const first = human({ type: "decide", decision: "d", options: "Keep|Revert", option: "Revert" }).json.entry;
    human({ type: "undo", target: first.seq });
    human({ type: "decide", decision: "d", options: "Keep|Revert", option: "Keep" });
    tick(UNDO);
    host.deliverDue(page);
    assert.equal(sent.length, 2, "one message for the Decision");
    assert.match(sent[1].message.content, /Decision d: Keep/);
    assert.doesNotMatch(sent[1].message.content, /Revert/);
  } finally { host.stop(); rmSync(p.root, { recursive: true, force: true }); }
});

test("update logs its one-line note for the change indicators (134)", async () => {
  const p = project();
  const { host, page } = await hostOn(p);
  try {
    host.update(page, "Shortened the intro");
    host.update(page);
    assert.deepEqual(readLog(page).filter((e) => e.type === "update").map((e) => e.note), ["Shortened the intro"]);
  } finally { host.stop(); rmSync(p.root, { recursive: true, force: true }); }
});

test("wordDiff marks inserted and deleted words; diffPreview names the first change", () => {
  const parts = wordDiff("Comments wait for Send and go out together", "Comments go out when saved");
  assert.equal(parts.filter(([op]) => op !== "+").map(([, w]) => w).join(" "), "Comments wait for Send and go out together");
  assert.equal(parts.filter(([op]) => op !== "-").map(([, w]) => w).join(" "), "Comments go out when saved");
  assert.equal(diffPreview(wordDiff("undo lasts 30 s", "undo lasts 10 s")), "…undo lasts 30 → 10…");
  assert.deepEqual(wordDiff("same", "same"), [["=", "same"]]);
  assert.equal(diffPreview(wordDiff("same", "same")), "");
});
