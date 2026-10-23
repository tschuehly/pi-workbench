import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import atelierExtension, { appendLog, copyKernel, createHost, dueMessages, readLog } from "./index.ts";
import { compose, derive, diffPreview, keyTexts, palette, threadLayout, wordDiff } from "./kernel/atelier.js";

process.env.ATELIER_PAGE_CHECK = "off"; // the browser Page check has its own test (page-check.test.mjs)
const UNDO = 3_000; // decision 151 (owner 2026-10-21)

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
    assert.match(sent[0].message.content, /^Atelier d1: B\npage\.html \(http:\/\/127\.0\.0\.1:\d+\/page\.html\)\n- #2 Decision d1: B;/, "one header line, then one line per event");
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
    tick(2_999);
    assert.equal(human({ type: "undo", target: entry.seq }).status, 200);
    assert.equal(human({ type: "undo", target: entry.seq }).status, 409, "undone once");
    tick(5_000);
    assert.equal(host.deliverDue(page), 0);
    assert.equal(sent.length, 0);
    const late = human({ type: "decide", decision: "a", options: "1|2|3", option: "2", key: "a" }).json.entry;
    tick(2_999);
    assert.equal(host.deliverDue(page), 0, "still inside the window at 2.999 s");
    tick(1);
    const refused = human({ type: "undo", target: late.seq });
    assert.equal(refused.status, 409, "window closed at 3 s (decision 151, owner 2026-10-21)");
    assert.equal(refused.json.error, "The 3-second undo window has closed.");
    assert.equal(host.deliverDue(page), 1, "the answer is delivered 3 s after it was given");
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
    assert.match(next.sent[0].message.content, /^Atelier [^\n]*\npage\.html \(http[^)]*\) · replayed from an earlier session\n/);
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
    { seq: 6, at: 0, origin: "agent", type: "ask", decision: { id: "m", key: "run/t1", material: "run/t1", question: "?", options: [] } },
    { seq: 7, at: 0, origin: "human", type: "decide", decision: "m", option: "A", key: "run/t1", ver: "v1", delivery: "immediate" },
  ];
  const same = derive(log, () => "v1");
  assert.equal(same.threads[0].stale, false);
  const moved = derive(log, () => "v2");
  assert.equal(moved.threads[0].stale, true);
  assert.equal(moved.openThreads.length, 1, "stays open until the human checks it");
  assert.equal(moved.decisions.find((d) => d.id === "run/t1").stale, true, "a Page-declared answer on v1");
  assert.equal(moved.decisions.find((d) => d.id === "d").stale, false, "an asked question is not a judgement of the Key it sits on (2.11.0)");
  assert.equal(moved.decisions.find((d) => d.id === "m").stale, true, "an ask with material judges content and goes stale");
  const still = derive([...log, { seq: 8, at: 0, origin: "human", type: "still", target: 1, ver: "v2" }], () => "v2");
  assert.equal(still.threads[0].stale, false);
  const fixed = derive([...log, { seq: 8, at: 0, origin: "human", type: "close", target: 1, ver: "v2" }], () => "v2");
  assert.equal(fixed.openThreads.length, 0);
});

// 2.11.0 (owner review of the Worlds Console Page, 2026-10-22): follow-up questions asked on a Key went back to
// "to answer" whenever that Key's atl-ver changed. The lines are Thomas's Event Log, trimmed to the fields that count.
test("an answered ask stays answered when its Key changes; atl-decide answers in an existing Event Log still go stale", () => {
  const opts = [{ label: "A", consequence: "a" }, { label: "B", consequence: "b" }];
  const log = [
    { seq: 9, at: 0, origin: "agent", type: "ask", decision: { id: "errors/pattern-scope", key: "apps/uninstall-error", question: "How far?", options: opts } },
    { seq: 14, at: 0, origin: "human", type: "decide", decision: "errors/pattern-scope", option: "Both", custom: true, opened: null, key: "apps/uninstall-error", ver: "6c8e10dd", delivery: "immediate" },
    { seq: 34, at: 0, origin: "agent", type: "ask", decision: { id: "settings/phone-list-shape", key: "settings/phone-strip/390x844", question: "Phone?", options: opts } },
    { seq: 42, at: 0, origin: "human", type: "decide", decision: "settings/phone-list-shape", option: "create some prototypes", custom: true, opened: null, key: "settings/phone-strip/390x844", ver: "a717589d", delivery: "immediate" },
    { seq: 50, at: 0, origin: "human", type: "decide", decision: "settings/phone-strip/390x844", options: "Ship|Rework", option: "Ship", key: "settings/phone-strip/390x844", ver: "a717589d", delivery: "immediate" },
  ];
  const st = derive(log, () => "ffffffff");
  assert.deepEqual(st.toAnswer.map((d) => d.id), ["settings/phone-strip/390x844"], "only the Page-declared Decision on the changed Key is to answer again");
  assert.deepEqual(st.decisions.map((d) => [d.id, d.stale]), [["errors/pattern-scope", false], ["settings/phone-list-shape", false], ["settings/phone-strip/390x844", true]]);
});

test("each Decision has a state (new, changed, done) consistent with toAnswer, and each Key sums the state under it (2.11.0)", async () => {
  const { publicState } = await import("./kernel/atelier.js");
  const log = [
    { seq: 1, at: 0, origin: "agent", type: "ask", decision: { id: "q", key: "run/turn-1", question: "?", options: [{ label: "A" }, { label: "B" }] } },
    { seq: 2, at: 0, origin: "human", type: "decide", decision: "run/turn-2", key: "run/turn-2", options: "Keep|Drop", option: "Keep", ver: "v1", delivery: "immediate" },
    { seq: 3, at: 0, origin: "human", type: "decide", decision: "run/turn-3", key: "run/turn-3", options: "Keep|Drop", option: "Drop", ver: "v2", delivery: "immediate" },
    { seq: 4, at: 0, origin: "human", type: "comment", key: "run/turn-3", text: "x", delivery: "immediate" },
    { seq: 5, at: 0, origin: "agent", type: "ask", decision: { id: "loose", question: "?", options: [{ label: "A" }, { label: "B" }] } },
  ];
  const st = derive(log, () => "v2");
  assert.deepEqual(st.decisions.map((d) => [d.id, d.state]), [["q", "new"], ["run/turn-2", "changed"], ["run/turn-3", "done"], ["loose", "new"]]);
  assert.deepEqual(st.toAnswer.map((d) => d.id), st.decisions.filter((d) => d.state !== "done").map((d) => d.id));
  const s = publicState(st);
  assert.deepEqual(s.decisions.map((d) => [d.id, d.state, d.answer]), [["q", "new", null], ["run/turn-2", "changed", "Keep"], ["run/turn-3", "done", "Drop"], ["loose", "new", null]]);
  assert.deepEqual(s.keys, {
    run: { new: 1, changed: 1, done: 1, threads: 1 },
    "run/turn-1": { new: 1, changed: 0, done: 0, threads: 0 },
    "run/turn-2": { new: 0, changed: 1, done: 0, threads: 0 },
    "run/turn-3": { new: 0, changed: 0, done: 1, threads: 1 },
  }, "a Key counts the Decisions and open threads on it and under it; a Decision without a Key counts on none");
});

// 2.11.0, owner 2026-10-22: "I think the decision should reset or show version 2 or so".
test("a Page's Decision on a changed Key starts a new round: Version N, earlier answers as history; asks stay in round 1", async () => {
  const { publicState } = await import("./kernel/atelier.js");
  const decide = (seq, option, ver, extra = {}) => ({ seq, at: 0, origin: "human", type: "decide", decision: "shot", key: "shot", options: "Approve|Rework", option, ver, delivery: "immediate", ...extra });
  const round = (log, now) => { const d = publicState(derive(log, () => now)).decisions.find((x) => x.id === "shot"); return [d.state, d.round, d.history]; };
  const v1 = [decide(1, "Rework", "v1"), decide(2, "Approve", "v1", { previous: "Rework", note: "fine now" })];
  assert.deepEqual(round(v1, "v1"), ["done", 1, []], "answered on the version shown: round 1");
  assert.deepEqual(round(v1, "v2"), ["changed", 2, [{ round: 1, ver: "v1", answer: "Approve", custom: false, note: "fine now" }]], "a new version opens Version 2; the last answer on v1 is its history");
  const v2 = [...v1, { seq: 3, at: 0, origin: "human", type: "comment", key: "shot", ver: "v2", text: "x", delivery: "immediate" }, decide(4, "Rework", "v2")];
  assert.deepEqual(round(v2, "v2"), ["done", 2, [{ round: 1, ver: "v1", answer: "Approve", custom: false, note: "fine now" }]]);
  assert.deepEqual(round(v2, "v3").slice(0, 2), ["changed", 3]);
  assert.deepEqual(round(v2, "v3")[2].map((h) => [h.round, h.answer]), [[1, "Approve"], [2, "Rework"]]);
  // Versions are numbered in the order the Event Log first saw them; back on v1, an answer given on v1 holds again.
  assert.deepEqual(round([...v2, decide(5, "Approve", "v1")], "v1"), ["done", 1, [{ round: 2, ver: "v2", answer: "Rework", custom: false, note: null }]], "content back on v1 is Version 1 again");
  // Before any answer, and in Event Logs whose answers carry no version, there is one round.
  assert.deepEqual(round([{ seq: 1, at: 0, origin: "human", type: "comment", key: "shot", ver: "v0", text: "x" }, decide(2, "Approve", undefined)], "v9"), ["done", 1, []]);
  const ask = [
    { seq: 1, at: 0, origin: "agent", type: "ask", decision: { id: "q", key: "shot", question: "?", options: [{ label: "A" }, { label: "B" }] } },
    { seq: 2, at: 0, origin: "human", type: "decide", decision: "q", option: "A", key: "shot", ver: "v1", delivery: "immediate" },
  ];
  const q = publicState(derive(ask, () => "v2")).decisions[0];
  assert.deepEqual([q.state, q.round, q.history, q.answer], ["done", 1, [], "A"], "an answered ask is not reset by its Key's new version");
  // Review of 2.11.0: answers kept in the browser without a session have falling negative seqs; their order is the log's.
  const local = [decide(-1, "Approve", "v1", { local: true }), decide(-2, "Rework", "v2", { local: true })];
  assert.deepEqual(round(local, "v3").slice(0, 2), ["changed", 3]);
  assert.deepEqual(round(local, "v3")[2].map((h) => [h.round, h.answer]), [[1, "Approve"], [2, "Rework"]]);
  // Reviews 2 and 3: content restored to the version of the newest answer is that version again, whether or not the
  // Event Log saw the version in between (an Update records none), and that answer holds (149: bound to its version).
  const back = [decide(1, "Approve", "v1"), { seq: 2, at: 0, origin: "human", type: "comment", key: "shot", ver: "v2", text: "x", delivery: "immediate" }];
  assert.deepEqual([round(back, "v2"), round(back, "v1")], [["changed", 2, [{ round: 1, ver: "v1", answer: "Approve", custom: false, note: null }]], ["done", 1, []]]);
  assert.deepEqual([round(v1.slice(0, 1), "v2").slice(0, 2), round(v1.slice(0, 1), "v1").slice(0, 2)], [["changed", 2], ["done", 1]], "the same without any event on v2");
  // Back on v1 after the newest answer was given on v2: that answer is for v2, so v1 asks again.
  assert.deepEqual(round([...v2], "v1"), ["changed", 1, [{ round: 2, ver: "v2", answer: "Rework", custom: false, note: null }]]);
  // A Close or Still applies names its thread, not the Key; the version it records counts for the thread's Key.
  const closed = [{ seq: 1, at: 0, origin: "human", type: "comment", key: "shot", ver: "v1", text: "x", delivery: "immediate" }, decide(2, "Approve", "v1"), { seq: 3, at: 0, origin: "human", type: "close", target: 1, ver: "v2" }];
  assert.deepEqual(round(closed, "v3").slice(0, 2), ["changed", 3]);
  // A Key not on the Page has no current version: its answer stays as it was, as before 2.11.0.
  assert.deepEqual(round(v2, null), ["done", 1, []]);
});

test("per-Key counts are own data for any Key name (review of 2.11.0)", async () => {
  const { publicState } = await import("./kernel/atelier.js");
  const log = ["__proto__", "constructor"].map((key, i) => ({ seq: i + 1, at: 0, origin: "agent", type: "ask", decision: { id: `q${i}`, key, question: "?", options: [{ label: "A" }, { label: "B" }] } }));
  const s = publicState(derive(log));
  assert.deepEqual(JSON.parse(JSON.stringify(s.keys)), JSON.parse('{"__proto__":{"new":1,"changed":0,"done":0,"threads":0},"constructor":{"new":1,"changed":0,"done":0,"threads":0}}'));
  assert.equal(Object.prototype.new, undefined, "no count leaks onto Object.prototype");
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
    assert.match(readFileSync(path.join(dir, "atelier.js"), "utf8"), /^\/\/ atelier-copy 2\.11\.0 sha256:[0-9a-f]{64}/);
    assert.deepEqual(copyKernel(dir).map((c) => c.outcome), ["current", "current"]);
    const file = path.join(dir, "atelier.js");
    const edited = `${readFileSync(file, "utf8")}\n// local fix\n`;
    writeFileSync(file, edited);
    assert.equal(copyKernel(dir)[0].outcome, "changed");
    assert.equal(readFileSync(file, "utf8"), edited, "the local change survives");
    // An unchanged older copy is reported, not replaced (decision 136).
    const old = "// atelier-copy 0.9.0 sha256:" + "0".repeat(64) + " old\n";
    const body = "export {};\n";
    writeFileSync(file, old.replace("0".repeat(64), createHash("sha256").update(body).digest("hex")) + body);
    assert.equal(copyKernel(dir)[0].outcome, "behind");
    assert.match(readFileSync(file, "utf8"), /0\.9\.0/);
    // k-stamp: a hand-copied Kernel, byte-identical but without the stamp line, is current, not changed.
    const source = readFileSync(new URL("./kernel/atelier.js", import.meta.url), "utf8");
    writeFileSync(file, source);
    assert.equal(copyKernel(dir)[0].outcome, "current");
    assert.equal(readFileSync(file, "utf8"), source, "left as it is");
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
    assert.match(messages[0].m.content, /^Atelier [^\n]*\npage\.html \(http/);
    assert.match(messages[0].m.content, /kept the recommendation/);
    handlers.message_end({ message: { role: "custom", ...messages[0].m } });
    handlers.agent_settled();
    assert.deepEqual(readLog(path.join(root, "page.html")).slice(-2).map((e) => e.type), ["delivered", "received"]);
    await assert.rejects(run({ action: "ask", decision: { id: "e", question: "?", options: [{ label: "A", consequence: "", recommended: true }, { label: "B", consequence: "", recommended: true }] } }), /at most one/);
    const asked = await run({ action: "ask", decision: { id: "e", question: "?", options: [{ label: "A", consequence: "" }, { label: "B", consequence: "" }] } });
    assert.match(asked.content[0].text, /posted/, "a recommendation is optional (155)");
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

// Decision 155: a Page declares Decisions with atl-decide, and answers stay editable.
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
  assert.equal(compose("/abs/dir/atelier.html", "http://127.0.0.1:1/x", [c], [c]), 'Atelier Comment on how/step-write: "too long"\natelier.html (http://127.0.0.1:1/x)\n- #6 Comment on how/step-write: "too long"');
});

test("a thread shows every message in order; only threads over four messages fold their middle", () => {
  const msgs = (n) => Array.from({ length: n }, (_, i) => ({ seq: i + 1 }));
  assert.deepEqual(threadLayout(msgs(2)), { head: msgs(2), folded: [], tail: [] }, "the human's own Comment stays visible");
  assert.deepEqual(threadLayout(msgs(4)).head.length, 4);
  const long = threadLayout(msgs(7));
  assert.deepEqual([long.head, long.folded, long.tail].map((part) => part.map((m) => m.seq)), [[1], [2, 3, 4, 5], [6, 7]]);
  assert.equal(threadLayout(msgs(7), true).head.length, 7, "expanded");
  assert.deepEqual(threadLayout(msgs(2), false, true), { head: [], folded: msgs(2), tail: [] }, "closed collapses");
  assert.equal(threadLayout(msgs(2), true, true).head.length, 2, "closed, opened");
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

test("send on save: a Comment goes out after its undo window without a Send; an undone answer is replaced (156)", async () => {
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

test("update logs its one-line note for the change indicators (156)", async () => {
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
  assert.equal(diffPreview(wordDiff("undo lasts 30 s", "undo lasts 3 s")), "…undo lasts 30 → 3…");
  assert.deepEqual(wordDiff("same", "same"), [["=", "same"]]);
  assert.equal(diffPreview(wordDiff("same", "same")), "");
});

test("publicState: the read-only Kernel state a Page script may rely on (k-state-hook)", async () => {
  const { publicState } = await import("./kernel/atelier.js");
  const log = [
    { seq: 1, at: 0, origin: "agent", type: "ask", decision: { id: "ship", key: "a", question: "Ship?", options: [{ label: "Yes", recommended: true }, { label: "No" }] } },
    { seq: 2, at: 0, origin: "human", type: "decide", decision: "row-1", key: "row-1", options: "Keep|Drop", option: "Drop", note: "old", images: ["p.html.images/0123456789abcdef.png"], delivery: "immediate" },
    { seq: 3, at: 0, origin: "kernel", type: "delivered", of: [2] },
    { seq: 4, at: 0, origin: "human", type: "comment", key: "a", text: "x", delivery: "immediate" },
  ];
  const s = publicState(derive(log, () => null, [{ id: "row-2", key: "row-2", declared: true, options: [{ label: "Keep" }, { label: "Drop" }] }]), { conn: "live", loaded: true });
  assert.deepEqual(s.decisions.map((d) => [d.id, d.declared, d.recommended, d.answer, d.note, d.status]), [["row-2", true, null, null, null, null], ["ship", false, "Yes", null, null, null], ["row-1", true, null, "Drop", "old", "queued"]]);
  assert.deepEqual(s.decisions.map((d) => d.images), [[], [], ["p.html.images/0123456789abcdef.png"]]);
  assert.deepEqual(s.toAnswer, ["row-2", "ship"]);
  assert.deepEqual(s.threads, [{ seq: 4, key: "a", closed: false, stale: false, messages: 1, status: "pending" }]);
  assert.deepEqual([s.conn, s.loaded, s.open, s.drafts], ["live", true, 3, 0]);
  assert.doesNotThrow(() => JSON.stringify(s), "plain data");
});

// POSTs one image's bytes to the upload endpoint, chunked; `end: false` leaves the body open. Resolves with the response.
function upload(host, page, chunks, { end = true } = {}) {
  const req = http.request(`${new URL(host.url(page)).origin}/.atelier/image?page=${encodeURIComponent(host.rel(page))}`, { method: "POST" });
  req.on("error", () => {}); // the host may close the connection after refusing
  const response = new Promise((resolve, reject) => {
    req.on("response", (res) => { let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(body) })); });
    setTimeout(() => reject(new Error("no response while the body was still open")), 5000).unref();
  });
  for (const c of chunks) req.write(c);
  if (end) req.end();
  return { req, response };
}

test("a Decision's answer carries a note and images: uploaded one by one, stored beside the Page by their bytes, delivered by absolute path", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest of a png")]);
    const base = new URL(host.url(page)).origin, dir = path.join(host.root, "page.html.images");
    // The bytes decide: a non-image is refused whatever the client calls it.
    assert.equal((await upload(host, page, [Buffer.from("<svg/>")]).response).status, 415);
    // An oversized image is refused while it is still arriving, not at its end: this body never ends.
    const big = upload(host, page, Array(11).fill(Buffer.alloc(1024 * 1024, 1)), { end: false });
    assert.equal((await big.response).status, 413);
    big.req.destroy();
    // A hash-named file already at the destination is replaced, never trusted: here a symlink out of the directory.
    const outside = path.join(host.root, "outside.png"), hashed = `${createHash("sha256").update(png).digest("hex").slice(0, 16)}.png`;
    writeFileSync(outside, png); mkdirSync(dir); symlinkSync(outside, path.join(dir, hashed));
    const stored = await upload(host, page, [png.subarray(0, 5), png.subarray(5)]).response;
    assert.deepEqual(stored, { status: 200, json: { name: `page.html.images/${hashed}` } }, "named by content hash and sniffed type");
    assert(lstatSync(path.join(dir, hashed)).isFile(), "the symlink is replaced by the stored bytes");
    assert.deepEqual(readFileSync(path.join(dir, hashed)), png);
    const name = stored.json.name;
    // Only a few uploads receive at once; the next is refused until one finishes.
    const open = Array.from({ length: 4 }, () => upload(host, page, [png.subarray(0, 4)], { end: false }));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await upload(host, page, [png]).response).status, 429);
    open.forEach((o) => o.req.destroy());
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await upload(host, page, [png]).response).status, 200, "free again once they close");

    // A decide event names only stored images: no data, symlink, directory, foreign name or missing file, at most four.
    writeFileSync(path.join(dir, "shot.png"), png);
    symlinkSync(path.join(dir, hashed), path.join(dir, "aaaaaaaaaaaaaaaa.png"));
    mkdirSync(path.join(dir, "bbbbbbbbbbbbbbbb.png"));
    writeFileSync(path.join(dir, "cccccccccccccccc.gif"), png); // bytes that are not what the name says
    execFileSync("mkfifo", [path.join(dir, "dddddddddddddddd.png")]); // opening a FIFO would block the host forever
    for (const bad of [`data:image/png;base64,${png.toString("base64")}`, "page.html.images/aaaaaaaaaaaaaaaa.png", "page.html.images/bbbbbbbbbbbbbbbb.png",
      "page.html.images/shot.png", "page.html.images/cccccccccccccccc.gif", "page.html.images/dddddddddddddddd.png", "page.html.images/0123456789abcdef.png", `page.html.images/../page.html.images/${hashed}`, `other.html.images/${hashed}`])
      assert.equal(human({ type: "decide", decision: "d", option: "A", images: [bad] }).status, 400, bad);
    assert.equal(human({ type: "decide", decision: "d", option: "A", images: Array(5).fill(name) }).status, 400);
    // The event body is bounded as before images existed.
    const long = await fetch(`${base}/.atelier/events?page=page.html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "comment", text: "x".repeat(65 * 1024) }) });
    assert.equal(long.status, 413);
    assert.equal(readLog(page).length, 0);

    const first = human({ type: "decide", decision: "d", options: "A|B", option: "A", note: "see shot", images: [name] }).json.entry;
    assert.deepEqual(first.images, [name]);
    // An answer changed inside its undo window keeps the stored images of the one it replaces.
    human({ type: "undo", target: first.seq });
    const changed = human({ type: "decide", decision: "d", options: "A|B", option: "B", note: "see shot", images: [name] });
    assert.deepEqual(changed.json.entry.images, [name]);
    tick(UNDO);
    host.deliverDue(page);
    assert.match(sent[0].message.content, new RegExp(`Decision d: B; note "see shot"; image ${JSON.stringify(path.join(host.root, name)).replace(/[.\\/]/g, "\\$&")}$`));
    assert.equal((await fetch(`${base}/${name}`)).headers.get("content-type"), "image/png", "the Page shows it as a thumbnail");
    // Copy from a Page without a session names browser-only images instead of pasting their data.
    assert.match(compose("p", "", [{ seq: 1, type: "decide", decision: "d", option: "A", images: [`data:image/png;base64,${png.toString("base64")}`] }], []), /Decision d: A; image \(kept in the browser only\)$/);
  } finally { host.stop(); p.done(); }
});

test("Other…: an own answer posts as a custom decide event, is delivered as own answer, and changes like any answer (2.7.0)", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    const own = human({ type: "decide", decision: "flow/verdict", key: "flow/verdict", options: "Clear|Unclear", option: "A diagram, step by step", custom: true, note: "like a flowchart" });
    assert.equal(own.status, 200);
    assert.equal(own.json.entry.custom, true);
    assert.equal(human({ type: "decide", decision: "d", option: "x", custom: "yes" }).status, 400, "custom is a boolean");
    assert.equal(human({ type: "decide", decision: "d", option: "  ", custom: true }).status, 400, "an own answer needs text");
    const st = derive(readLog(page));
    assert.deepEqual([st.decisions[0].answer.option, st.decisions[0].answer.custom, st.toAnswer.length], ["A diagram, step by step", true, 0], "an own answer answers the Decision");
    tick(UNDO);
    host.deliverDue(page);
    assert.match(sent.at(-1).message.content, /- #1 Decision flow\/verdict: own answer: "A diagram, step by step"; note "like a flowchart"$/);
    // Changed back to an option: delivered as X → Y, like any change.
    human({ type: "decide", decision: "flow/verdict", key: "flow/verdict", options: "Clear|Unclear", option: "Clear", previous: "A diagram, step by step" });
    tick(UNDO);
    host.deliverDue(page);
    assert.match(sent.at(-1).message.content, /Decision flow\/verdict: A diagram, step by step → Clear$/);
    const again = human({ type: "decide", decision: "flow/verdict", key: "flow/verdict", options: "Clear|Unclear", option: "Both", previous: "Clear", custom: true }).json.entry;
    assert.match(compose("p", "", [again], readLog(page)), /Clear → own answer: "Both"$/);
    human({ type: "undo", target: again.seq });
    assert.equal(derive(readLog(page)).decisions[0].answer.option, "Clear", "undo restores the earlier answer");
  } finally { host.stop(); p.done(); }
});

test("a Comment and a reply carry images: only stored ones, delivered by absolute path (2.7.0)", async () => {
  const p = project();
  const { host, page, sent, tick, human } = await hostOn(p);
  try {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("a screenshot")]);
    const name = (await upload(host, page, [png]).response).json.name;
    for (const bad of [[`data:image/png;base64,${png.toString("base64")}`], ["page.html.images/0123456789abcdef.png"], ["../outside.png"], Array(5).fill(name), "page.html.images/x.png", [1]])
      assert.equal(human({ type: "comment", key: "a", text: "see", images: bad }).status, 400, JSON.stringify(bad));
    const root = human({ type: "comment", key: "a", text: "this looks off", images: [name] }).json.entry;
    assert.deepEqual(root.images, [name]);
    const reply = human({ type: "comment", thread: root.seq, key: "a", text: "and here", images: [name, name] }).json.entry;
    assert.equal(human({ type: "comment", key: "a", text: "no images", images: [] }).json.entry.images, undefined, "an empty list is dropped");
    tick(UNDO);
    host.deliverDue(page);
    const file = JSON.stringify(path.join(host.root, name));
    const lines = sent.at(-1).message.content.split("\n");
    assert.equal(lines.find((l) => l.includes(`#${root.seq} Comment`)).endsWith(`: "this looks off"; image ${file}`), true, lines.join("\n"));
    assert.equal(lines.find((l) => l.includes(`#${reply.seq} Reply`)).endsWith(`: "and here"; images ${file}, ${file}`), true);
    assert.match(compose("p", "", [{ seq: 9, type: "comment", text: "t", images: ["data:image/png;base64,AA"] }], []), /Comment on the Page: "t"; image \(kept in the browser only\)$/);
  } finally { host.stop(); p.done(); }
});

// ---- Receiver handover: one serving endpoint per Page (URL, tabs, Undo), one current receiver session.
// Sessions in one process, as under PI WEB's sessiond; they share one fake clock.
function sessions(p) {
  let clock = 1_000_000;
  const page = path.join(realpathSync(p.root), "page.html");
  // idle: whether the session is between runs (default: always); quiesceMs: how long its takeover waits for that.
  const make = (id, { hold = false, idle, quiesceMs } = {}) => {
    const s = { id, sent: [], held: [], handoffs: [] };
    s.host = createHost({
      root: p.root, sessionId: id, label: `Chat ${id}`, now: () => clock, watchdogMs: 60_000, idle, quiesceMs,
      // hold: the session keeps the send (a checkpoint barrier or a run still starting), so it is never queued to Pi.
      send: (m, done, failed) => { if (hold) s.held.push({ m, done, failed }); else { s.sent.push(m); done(true); } },
      handoff: (m) => s.handoffs.push(m),
    });
    return s;
  };
  return { page, make, tick: (ms) => { clock += ms; }, lock: () => JSON.parse(readFileSync(`${page}.events.jsonl.lock`, "utf8")) };
}

// Reads a Page's event stream: next(name) resolves the next event of that name.
function stream(url) {
  const got = [];
  const u = new URL(url);
  const req = http.get(`${u.origin}/.atelier/stream?page=${encodeURIComponent(decodeURIComponent(u.pathname.slice(1)))}`, (res) => {
    let buf = "";
    res.on("data", (c) => {
      buf += c;
      for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
        const block = buf.slice(0, i);
        got.push({ name: /^event: (.*)$/m.exec(block)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "null") });
      }
    });
  });
  req.on("error", () => {});
  return {
    async next(name) {
      for (let i = 0; i < 200; i += 1) {
        const at = got.findIndex((g) => g.name === name);
        if (at >= 0) return got.splice(at, 1)[0].data;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no ${name} event`);
    },
    close: () => req.destroy(),
  };
}

test("receiver (a): a second session in the same process is refused with a takeover hint", async () => {
  const p = project();
  const { page, make } = sessions(p);
  const a = make("a"), b = make("b");
  try {
    assert.equal((await a.host.open(page)).generation, 1);
    await assert.rejects(b.host.open(page), /another live Pi session \(Chat a\)[\s\S]*takeover[\s\S]*generation 1/);
    assert.equal((await a.host.open(page)).generation, 1, "open stays idempotent for the receiver");
  } finally { a.host.stop(); b.host.stop(); p.done(); }
});

test("receiver: a lock from an ended session of this process is stale; another process's live session is never taken over (review 3, 4)", async () => {
  const p = project();
  const { page, make } = sessions(p);
  const file = `${page}.events.jsonl.lock`;
  const a = make("a"), b = make("b"), c = make("c");
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, session: "ended", generation: 3 }));
    assert.equal((await a.host.open(page)).generation, 4, "same process, no live runtime: stale");
    a.host.stop();
    assert.equal(existsSync(file), false, "released");
    assert.equal((await b.host.open(page)).generation, 5, "the process keeps counting generations");
    b.host.stop();
    const far = JSON.stringify({ pid: process.ppid, session: "far", label: "Chat far", generation: 5 });
    writeFileSync(file, far);
    await assert.rejects(c.host.open(page), /held by session Chat far in another process[\s\S]*close or \/reload it first/);
    await assert.rejects(c.host.takeover(page, 5), /held by session Chat far in another process[\s\S]*close or \/reload it first/, "cross-process takeover is refused");
    assert.equal(readFileSync(file, "utf8"), far, "its lock is untouched");
    assert.deepEqual(readdirSync(p.root).filter((f) => f.endsWith(".claim")), [], "no claim file");
  } finally { a.host.stop(); b.host.stop(); c.host.stop(); p.done(); }
});

test("receiver: a live receiver of an older Atelier (lock without generation) is never fenced; close or /reload it first (review 1)", async () => {
  const p = project();
  const { page, make } = sessions(p);
  const file = `${page}.events.jsonl.lock`;
  const a = make("a");
  try {
    for (const pid of [process.ppid, process.pid]) {
      const old = JSON.stringify({ pid, session: "old" });
      writeFileSync(file, old);
      await assert.rejects(a.host.open(page), /session old, which runs an older Atelier[\s\S]*close or \/reload it first/);
      await assert.rejects(a.host.takeover(page, 0), /session old, which runs an older Atelier[\s\S]*close or \/reload it first/);
      assert.equal(readFileSync(file, "utf8"), old, "its lock is untouched");
    }
    writeFileSync(file, JSON.stringify({ pid: spawnSync(process.execPath, ["-e", "0"]).pid, session: "old" }));
    assert.equal((await a.host.open(page)).generation, 1, "its process is gone: stale");
  } finally { a.host.stop(); p.done(); }
});

test("receiver: two takeovers of one generation in this process: exactly one wins (review 4)", async () => {
  const p = project();
  const { page, make, lock } = sessions(p);
  const a = make("a"), b = make("b"), c = make("c");
  try {
    await a.host.open(page);
    const results = await Promise.allSettled([b.host.takeover(page, 1), c.host.takeover(page, 1)]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    assert.match(results.find((r) => r.status === "rejected").reason.message, /changed since generation 1/);
    assert.equal(lock().generation, 2);
    assert.ok(["b", "c"].includes(lock().session));
  } finally { a.host.stop(); b.host.stop(); c.host.stop(); p.done(); }
});

test("receiver: takeover waits until the old receiver is idle, refuses while it stays busy, and gives the successor the unfinished Requests (review 5)", async () => {
  const p = project();
  const { page, make, lock } = sessions(p);
  let idle = false;
  const a = make("a", { idle: () => idle }), b = make("b", { quiesceMs: 200 }), c = make("c", { quiesceMs: 5_000 });
  try {
    await a.host.open(page);
    a.host.postHuman(page, { type: "request", job: "rerun", key: "a" });
    a.host.agent(page, { type: "status", target: 1, state: "running" });
    await assert.rejects(b.host.takeover(page, 1), /Chat a is busy[\s\S]*Try again/);
    assert.equal(lock().session, "a", "not forced");
    const moving = c.host.takeover(page, 1);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(lock().session, "a", "still waiting");
    idle = true;
    const moved = await moving;
    assert.equal(moved.generation, 2);
    assert.match(moved.unfinished.join("\n"), /Request #1 "rerun" \(running/, "the successor gets the snapshot");
    assert.match(a.handoffs[0].content, /Request #1 "rerun" \(running/, "the old receiver still gets its handoff note");
  } finally { a.host.stop(); b.host.stop(); c.host.stop(); p.done(); }
});

test("receiver (h): a receipt or seen from an earlier generation, or without one, changes nothing", async () => {
  const p = project();
  const { page, make, tick } = sessions(p);
  const a = make("a"), b = make("b");
  const received = () => readLog(page).filter((e) => e.type === "received");
  try {
    await a.host.open(page);
    a.host.postHuman(page, { type: "decide", decision: "d1", option: "A" });
    tick(UNDO);
    a.host.deliverDue(page);
    const old = a.sent[0].details;
    await b.host.takeover(page, 1);
    a.host.seen(old); a.host.receipt(old); a.host.settled();
    b.host.seen(old); b.host.receipt(old); b.host.settled();
    b.host.receipt({ page, seqs: old.seqs });
    assert.deepEqual(received(), [], "generation 1 and no generation are not B's");
    b.host.receipt(b.sent[0].details);
    assert.deepEqual(received().map((e) => e.of), [[1]]);
  } finally { a.host.stop(); b.host.stop(); p.done(); }
});

test("receiver (b): takeover moves Delivery; the old receiver's held send, deliveries and mutations are fenced", async () => {
  const p = project();
  const { page, make, tick } = sessions(p);
  const a = make("a", { hold: true }), b = make("b");
  try {
    await a.host.open(page);
    a.host.postHuman(page, { type: "request", job: "rerun", key: "a" });
    tick(UNDO);
    assert.equal(a.host.deliverDue(page), 1, "handed to A's send, which holds it");
    const moved = await b.host.takeover(page, 1);
    assert.equal(moved.generation, 2);
    assert.equal(a.host.current(a.held[0].m.details), false, "A's held send must not go out");
    a.held[0].done(true);
    assert.equal(readLog(page).filter((e) => e.type === "delivered" && e.session === "a").length, 0, "A's late callback is ignored");
    assert.equal(b.sent.length, 1, "the never-queued event goes to B at takeover");
    assert.match(b.sent[0].content, /Request "rerun"/);
    assert.equal(b.sent[0].details.uncertain, undefined, "never queued, so not uncertain");
    a.host.postHuman(page, { type: "comment", key: "a", text: "after" });
    tick(UNDO);
    assert.equal(a.host.deliverDue(page), 0, "A delivers nothing");
    assert.throws(() => a.host.agent(page, { type: "answer", target: 1, text: "x" }), /handed over to Chat b/);
    assert.throws(() => a.host.update(page), /handed over to Chat b/);
    assert.equal(a.handoffs.length, 1);
    assert.match(a.handoffs[0].content, /Chat b[\s\S]*Request #1 "rerun"/, "the old session learns what it leaves unfinished");
  } finally { a.host.stop(); b.host.stop(); p.done(); }
});

test("receiver (b): takeover waits while the old session's run starts; the successor gets the unfinished Requests (review 5)", async () => {
  const p = project();
  const root = realpathSync(p.root), page = path.join(root, "page.html"), old = Date.now() - 60_000;
  appendLog(page, { origin: "human", type: "request", job: "a", delivery: "immediate" }, old);
  appendLog(page, { origin: "human", type: "comment", text: "c", delivery: "send" }, old);
  appendLog(page, { origin: "human", type: "send", delivery: "boundary" }, old);
  const fake = (id) => {
    const tools = new Map(), handlers = {}, messages = [];
    atelierExtension({ registerTool: (t) => tools.set(t.name, t), on: (n, fn) => { handlers[n] = fn; }, sendMessage: (m, o) => messages.push({ ...m, o }), getSessionName: () => `Chat ${id}` });
    const ctx = { cwd: p.root, idle: true, isIdle: () => ctx.idle, sessionManager: { getSessionId: () => `${id}-${process.pid}` } };
    handlers.session_start({}, ctx);
    return { ctx, handlers, messages, run: (params) => tools.get("atelier").execute("id", { page: "page.html", ...params }, undefined, undefined, ctx) };
  };
  const a = fake("ha"), b = fake("hb");
  try {
    const opened = await a.run({ action: "open" });
    assert.equal(opened.details.generation, 1);
    assert.deepEqual(a.messages.map((m) => m.customType), ["atelier:immediate"], "the send is held while A's run starts");
    await assert.rejects(b.run({ action: "open" }), /takeover/);
    let done = false;
    const moving = b.run({ action: "takeover", generation: 1 }).finally(() => { done = true; });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(done, false, "a run that is still starting is not idle: takeover waits");
    a.ctx.idle = false;
    a.handlers.agent_start();
    assert.deepEqual(a.messages.map((m) => m.customType), ["atelier:immediate", "atelier:send"], "A still receives while takeover waits");
    a.ctx.idle = true;
    a.handlers.agent_settled();
    const moved = await moving;
    assert.match(moved.content[0].text, /now goes to this session/);
    assert.match(moved.content[0].text, /Unfinished[\s\S]*Request #1 "a" \(not started/, "the successor gets the unfinished Requests");
    b.handlers.agent_start();
    assert.deepEqual(a.messages.map((m) => m.customType), ["atelier:immediate", "atelier:send", "atelier:handoff"], "A is told");
    assert.equal(a.messages[2].o.deliverAs, "steer");
    assert.deepEqual(b.messages.map((m) => m.customType).sort(), ["atelier:immediate", "atelier:send"]);
    assert.match(b.messages.find((m) => m.customType === "atelier:immediate").content, /may already have reached Chat ha/, "queued to A, never confirmed: flagged, not silently repeated");
    await assert.rejects(a.run({ action: "update" }), /handed over to Chat hb/);
  } finally { a.handlers.session_shutdown(); b.handlers.session_shutdown(); p.done(); }
});

test("receiver (c): an event in its undo window at takeover is delivered once; a queued, unconfirmed one is flagged", async () => {
  const p = project();
  const { page, make, tick } = sessions(p);
  const a = make("a"), b = make("b");
  try {
    await a.host.open(page);
    a.host.postHuman(page, { type: "decide", decision: "d1", option: "A" });
    tick(UNDO);
    assert.equal(a.host.deliverDue(page), 1, "queued to A, not yet confirmed");
    a.host.postHuman(page, { type: "comment", key: "a", text: "late" });
    tick(1_000);
    await b.host.takeover(page, 1);
    assert.equal(b.sent.length, 1);
    assert.deepEqual(b.sent[0].details.uncertain, [1]);
    assert.match(b.sent[0].content, /#1 may already have reached Chat a/);
    tick(UNDO);
    assert.equal(a.host.deliverDue(page), 0);
    assert.equal(b.host.deliverDue(page), 1);
    assert.match(b.sent[1].content, /"late"/);
    assert.equal(b.host.deliverDue(page), 0, "once");
    assert.equal(a.sent.length, 1);
  } finally { a.host.stop(); b.host.stop(); p.done(); }
});

test("receiver (d): the tab's URL and Undo keep working across takeover and after the opener ends", async () => {
  const p = project();
  const { page, make, tick } = sessions(p);
  const a = make("a"), b = make("b");
  try {
    const { url } = await a.host.open(page);
    const post = async (body) => { const r = await fetch(`${new URL(url).origin}/.atelier/events?page=page.html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
    const first = await post({ type: "decide", decision: "d", option: "A" });
    tick(1_000);
    assert.equal((await b.host.takeover(page, 1)).url, url, "same URL");
    assert.equal((await post({ type: "undo", target: first.json.entry.seq })).status, 200, "Undo inside the window still works");
    a.host.stop();
    assert.equal((await fetch(url)).status, 200, "the endpoint outlives the session that opened it");
    assert.equal((await post({ type: "comment", key: "a", text: "after" })).status, 200);
    tick(UNDO);
    assert.equal(b.host.deliverDue(page), 1);
    assert.match(b.sent[0].content, /"after"/);
    assert.doesNotMatch(b.sent[0].content, /Decision/, "the undone answer is not delivered");
    b.host.stop();
    await assert.rejects(fetch(url), "the endpoint closes with its last session");
  } finally { a.host.stop(); b.host.stop(); p.done(); }
});

test("receiver (e, f): a stale-generation takeover is rejected; a plain re-open by the old receiver does not reclaim", async () => {
  const p = project();
  const { page, make, lock } = sessions(p);
  const a = make("a"), b = make("b"), c = make("c");
  try {
    await a.host.open(page);
    await b.host.takeover(page, 1);
    await assert.rejects(c.host.takeover(page, 1), /changed[\s\S]*Chat b[\s\S]*generation 2/, "c saw generation 1, B holds 2");
    await assert.rejects(a.host.open(page), /another live Pi session \(Chat b\)[\s\S]*takeover/);
    assert.deepEqual([lock().session, lock().generation], ["b", 2]);
  } finally { a.host.stop(); b.host.stop(); c.host.stop(); p.done(); }
});

test("receiver (g): a connected tab learns the receiver at hello and on every transfer", async () => {
  const p = project();
  const { page, make } = sessions(p);
  const a = make("a"), b = make("b");
  const { url } = await a.host.open(page);
  const s = stream(url);
  try {
    assert.deepEqual((await s.next("hello")).receiver, { label: "Chat a", generation: 1 });
    await b.host.takeover(page, 1);
    assert.deepEqual(await s.next("receiver"), { receiver: { label: "Chat b", generation: 2 } });
    b.host.stop();
    assert.deepEqual(await s.next("receiver"), { receiver: null }, "no receiver while the endpoint still serves");
  } finally { s.close(); a.host.stop(); b.host.stop(); p.done(); }
});
