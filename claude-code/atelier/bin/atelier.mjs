#!/usr/bin/env node
// Atelier CLI for Claude Code: sends one action to this session's daemon (bin/daemon.mjs) and prints its result.
//   node atelier.mjs <open|update|ask|retract|answer|status|check> <page.html> [--text T] [--decision JSON]
//                    [--id ID] [--comment N] [--request N] [--state S] [--session ID]
// The daemon is found by --session, else $CLAUDE_CODE_SESSION_ID (Claude Code sets it in Bash), else the daemon of
// this Claude Code process ($CLAUDE_PID, which survives /clear), else the only running daemon for this directory.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { alive, sessionFile, sessionsDir } from "./sessions.mjs";

const ACTIONS = ["open", "update", "ask", "retract", "answer", "status", "check"];
const fail = (message) => { console.error(message); process.exit(1); };

let args;
try {
  args = parseArgs({ allowPositionals: true, options: { text: { type: "string" }, decision: { type: "string" }, id: { type: "string" }, comment: { type: "string" }, request: { type: "string" }, state: { type: "string" }, session: { type: "string" } } });
} catch (error) { fail(String(error.message)); }
const [action, page] = args.positionals;
if (!ACTIONS.includes(action) || !page || args.positionals.length > 2) fail(`Usage: atelier <${ACTIONS.join("|")}> <page.html> [--text T] [--decision JSON] [--id ID] [--comment N] [--request N] [--state S] [--session ID]`);
const v = args.values;
const params = { action, page: path.resolve(page), text: v.text, id: v.id, state: v.state };
if (v.comment !== undefined) params.comment = Number(v.comment.replace(/^#/, ""));
if (v.request !== undefined) params.request = Number(v.request.replace(/^#/, ""));
if (v.decision !== undefined) try { params.decision = JSON.parse(v.decision); } catch { fail("--decision must be JSON: {\"id\":…,\"question\":…,\"options\":[{\"label\":…,\"consequence\":…,\"recommended\":true}],\"key\":…}"); }

const read = (file) => { try { const d = JSON.parse(readFileSync(file, "utf8")); return alive(d.pid) ? d : undefined; } catch { return undefined; } };
function daemon() {
  const id = v.session ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (id) { const d = read(sessionFile(id)); if (d || v.session) return d; }
  let names = [];
  try { names = readdirSync(sessionsDir()).filter((n) => n.endsWith(".json")); } catch { /* none */ }
  const live = names.map((n) => read(path.join(sessionsDir(), n))).filter(Boolean);
  // After /clear the session id is new but Claude Code's process, and its daemon, are the same.
  const mine = live.filter((d) => d.claude && String(d.claude) === process.env.CLAUDE_PID);
  if (mine.length === 1) return mine[0];
  const here = live.filter((d) => process.cwd() === d.root || process.cwd().startsWith(d.root + path.sep));
  return here.length === 1 ? here[0] : undefined;
}
// The monitor starts the daemon when the atelier skill first runs; give it a moment.
let d = daemon();
for (let i = 0; !d && i < 25; i++) { await new Promise((r) => setTimeout(r, 200)); d = daemon(); }
if (!d) fail("No Atelier daemon for this Claude Code session. The plugin monitor starts it when the atelier skill first runs: invoke the skill (/atelier:atelier) if you have not. If the [atelier] Ready line named a session id, pass --session <id>.");

let res;
try {
  res = await fetch(`http://127.0.0.1:${d.port}/action`, { method: "POST", headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, body: JSON.stringify(params) });
} catch (error) { fail(`Cannot reach the Atelier daemon: ${error.cause?.code ?? error.message}`); }
const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
if (!res.ok) fail(body.error ?? `HTTP ${res.status}`);
console.log(body.text);
