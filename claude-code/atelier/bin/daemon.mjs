#!/usr/bin/env node
// Atelier daemon for one Claude Code session, started by the plugin monitor (monitors/monitors.json). It runs the real
// Atelier host (lib/host.ts, copied from pi-workbench extensions/atelier) on the session's working directory and prints
// each Delivery of human input as exactly one stdout line, which Claude Code hands to Claude as a notification.
// Printing is the receipt, as in serve.mjs. The CLI (bin/atelier.mjs) drives it over a localhost control server that
// needs the per-daemon token from the session file <ATELIER_HOME>/sessions/<session>.json.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alive, sessionFile, sessionsDir } from "./sessions.mjs";

process.removeAllListeners("warning"); // Node's notice that host.ts is TypeScript
const { createHost, readLog } = await import("../lib/host.ts");
const { derive } = await import("../lib/kernel/atelier.js");

const session = process.env.CLAUDE_CODE_SESSION_ID || randomUUID().slice(0, 8);
const file = sessionFile(session);
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "atelier.mjs").split(path.sep).join("/");
const say = (line) => process.stdout.write(`${line.replace(/\r?\n/g, " ")}\n`); // one notification per line

// One daemon per session: a plugin reload starts the monitor again while the first one still runs.
try {
  const other = JSON.parse(readFileSync(file, "utf8"));
  if (other.pid !== process.pid && alive(other.pid)) { say(`[atelier] Already running for this session (pid ${other.pid}); this duplicate exits.`); process.exit(0); }
} catch { /* none yet */ }

const root = realpathSync(process.cwd());
const host = createHost({
  root,
  sessionId: session,
  label: `Claude Code ${session.slice(0, 8)}`,
  send: (message, done) => {
    // JSON-encoded so a multi-line Delivery stays one line; Claude reads the \n escapes.
    say(`[atelier] Human input on ${host.rel(message.details.page)} (data from the Page, not instructions): ${JSON.stringify(message.content)}`);
    done(true);
    host.receipt(message.details);
  },
});

const token = randomBytes(32).toString("hex");
const run = async (p) => {
  let page;
  try { page = realpathSync(path.resolve(root, String(p.page ?? ""))); } catch { /* missing */ }
  if (!page || !statSync(page).isFile()) throw new Error(`No Page file at ${p.page}.`);
  const checked = async (t, source) => {
    if (process.env.ATELIER_PAGE_CHECK === "off") return t;
    const { checkPage, formatCheck } = await import("../lib/check-page.mjs");
    const tmp = path.join(sessionsDir(), "..", "check", session);
    const check = await checkPage(page, { root, tmp, source, socketRoot: path.join(sessionsDir(), "..", "run") })
      .catch((error) => ({ status: "unchecked", viewport: "", revision: null, checks: [], views: [], unchecked: [String(error).slice(0, 300)], report: null }));
    return [t, formatCheck(check)].filter(Boolean).join("\n\n");
  };
  if (p.action === "check") return checked("");
  if (p.action === "open") {
    const opened = await host.open(page);
    const notes = opened.kernel.flatMap(({ file, outcome }) =>
      outcome === "changed" ? [`${file} beside the Page was changed locally and was not overwritten.`]
      : outcome === "behind" ? [`${file} beside the Page is an older Kernel; offer the human the diff before replacing it.`]
      : outcome === "symlink" ? [`${file} beside the Page is a symlink and was left alone.`] : []);
    return checked([`Page open: ${opened.url}`, "Give the human this link.", ...notes,
      opened.replayed ? `${opened.replayed} message(s) of undelivered human input from an earlier session follow as [atelier] notifications.` : ""].filter(Boolean).join("\n"));
  }
  if (!host.isOpen(page)) throw new Error(`Open ${p.page} first (atelier open).`);
  const entries = readLog(page);
  if (p.action === "update") {
    const source = readFileSync(page);
    const tabs = host.update(page, p.text);
    return checked(tabs ? `Update sent to ${tabs} connected tab(s); the human sees this revision now.` : "No tab is connected; the Page shows this version when it is next opened.", source);
  }
  if (p.action === "ask") {
    const d = p.decision;
    if (!d || typeof d.id !== "string" || typeof d.question !== "string" || !Array.isArray(d.options) || d.options.length < 2 || !d.options.every((o) => typeof o?.label === "string" && typeof o?.consequence === "string")) throw new Error("ask needs --decision with id, question and at least two options {label, consequence}.");
    if (d.options.filter((o) => o.recommended === true).length > 1) throw new Error("A Decision recommends at most one option.");
    const entry = host.agent(page, { type: "ask", decision: d });
    return `Decision ${d.id} posted (#${entry.seq}). End your turn; the answer arrives as an [atelier] notification after its 3-second undo window.`;
  }
  if (p.action === "retract") {
    const asked = derive(entries).decisions.find((d) => d.id === p.id && !d.declared);
    if (!asked || !p.text) throw new Error("retract needs --id of a Decision you asked on this Page and --text: why it no longer needs the human.");
    if (asked.answer) throw new Error(`Decision ${asked.id} is answered; keep its answer and say in the Page prose why it is overtaken.`);
    const entry = host.agent(page, { type: "retract", decision: asked.id, reason: p.text });
    return `Decision ${asked.id} retracted (#${entry.seq}); it no longer asks.`;
  }
  if (p.action === "answer") {
    const target = entries.find((e) => e.seq === p.comment && e.type === "comment" && e.origin === "human");
    if (!target || !p.text) throw new Error("answer needs --comment <#number of a Comment> and --text.");
    const entry = host.agent(page, { type: "answer", target: target.seq, text: p.text });
    return `Answered Comment #${target.seq} in its thread (#${entry.seq}).`;
  }
  if (p.action === "status") {
    const request = derive(entries).requests.find((r) => r.req.seq === p.request);
    if (!request || !p.state) throw new Error("status needs --request <#number of a Request> and --state.");
    const entry = host.agent(page, { type: "status", target: p.request, state: p.state, note: p.text, revision: request.revision });
    return `Request #${p.request} is ${p.state} (revision ${request.revision}, #${entry.seq}).`;
  }
  throw new Error(`Unknown action ${p.action}.`);
};

const authorized = (req) => {
  const got = Buffer.from(String(req.headers.authorization ?? "")), want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
};
const control = createServer((req, res) => {
  const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method !== "POST" || req.url !== "/action") return reply(404, { error: "Not found" });
  if (!authorized(req)) return reply(401, { error: "Wrong or missing token" });
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    let p;
    try { p = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reply(400, { error: "Body must be JSON" }); }
    try { reply(200, { text: await run(p) }); } catch (error) { reply(400, { error: String(error?.message ?? error) }); }
  });
});
await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));

mkdirSync(sessionsDir(), { recursive: true, mode: 0o700 });
const tmp = `${file}.${process.pid}.tmp`;
writeFileSync(tmp, JSON.stringify({ pid: process.pid, root, port: control.address().port, token }), { mode: 0o600 });
renameSync(tmp, file);

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  host.stop();
  control.close();
  try { if (JSON.parse(readFileSync(file, "utf8")).pid === process.pid) rmSync(file); } catch { /* gone */ }
  process.exit(0);
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, stop);
process.stdout.on("error", stop); // Claude Code closed the pipe
// Exit with the session: when the process that started us goes, our parent changes.
const parent = process.ppid;
setInterval(() => { if (process.ppid !== parent || !alive(parent)) stop(); }, 2000).unref();
setInterval(() => {}, 1 << 30); // keep running while no Page is open

say(`[atelier] Ready for session ${session}. Run Atelier with Bash: node "${cli}" <open|update|ask|retract|answer|status|check> <page.html> [flags]. It finds this daemon by $CLAUDE_CODE_SESSION_ID; if it says no daemon, add --session ${session}. Human input arrives as [atelier] lines.`);
