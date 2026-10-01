#!/usr/bin/env node
// Agent-facing CLI over the user-local Workstream Store. Text by default, --json for scripts.
// The store owns records, revisions, and idempotency; this adapter only fills the envelope.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import {
  createUserLocalWorkstreamStore,
  WorkstreamStoreError,
} from "../../../packages/workstream-store/src/index.js";

const SELF = fileURLToPath(import.meta.url);
const STORE_DIR = process.env.PI_WORKBENCH_WORKSTREAM_DIR ?? join(homedir(), ".pi-workbench", "workstreams");
const tilde = (path) => path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path;
const WAITING = ["owner", "agent", "external"];
const SUMMARY_FIELDS = ["id", "title", "group", "revision", "createdAt", "updatedAt", "lastCheckpointAt", "next", "waitingOn", "activeSessionCount", "pendingSessionCount", "failedSessionCount", "unresolvedHumanTaskCount", "closed"];
const LIST_COLUMNS = ["id", "title", "group", "waitingOn", "updatedAt"];
const LIST_LIMIT = 8;
// Store limits (packages/workstream-store/src/model.js), checked here so errors name the flag.
const MAX = { text: 4000, title: 200, "session-title": 80, goal: 280, "done-when": 200, description: 600, history: 200, label: 200, id: 128 };

const OWNER = "  --owner           record producer=owner (the owner chose this), default producer=session\n";
const STDIN = "  --stdin           read flags from stdin as a JSON object keyed by flag name\n";
const COMMANDS = {
  list: {
    flags: { closed: "bool", all: "bool", limit: "string", fields: "string" },
    help: `workstreams list [--closed] [--all | --limit N] [--fields a,b,...] [--json]

One row per open Workstream, most recently updated first: ${LIST_COLUMNS.join(" | ")}.
  --closed          include closed Workstreams
  --all             print every row (default: ${LIST_LIMIT} most recent)
  --fields a,b      columns to print instead; valid: ${SUMMARY_FIELDS.join(", ")}
  --json            print every summary as JSON (null means "none yet")

Examples:
  workstreams list
  workstreams list --all --fields id,waitingOn,next
`,
  },
  show: {
    args: ["id"],
    flags: { full: "bool" },
    help: `workstreams show <id> [--full] [--json]

Overview, links, the newest sessions (id | title | state | waitingOn | next), and pending Human Tasks.
Long text is cut at about 200 characters.
  --full            every session and the complete text of checkpoints and overview
  --json            the complete store snapshot

Examples:
  workstreams show ws-example
  workstreams show ws-example --full
`,
  },
  create: {
    args: ["id"],
    flags: { title: "string", group: "string", owner: "bool" },
    required: ["title"],
    help: `workstreams create <id> --title "…" [--group "…"] [--owner]

Creates a Workstream. <id>: letters, digits, . _ : @ / - (max ${MAX.id}); start with ws-.
  --title           at most ${MAX.title} chars
  --group           grouping label, e.g. Embabel, PhotoQuest, Pi Workbench, Personal
${OWNER}
Examples:
  workstreams create ws-tax-2025 --title "File the 2025 tax return" --group Personal --owner
  workstreams create ws-cli-axi --title "Redesign the Workstreams CLI" --group "Pi Workbench"
`,
  },
  associate: {
    args: ["id"],
    flags: {},
    help: `workstreams associate <id>

Makes this session (PI_SESSION_ID) an active session of <id>. Repeating it is a no-op.
A session belongs to exactly one Workstream; the CLI names the other one if it is taken.

Examples:
  workstreams associate ws-example
  PI_SESSION_ID=01a0… workstreams associate ws-example
`,
  },
  checkpoint: {
    args: ["id"],
    flags: { what: "string", remains: "string", next: "string", waiting: "string", title: "string", ref: "list", owner: "bool", stdin: "bool" },
    required: ["what", "remains", "next", "waiting"],
    help: `workstreams checkpoint <id> --what "…" --remains "…" --next "…" --waiting owner|agent|external [--title "…"] [--ref PATH]...

Replaces this session's checkpoint (PI_SESSION_ID; run associate first). Repeating it is a no-op.
  --what            what now exists or works (max ${MAX.text})
  --remains         what is blocked or still owed (max ${MAX.text})
  --next            the next action, starting with the actor (max ${MAX.text})
  --waiting         owner | agent | external
  --title           this session's 2-6 word Chat title (max ${MAX["session-title"]})
  --ref             a path or repo@sha to resume from; repeat up to 20; never /tmp
${OWNER}${STDIN}
Examples:
  workstreams checkpoint ws-example --what "Fix merged as abc1234." --remains "Thomas decides X." --next "Thomas picks A or B." --waiting owner --ref "$PWD"
  workstreams checkpoint ws-example --stdin <<'JSON'
  {"what": "Long text with \\"quotes\\".", "remains": "None.", "next": "Agent continues.", "waiting": "agent", "ref": ["/abs/path"]}
  JSON
`,
  },
  overview: {
    args: ["id"],
    flags: { goal: "string", "done-when": "string", description: "string", history: "list", expect: "string", owner: "bool", stdin: "bool" },
    required: ["goal", "done-when", "description", "history"],
    help: `workstreams overview <id> --expect REV --goal "…" --done-when "…" --description "…" --history "…" [--history "…"]...

Replaces the whole Workstream overview. --expect is the revision you reviewed (see show);
if it moved, the CLI prints what changed and the revision to retry with.
  --goal            what this is for, in the owner's words (max ${MAX.goal})
  --done-when       the observable that ends it (max ${MAX["done-when"]})
  --description     why it exists; scope in and out (max ${MAX.description})
  --history         one dated, anchored event (max ${MAX.history}); repeat 1-6 times
${OWNER}${STDIN}
Examples:
  workstreams overview ws-example --expect 7 --goal "…" --done-when "…" --description "…" --history "2026-10-01: PR #12 merged."
  workstreams overview ws-example --expect 7 --stdin <<'JSON'
  {"goal": "…", "done-when": "…", "description": "…", "history": ["2026-09-30: …", "2026-10-01: …"]}
  JSON
`,
  },
  link: {
    args: ["id"],
    flags: { kind: "string", ref: "string", label: "string", "link-id": "string", owner: "bool", stdin: "bool" },
    required: ["kind", "ref"],
    help: `workstreams link <id> --kind KIND --ref REFERENCE [--label "…"] [--link-id ID]

Adds or updates a link. Repeating an identical link is a no-op.
  --kind            repository | file | plan | run | artifact | pr | …
  --ref             durable reference: repo@full-sha, absolute path, or URL; never /tmp
  --label           short label (max ${MAX.label})
  --link-id         stable id to update an existing link (default: derived from kind and ref)
${OWNER}${STDIN}
Examples:
  workstreams link ws-example --kind repository --ref "github.com/embabel/me@0123abcd…" --label "Merged fix"
  workstreams link ws-example --kind plan --ref /Users/me/repo/docs/plans/x.md
`,
  },
  unlink: {
    args: ["id", "linkId"],
    flags: { owner: "bool" },
    help: `workstreams unlink <id> <linkId> [--owner]

Removes a link; show lists link ids. Removing an absent link is a no-op.

Examples:
  workstreams unlink ws-example repository-1a2b3c4d
  workstreams unlink ws-example old-plan --owner
`,
  },
  title: {
    args: ["id", "title"],
    flags: { owner: "bool" },
    help: `workstreams title <id> "<title>" [--owner]

Renames the Workstream (max ${MAX.title}). Use --owner for an owner-supplied or approved title.

Examples:
  workstreams title ws-example "Ship the CLI redesign" --owner
  workstreams title ws-example "Redesign the Workstreams CLI"
`,
  },
  group: {
    args: ["id", "group"],
    flags: { owner: "bool" },
    help: `workstreams group <id> "<group>" [--owner]

Sets the grouping label (max ${MAX.title}).

Examples:
  workstreams group ws-example "Pi Workbench" --owner
  workstreams group ws-example PhotoQuest
`,
  },
  "resolve-task": {
    args: ["id", "taskId"],
    flags: { owner: "bool" },
    help: `workstreams resolve-task <id> <taskId> [--owner]

Resolves a Human Task the owner answered or deferred; show lists pending task ids. Repeating it is a no-op.

Examples:
  workstreams resolve-task ws-example task-choose-layout --owner
  workstreams resolve-task ws-example task-send-form
`,
  },
  close: {
    args: ["id"],
    flags: { expect: "string" },
    help: `workstreams close <id> --expect REV

Closes the Workstream on the owner's explicit instruction (producer=owner). Pending Human Tasks
and links are preserved; no files are deleted. --expect is the revision you reviewed (see show).

Examples:
  workstreams show ws-example
  workstreams close ws-example --expect 12
`,
  },
  append: {
    args: ["request"],
    flags: { stdin: "bool" },
    help: `workstreams append <request-json | @file | - | @-> [--stdin]

Raw escape hatch for rare records; prefer the verbs (checkpoint, overview, link, ...).
The request is {"workstreamId", "records": [...]}; the CLI fills a missing expectedRevision,
idempotencyKey, record producer (session), and sourceSessionId (PI_SESSION_ID).
Record types and payloads: packages/workstream-store/src/index.d.ts (WorkstreamRecord).

Examples:
  workstreams append - <<'JSON'
  {"workstreamId": "ws-example", "records": [{"type": "human-task.upsert", "payload": {"task": {"id": "task-file", "title": "Send the form"}}}]}
  JSON
  workstreams append @"$PI_TMP/request.json"
`,
  },
  watch: {
    flags: { after: "string", id: "string" },
    help: `workstreams watch [--after SEQUENCE] [--id WORKSTREAM]

Prints the store event batch after SEQUENCE as JSON (replay or snapshot mode).

Examples:
  workstreams watch --after 1200
  workstreams watch --id ws-example --after 1200
`,
  },
};

const HELP = `workstreams — Pi Workbench Workstream ledger (store: ${STORE_DIR})

Usage: workstreams [<command> [args] [--json]]   (no command: home view)

Read:   list, show <id>
Write:  create, associate, checkpoint, overview, link, unlink, title, group, resolve-task, close
Raw:    append (rare records), watch (event batches)

Run \`workstreams <command> --help\` for flags, limits, and examples.
Errors print "error:" then a "help:" line with the corrected command; exit 2 = usage, 1 = store.
`;

class Usage extends Error {
  constructor(message, help) { super(message); this.help = help; }
}

let json = false;

async function main() {
  const argv = process.argv.slice(2);
  json = argv.includes("--json");
  const [command, ...rest] = argv.filter((token) => token !== "--json");
  if (command === "--help" || command === "-h" || command === "help") return void stdout.write(HELP);
  const store = createUserLocalWorkstreamStore({ directory: STORE_DIR });
  if (command === undefined) return home(store);
  if (command === "inspect") {
    const id = rest[0]?.startsWith("{") ? safeJson(rest[0])?.workstreamId : rest[0];
    throw new Usage("inspect was replaced by show", `workstreams show ${id ?? "<id>"}`);
  }
  const spec = COMMANDS[command];
  if (!spec) throw new Usage(`unknown command ${command}`, `workstreams --help (commands: ${Object.keys(COMMANDS).join(", ")})`);
  if (rest.includes("--help") || rest.includes("-h")) return void stdout.write(spec.help);
  const { args, flags } = await parse(command, spec, rest);
  return handlers[command](store, args, flags);
}

async function parse(command, spec, tokens) {
  const flags = {};
  const args = [];
  const set = (name, value) => {
    const type = spec.flags[name];
    if (!type) throw new Usage(`unknown flag --${name} for ${command}`, `valid flags: ${Object.keys(spec.flags).map((f) => `--${f}`).join(" ") || "none"}; see workstreams ${command} --help`);
    if (type === "bool") flags[name] = value === undefined ? true : Boolean(value);
    else if (type === "list") flags[name] = [...(flags[name] ?? []), ...[value].flat()];
    else flags[name] = value;
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) { args.push(token); continue; }
    const [, name, inline] = token.match(/^--([^=]+)(?:=(.*))?$/s);
    if (spec.flags[name] === "bool" || !spec.flags[name]) { set(name, inline === undefined ? undefined : inline !== "false"); continue; }
    const value = inline ?? tokens[++index];
    if (value === undefined) throw new Usage(`--${name} needs a value`, `workstreams ${command} --help`);
    set(name, value);
  }
  if (flags.stdin && command !== "append") {
    const input = safeJson(await readStdin());
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Usage("--stdin expects a JSON object keyed by flag name", `workstreams ${command} --help`);
    for (const [name, value] of Object.entries(input)) if (!(name in flags)) set(name, value);
  }
  if (flags.stdin && command === "append" && !args.length) args.push("-");
  const names = spec.args ?? [];
  if (args[0]?.startsWith("{") && command !== "append") throw new Usage(`${command} takes arguments and flags, not JSON`, usageLine(command));
  if (args.length > names.length) throw new Usage(`unexpected argument ${JSON.stringify(args[names.length])} for ${command}`, usageLine(command));
  if (args.length < names.length) throw new Usage(`${command} needs <${names[args.length]}>`, usageLine(command));
  const missing = (spec.required ?? []).filter((name) => flags[name] === undefined);
  if (missing.length) throw new Usage(`${command} needs ${missing.map((name) => `--${name}`).join(", ")}`, usageLine(command));
  return { args, flags };
}

const usageLine = (command) => COMMANDS[command].help.split("\n")[0];

// ---- read views --------------------------------------------------------------------------

async function home(store) {
  const sessionId = currentSession();
  const all = await store.list({ includeClosed: true });
  const open = all.filter((summary) => !summary.closed);
  const closed = all.length - open.length;
  const mine = sessionId ? await store.list({ sessionId, includeClosed: true }) : [];
  if (json) return printJson({ path: SELF, store: STORE_DIR, session: sessionId ?? null, sessionWorkstream: mine[0] ?? null, open });
  const lines = [`workstreams — ${tilde(SELF)}`, `Workstream attention ledger in ${tilde(STORE_DIR)}; commands: workstreams --help`];
  if (!sessionId) lines.push("this session: PI_SESSION_ID unset");
  else if (!mine.length) lines.push("this session: not in a Workstream");
  else lines.push(`this session: ${mine[0].id} | waiting ${mine[0].waitingOn ?? "-"} | next: ${cut(mine[0].next ?? "-", 100)}`);
  lines.push(`count: ${open.length} open (${closed} closed); ${Math.min(3, open.length)} most recent:`);
  lines.push(...open.slice(0, 3).map((summary) => row(summary, LIST_COLUMNS)));
  lines.push(
    mine[0] ? `help: workstreams show ${mine[0].id}` : "help: workstreams list",
    mine[0] ? `help: workstreams checkpoint ${mine[0].id} --help` : "help: workstreams associate <id>",
  );
  print(lines);
}

async function list(store, _args, flags) {
  const all = await store.list({ includeClosed: true });
  const summaries = flags.closed ? all : all.filter((summary) => !summary.closed);
  if (json) return printJson(summaries);
  const columns = flags.fields ? flags.fields.split(",").map((field) => field.trim()) : LIST_COLUMNS;
  const unknown = columns.filter((field) => !SUMMARY_FIELDS.includes(field));
  if (unknown.length) throw new Usage(`unknown field ${unknown.join(", ")}`, `valid --fields: ${SUMMARY_FIELDS.join(",")}`);
  const limit = flags.all ? Infinity : Number(flags.limit ?? LIST_LIMIT);
  if (!(limit > 0)) throw new Usage(`--limit must be a positive number`, "workstreams list --limit 30");
  const closed = all.filter((summary) => summary.closed).length;
  const shown = summaries.slice(0, limit);
  const lines = [`count: ${all.length - closed} open (${closed} closed)${shown.length < summaries.length ? `; showing ${shown.length} most recent` : ""}`, columns.join(" | ")];
  lines.push(...shown.map((summary) => row(summary, columns)));
  if (shown.length < summaries.length) lines.push("help: workstreams list --all");
  lines.push("help: workstreams show <id>");
  print(lines);
}

function row(summary, columns) {
  return columns.map((field) => {
    const value = summary[field];
    if (value === null || value === undefined) return "-";
    if (field.endsWith("At")) return value.slice(0, 10);
    return field === "id" ? value : cut(String(value), field === "next" ? 160 : field === "title" ? 32 : 16);
  }).join(" | ");
}

async function show(store, [id], flags) {
  const snapshot = await store.inspect(id);
  if (json) return printJson(snapshot);
  const full = flags.full === true;
  const text = (value, max) => full ? oneLine(value) : cut(value, max);
  const sessions = [...snapshot.sessions].sort((a, b) => (b.latestCheckpoint?.recordedAt ?? "").localeCompare(a.latestCheckpoint?.recordedAt ?? ""));
  const newest = sessions.find((session) => session.latestCheckpoint)?.latestCheckpoint;
  const lines = [
    `${snapshot.id} | ${snapshot.title} | ${snapshot.group ?? "-"} | rev ${snapshot.revision} | ${snapshot.closed ? `closed ${snapshot.closedAt.slice(0, 10)}` : "open"} | updated ${snapshot.updatedAt.slice(0, 10)}`,
    `waiting: ${newest?.waitingOn ?? "-"} | next: ${newest ? text(newest.next, 200) : "- (no checkpoint yet)"}`,
  ];
  const overview = snapshot.overview;
  if (!overview) lines.push("overview: none");
  else {
    lines.push(`goal: ${text(overview.goal, 160)}`, `done when: ${text(overview.doneWhen, 120)}`);
    if (full) lines.push(`description: ${oneLine(overview.description)}`, ...overview.history.map((event) => `history: ${oneLine(event)}`));
    lines.push(`overview: rev ${overview.revision}, ${overview.recordedAt.slice(0, 10)}`);
  }
  const links = full ? snapshot.links : snapshot.links.slice(-3);
  lines.push(`links: ${snapshot.links.length}${links.length < snapshot.links.length ? ` (last ${links.length})` : ""}`, ...links.map((link) => `  ${link.id} | ${link.kind} | ${text(link.reference, 80)}${link.label ? ` | ${text(link.label, 40)}` : ""}`));
  const listed = full ? sessions : sessions.slice(0, 3);
  lines.push(`sessions: ${sessions.length}${listed.length < sessions.length ? ` (${listed.length} newest; --full for all)` : ""}`);
  for (const session of listed) {
    const checkpoint = session.latestCheckpoint;
    lines.push(`  ${cut([session.id, checkpoint?.sessionTitle ?? "-", session.status, checkpoint?.waitingOn ?? "-", oneLine(checkpoint?.next ?? "-")].join(" | "), full ? Infinity : 150)}`);
    if (full && checkpoint) {
      lines.push(`    checkpoint ${checkpoint.id} ${checkpoint.recordedAt}`, `    what: ${oneLine(checkpoint.whatChanged)}`, `    remains: ${oneLine(checkpoint.remains)}`);
      if (checkpoint.references?.length) lines.push(`    refs: ${checkpoint.references.join(", ")}`);
    }
  }
  const pending = snapshot.humanTasks.filter((task) => task.status !== "resolved");
  lines.push(`tasks pending: ${pending.length}`, ...pending.map((task) => `  ${task.id} | ${task.status} | ${text(task.title, 120)}`));
  if (!full) lines.push(`help: workstreams show ${snapshot.id} --full`);
  print(lines);
}

// ---- writes ------------------------------------------------------------------------------

async function create(store, [id], flags) {
  checkLength("title", flags.title, MAX.title);
  if (flags.group !== undefined) checkLength("group", flags.group, MAX.title);
  checkId("id", id);
  const existing = await store.inspect(id).catch((error) => error.code === "WORKSTREAM_NOT_FOUND" ? null : Promise.reject(error));
  if (existing && existing.title !== flags.title) throw new Usage(`${id} already exists as ${JSON.stringify(existing.title)}`, `pick another id, or workstreams show ${id}`);
  if (existing && (flags.group === undefined || existing.group === flags.group)) return noop(`${id} already exists`);
  const producer = flags.owner ? "owner" : "session";
  let receipt = existing ? null : await store.create({ workstreamId: id, idempotencyKey: `cli-create-${hash([id, flags.title, producer])}`, title: flags.title, producer });
  if (flags.group !== undefined) {
    const snapshot = await store.inspect(id);
    if (snapshot.group !== flags.group) receipt = await write(store, snapshot, "group", [record("group.set", { group: flags.group }, flags)]);
  }
  done(receipt, `${existing ? "regrouped" : "created"} ${id}`, [`workstreams overview ${id} --expect ${receipt.acceptedRevision} --help`, `workstreams associate ${id}`]);
}

async function associate(store, [id]) {
  const sessionId = requireSession("associate");
  const snapshot = await store.inspect(id);
  if (snapshot.sessions.some((session) => session.id === sessionId && session.status === "active")) return noop(`session ${sessionId} is already active in ${id}`);
  const [other] = (await store.list({ sessionId, includeClosed: true })).filter((summary) => summary.id !== id);
  if (other) throw new Usage(`session ${sessionId} already belongs to ${other.id} (${other.title}); a session has one Workstream`, `workstreams show ${other.id}`);
  const payload = { sessionId, associationKey: sessionId };
  const receipt = await write(store, snapshot, "associate", [
    { type: "session.pending", producer: "session", sourceSessionId: sessionId, payload },
    { type: "session.confirmed", producer: "session", sourceSessionId: sessionId, payload },
  ]);
  done(receipt, `session ${sessionId} associated with ${id}`, [`workstreams checkpoint ${id} --help`]);
}

async function checkpoint(store, [id], flags) {
  const sessionId = requireSession("checkpoint");
  for (const name of ["what", "remains", "next"]) checkLength(name, flags[name], MAX.text);
  if (!WAITING.includes(flags.waiting)) throw new Usage(`--waiting is ${JSON.stringify(flags.waiting)}; use owner, agent, or external`, `--waiting owner (Thomas acts) | agent (an agent continues) | external (third party, CI)`);
  if (flags.title !== undefined) checkLength("title", flags.title, MAX["session-title"], "--title is the session's Chat title");
  const references = flags.ref ?? [];
  if (references.length > 20) throw new Usage(`--ref given ${references.length} times; at most 20`, "keep only the paths needed to resume");
  references.forEach((reference) => checkReference("ref", reference));
  const snapshot = await store.inspect(id);
  const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
  if (session?.status !== "active") throw new Usage(`session ${sessionId} is not active in ${id}`, `workstreams associate ${id}`);
  const content = {
    whatChanged: flags.what,
    remains: flags.remains,
    next: flags.next,
    waitingOn: flags.waiting,
    ...(flags.title === undefined ? {} : { sessionTitle: flags.title }),
    ...(references.length ? { references } : {}),
  };
  const latest = session.latestCheckpoint;
  if (latest && Object.keys(content).every((key) => JSON.stringify(latest[key]) === JSON.stringify(content[key]))
    && (latest.sessionTitle ?? undefined) === content.sessionTitle && (latest.references?.length ?? 0) === references.length) {
    return noop(`checkpoint ${latest.id} already says this`);
  }
  const checkpointId = `cp-${hash([id, sessionId, snapshot.revision, content])}`;
  const receipt = await write(store, snapshot, "checkpoint", [record("checkpoint.replaced", { sessionId, checkpoint: { id: checkpointId, ...content } }, flags)]);
  done(receipt, `checkpoint ${checkpointId} written to ${id}`, [`tell the owner what it says; correct it with another checkpoint`]);
}

async function overview(store, [id], flags) {
  checkLength("goal", flags.goal, MAX.goal);
  checkLength("done-when", flags["done-when"], MAX["done-when"]);
  checkLength("description", flags.description, MAX.description);
  if (flags.history.length > 6) throw new Usage(`--history given ${flags.history.length} times; give 1 to 6 events`, "keep the consequential events only");
  flags.history.forEach((event) => checkLength("history", event, MAX.history));
  const snapshot = await expectRevision(store, id, flags, "overview");
  const content = { goal: flags.goal, doneWhen: flags["done-when"], description: flags.description, history: flags.history };
  const current = snapshot.overview;
  if (current && Object.keys(content).every((key) => JSON.stringify(current[key]) === JSON.stringify(content[key]))) return noop(`overview already says this`);
  const receipt = await write(store, snapshot, "overview", [record("overview.replaced", { overview: content }, flags)]);
  done(receipt, `overview of ${id} replaced`);
}

async function link(store, [id], flags) {
  checkLength("kind", flags.kind, MAX.id);
  checkReference("ref", flags.ref);
  if (flags.label !== undefined) checkLength("label", flags.label, MAX.label);
  const linkId = flags["link-id"] ?? `${slug(flags.kind)}-${hash([flags.kind, flags.ref]).slice(0, 8)}`;
  checkId("link-id", linkId);
  const snapshot = await store.inspect(id);
  const value = { id: linkId, kind: flags.kind, reference: flags.ref, ...(flags.label === undefined ? {} : { label: flags.label }) };
  const existing = snapshot.links.find((candidate) => candidate.id === linkId);
  if (existing && JSON.stringify(existing) === JSON.stringify(value)) return noop(`link ${linkId} already exists`);
  const receipt = await write(store, snapshot, "link", [record("link.upsert", { link: value }, flags)]);
  done(receipt, `link ${linkId} ${existing ? "updated" : "added"} on ${id}`, [`workstreams unlink ${id} ${linkId}`]);
}

async function unlink(store, [id, linkId], flags) {
  checkId("linkId", linkId);
  const snapshot = await store.inspect(id);
  if (!snapshot.links.some((candidate) => candidate.id === linkId)) return noop(`no link ${linkId} on ${id} (links: ${snapshot.links.map((candidate) => candidate.id).join(", ") || "none"})`);
  done(await write(store, snapshot, "unlink", [record("link.removed", { linkId }, flags)]), `link ${linkId} removed from ${id}`);
}

async function title(store, [id, value], flags) {
  checkLength("title", value, MAX.title);
  const snapshot = await store.inspect(id);
  if (snapshot.title === value) return noop(`title already is ${JSON.stringify(value)}`);
  done(await write(store, snapshot, "title", [record("title.set", { title: value }, flags)]), `${id} renamed`);
}

async function group(store, [id, value], flags) {
  checkLength("group", value, MAX.title);
  const snapshot = await store.inspect(id);
  if (snapshot.group === value) return noop(`group already is ${JSON.stringify(value)}`);
  done(await write(store, snapshot, "group", [record("group.set", { group: value }, flags)]), `${id} grouped under ${value}`);
}

async function resolveTask(store, [id, taskId], flags) {
  checkId("taskId", taskId);
  const snapshot = await store.inspect(id);
  const task = snapshot.humanTasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    const pending = snapshot.humanTasks.filter((candidate) => candidate.status !== "resolved").map((candidate) => candidate.id);
    throw new Usage(`no Human Task ${taskId} on ${id}`, pending.length ? `pending tasks: ${pending.join(", ")}` : "nothing to resolve; workstreams show " + id);
  }
  if (task.status === "resolved") return noop(`task ${taskId} is already resolved`);
  done(await write(store, snapshot, "resolve-task", [record("human-task.resolved", { taskId }, flags)]), `task ${taskId} resolved`);
}

async function close(store, [id], flags) {
  const snapshot = await expectRevision(store, id, flags, "close");
  if (snapshot.closed) return noop(`${id} is already closed`);
  const sourceSessionId = currentSession();
  const request = { workstreamId: id, expectedRevision: snapshot.revision, producer: "owner", ...(sourceSessionId ? { sourceSessionId } : {}) };
  const receipt = await store.close({ ...request, idempotencyKey: `cli-close-${hash(request)}` });
  const pending = snapshot.humanTasks.filter((task) => task.status !== "resolved").length;
  done(receipt, `${id} closed${pending ? `; ${pending} pending Human Task(s) preserved` : ""}`);
}

async function append(store, [argument]) {
  const text = argument === "-" || argument === "@-" ? await readStdin()
    : argument.startsWith("@") ? await readFile(argument.slice(1), "utf8") : argument;
  const request = safeJson(text);
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Usage(`append input is not a JSON object${text.trim() ? "" : " (it is empty)"}`, "prefer a verb (workstreams --help); raw form: workstreams append - <<'JSON' … JSON (see workstreams append --help)");
  }
  if (typeof request.workstreamId !== "string") throw new Usage("append request needs workstreamId", "workstreams append --help");
  if (!Array.isArray(request.records)) throw new Usage("append request needs records: [...]", "workstreams append --help");
  const sourceSessionId = currentSession();
  request.records = request.records.map((value) => value && typeof value === "object" ? {
    producer: "session",
    ...(sourceSessionId ? { sourceSessionId } : {}),
    ...value,
  } : value);
  request.expectedRevision ??= (await store.inspect(request.workstreamId)).revision;
  request.idempotencyKey ??= `cli-append-${hash([request.workstreamId, request.expectedRevision, request.records])}`;
  try {
    done(await store.append(request), `appended ${request.records.length} record(s) to ${request.workstreamId}`);
  } catch (error) {
    const index = /records\[(\d+)\]/.exec(error.message ?? "")?.[1];
    if (index !== undefined) error.help = recordHelp(request.records[Number(index)]?.type);
    throw error;
  }
}

async function watch(store, _args, flags) {
  printJson(await store.watch({
    ...(flags.after === undefined ? {} : { afterSequence: Number(flags.after) }),
    ...(flags.id === undefined ? {} : { workstreamId: flags.id }),
  }));
}

const handlers = { list, show, create, associate, checkpoint, overview, link, unlink, title, group, "resolve-task": resolveTask, close, append, watch };

// ---- helpers -----------------------------------------------------------------------------

async function write(store, snapshot, verb, records) {
  const request = { workstreamId: snapshot.id, expectedRevision: snapshot.revision, records };
  return store.append({ ...request, idempotencyKey: `cli-${verb}-${hash(request)}` });
}

// ponytail: the store has no revision-indexed ledger read, so a moved revision is explained from the
// current snapshot (what moved and when), not record by record; add a ledger query if that is too thin.
async function expectRevision(store, id, flags, command) {
  const snapshot = await store.inspect(id);
  if (flags.expect === undefined) {
    throw new Usage(`${command} needs --expect <revision> (${id} is at rev ${snapshot.revision})`, `review with workstreams show ${id}, then rerun with --expect ${snapshot.revision}`);
  }
  const expected = Number(flags.expect);
  if (!Number.isSafeInteger(expected) || expected < 1) throw new Usage(`--expect must be a revision number`, `--expect ${snapshot.revision}`);
  if (expected === snapshot.revision) return snapshot;
  const newest = snapshot.sessions.map((session) => session.latestCheckpoint).filter(Boolean).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  const changes = [
    `${id} is at rev ${snapshot.revision}, not rev ${expected} (last change ${snapshot.updatedAt})`,
    snapshot.overview ? `overview: rev ${snapshot.overview.revision} by ${snapshot.overview.producer}: ${cut(snapshot.overview.goal, 160)}` : "overview: none",
    newest ? `newest checkpoint ${newest.recordedAt}: ${cut(newest.next, 160)}` : "no checkpoint",
  ];
  const error = new WorkstreamStoreError("STALE_REVISION", changes.join("\n"));
  error.help = `reconcile with workstreams show ${id}, then rerun with --expect ${snapshot.revision}`;
  throw error;
}

function record(type, payload, flags) {
  const sourceSessionId = currentSession();
  return { type, producer: flags.owner ? "owner" : "session", ...(sourceSessionId ? { sourceSessionId } : {}), payload };
}

function recordHelp(type) {
  const verb = {
    "checkpoint.replaced": "checkpoint", "overview.replaced": "overview", "link.upsert": "link", "link.removed": "unlink",
    "title.set": "title", "group.set": "group", "human-task.resolved": "resolve-task", "session.pending": "associate", "session.confirmed": "associate",
  }[type];
  return verb ? `use the verb instead: workstreams ${verb} --help` : "record shapes: packages/workstream-store/src/index.d.ts (WorkstreamRecord)";
}

function checkLength(name, value, max, note) {
  if (typeof value !== "string" || !value.trim()) throw new Usage(`--${name} is empty`, `${note ?? `--${name}`} needs text (max ${max} chars)`);
  if (value.length > max) throw new Usage(`--${name} is ${value.length}/${max} chars`, `shorten --${name} to ${max} characters or fewer`);
}

function checkId(name, value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value) || value.length > MAX.id) throw new Usage(`${name} ${JSON.stringify(value)} is not a valid id`, `use letters, digits, and . _ : @ / - (max ${MAX.id})`);
}

function checkReference(name, value) {
  checkLength(name, value, MAX.text);
  if (/^(?:\/private)?\/(?:tmp|var\/tmp|var\/folders)(?:\/|$)/.test(value)) {
    throw new Usage(`--${name} ${value} points into a temporary directory`, "reference a durable path in a repository, repo@full-sha, or a retained artifact");
  }
}

function requireSession(command) {
  const sessionId = currentSession();
  if (!sessionId) throw new Usage(`${command} needs PI_SESSION_ID`, "run it from a Pi session, or set PI_SESSION_ID=<session id>");
  return sessionId;
}

const currentSession = () => process.env.PI_SESSION_ID?.trim() || undefined;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "link";
const oneLine = (value) => String(value).replace(/\s+/g, " ").trim();
const cut = (value, max) => { const line = oneLine(value); return line.length > max ? `${line.slice(0, max - 1)}…` : line; };

function safeJson(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

async function readStdin() {
  let text = "";
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) text += chunk;
  return text;
}

function noop(message) {
  if (json) return printJson({ noop: true, message });
  print([`(no-op) ${message}`]);
}

function done(receipt, message, help = []) {
  if (json) return printJson(receipt);
  print([`ok: ${message} (rev ${receipt.acceptedRevision})`, ...help.map((line) => `help: ${line}`)]);
}

const print = (lines) => stdout.write(`${lines.join("\n")}\n`);
const printJson = (value) => stdout.write(`${JSON.stringify(value, null, 2)}\n`);

main().catch((error) => {
  const usage = error instanceof Usage;
  const code = usage ? "USAGE" : error instanceof WorkstreamStoreError ? error.code : "CLI_ERROR";
  const help = error.help ?? storeHelp(code);
  if (json) printJson({ error: { code, message: error.message, ...(help ? { help } : {}), ...(error.details === undefined ? {} : { details: error.details }) } });
  else print([`error: ${usage ? "" : `${code}: `}${error.message}`, ...(help ? [`help: ${help}`] : [])]);
  process.exitCode = usage ? 2 : 1;
});

function storeHelp(code) {
  return {
    WORKSTREAM_NOT_FOUND: "workstreams list --all (add --closed for history)",
    WORKSTREAM_EXISTS: "pick another id, or workstreams show <id>",
    WORKSTREAM_CLOSED: "closed Workstreams are read-only; create a new one",
    STALE_REVISION: "another write landed first; rerun the same command",
    IDEMPOTENCY_CONFLICT: "omit idempotencyKey and the CLI derives a fresh one",
    SESSION_ASSIGNED_ELSEWHERE: "workstreams (the home view names this session's Workstream)",
  }[code];
}
