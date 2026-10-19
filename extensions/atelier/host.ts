import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, constants, createReadStream, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSES, UNDO_MS, compose, inGroup, keyTexts } from "./kernel/atelier.js";

// Atelier host (decisions 129-156): the page server and Delivery of human events from a Page's Event Log.
// No Pi dependency, so the `atelier` tool (index.ts) and the builder CLI (serve.mjs) run the same code.
// The Page side lives in kernel/atelier.js.

const KERNEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "kernel");
export const KERNEL_FILES = ["atelier.js", "idiomorph.js"];
const KERNEL_VERSION = "2.3.1";
// Plannotator pi-session-bridge.ts: Pi's sendMessage returns void, so a send is only "queued" until the
// message starts; a watchdog flags one that never starts. Busy sessions arm it at agent_settled, because
// agent_end is not final.
export const WATCHDOG_MS = 15_000;
// A Decision's answer may name up to four images, each uploaded on its own (POST /.atelier/image) before the answer
// posts, so an event body stays small.
export const IMAGE_MAX = 10 * 1024 * 1024;
const IMAGES_MAX = 4;
const UPLOADS_MAX = 4; // ponytail: images receiving at once per host (4 x 10 MB in memory); raise it if tabs upload in parallel
const BODY_MAX = 64 * 1024;

type Entry = { seq: number; at: number; origin: string; type: string; [field: string]: any };
export type Message = { customType: string; content: string; display: true; details: { page: string; seqs: number[]; replay: boolean } };

export const logPath = (page: string) => `${page}.events.jsonl`;
/** Images the human attaches to a Decision's answer live beside the Event Log; the log names them relative to the Page's directory. */
export const imagesDir = (page: string) => `${page}.images`;

/** The Event Log (143): append-only JSON lines beside the Page. A torn last line is skipped, never fatal. */
export function readLog(page: string): Entry[] {
  let text: string;
  try { text = readFileSync(logPath(page), "utf8"); } catch { return []; }
  const entries: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* torn write */ }
  }
  return entries;
}

// A symlinked Event Log or Kernel copy would write outside the Page's directory.
const isLink = (file: string) => { try { return lstatSync(file).isSymbolicLink(); } catch { return false; } };

// Only the Page's owning session appends (claimPage), so reading the log for the next seq is safe.
export function appendLog(page: string, entry: Record<string, unknown>, now = Date.now()): Entry {
  const file = logPath(page);
  if (isLink(file)) throw new Error(`${file} is a symlink; Atelier writes its Event Log only beside the Page.`);
  const entries = readLog(page);
  const seq = entries.reduce((max, e) => Math.max(max, Number(e.seq) || 0), 0) + 1;
  const full = { seq, at: now, ...entry } as Entry;
  const torn = existsSync(file) && !readFileSync(file, "utf8").endsWith("\n") && statSync(file).size > 0;
  appendFileSync(file, `${torn ? "\n" : ""}${JSON.stringify(full)}\n`);
  return full;
}

const lockPath = (page: string) => `${logPath(page)}.lock`;
const alive = (pid: unknown) => { try { process.kill(Number(pid), 0); return true; } catch (error: any) { return error.code === "EPERM"; } };

/**
 * One live session owns a Page: it alone appends to the Event Log and delivers its events (131, 143). The
 * first session to open the Page takes `<page>.events.jsonl.lock`; a lock whose recorded process is gone is stale.
 * The lock is linked from a fully written temp file, so no contender ever sees it empty.
 */
export function claimPage(page: string, session: string) {
  const lock = lockPath(page);
  const tmp = `${lock}.${process.pid}.${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify({ pid: process.pid, session }));
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { linkSync(tmp, lock); return; } catch (error: any) { if (error.code !== "EEXIST") throw error; }
      let owner: { pid?: number; session?: string };
      try { owner = JSON.parse(readFileSync(lock, "utf8")); } catch { throw new Error(`Cannot read ${lock}; delete it if no Pi session has this Page open.`); }
      if (owner.pid === process.pid && owner.session === session) return;
      if (!Number.isInteger(owner.pid) || alive(owner.pid)) throw new Error(`This Page is open in another live Pi session (${owner.session}, pid ${owner.pid}); its human events go there. End that session first, or delete ${lock} if it is gone.`);
      // ponytail: two sessions breaking one stale lock can race; fine for a lock that only a crash leaves behind.
      unlinkSync(lock);
    }
    throw new Error(`Could not take ${lock}.`);
  } finally { unlinkSync(tmp); }
}

function releasePage(page: string, session: string) {
  try {
    const owner = JSON.parse(readFileSync(lockPath(page), "utf8"));
    if (owner.pid === process.pid && owner.session === session) unlinkSync(lockPath(page));
  } catch { /* not ours or gone */ }
}

/**
 * Which human events are due for Delivery (150, 151): Immediate events and Sends whose 10-second undo
 * window has closed, never undone and not yet received. A Send carries the drafts its group covers
 * (Review Studio's one "flush" boundary per "Offene senden"). Record events are never delivered.
 */
export function dueMessages(entries: Entry[], now: number, undoMs = UNDO_MS, skip = new Set<number>()) {
  const undone = new Set(entries.filter((e) => e.type === "undo").map((e) => e.target));
  const received = new Set(entries.filter((e) => e.type === "received").flatMap((e) => e.of));
  const open = (e: Entry) => e.origin === "human" && !undone.has(e.seq) && !received.has(e.seq) && !skip.has(e.seq);
  const settled = (e: Entry) => now - e.at >= undoMs;
  const out: { customType: string; events: Entry[]; seqs: number[]; group?: string }[] = [];
  const immediate = entries.filter((e) => open(e) && settled(e) && e.delivery === "immediate");
  if (immediate.length) out.push({ customType: "atelier:immediate", events: immediate, seqs: immediate.map((e) => e.seq) });
  const taken = new Set<number>();
  for (const send of entries.filter((e) => open(e) && settled(e) && e.type === "send")) {
    const drafts = entries.filter((e) => open(e) && e.delivery === "send" && e.seq < send.seq && !taken.has(e.seq) && inGroup(e.key, send.key));
    drafts.forEach((d) => taken.add(d.seq));
    out.push({ customType: "atelier:send", events: drafts, seqs: [...drafts.map((d) => d.seq), send.seq], group: send.key });
  }
  return out;
}

const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const STAMP = /^\/\/ atelier-copy (\S+) sha256:([0-9a-f]{64})[^\n]*\n/;

/**
 * Copies the Kernel beside the Page with a version stamp (133). An existing copy is never overwritten:
 * a locally changed copy is a Contribution candidate (136), and a Registry fix reaches an unchanged copy
 * only through a diff the owner accepts (136), so an older copy is only reported as behind. A copy whose
 * content equals the Kernel is current, stamped or not (a builder may have copied it by hand).
 */
export function copyKernel(dir: string) {
  return KERNEL_FILES.map((file) => {
    const source = readFileSync(path.join(KERNEL_DIR, file), "utf8");
    const target = path.join(dir, file);
    if (isLink(target)) return { file, outcome: "symlink" as const };
    if (!existsSync(target)) {
      writeFileSync(target, `// atelier-copy ${KERNEL_VERSION} sha256:${sha(source)} from pi-workbench extensions/atelier/kernel/${file}; change it here and send the change back as a Contribution (decisions 133, 136).\n${source}`);
      return { file, outcome: "copied" as const };
    }
    const text = readFileSync(target, "utf8");
    const stamp = STAMP.exec(text);
    const body = stamp ? text.slice(stamp[0].length) : text;
    if (body === source) return { file, outcome: "current" as const };
    if (!stamp || sha(body) !== stamp[2]) return { file, outcome: "changed" as const };
    return { file, outcome: "behind" as const }; // an unchanged copy of another Kernel version
  });
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".jsonl": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

/** Resolves a path inside `root` after following symlinks; anything outside is refused. */
export function inside(root: string, candidate: string): string | undefined {
  try {
    const real = realpathSync(path.resolve(root, candidate));
    return real === root || real.startsWith(root + path.sep) ? real : undefined;
  } catch { return undefined; }
}

// Fields each human event may carry, checked before the Event Log (131, 147); other fields are dropped.
const str = (v: unknown) => typeof v === "string";
const opt = (ok: (v: any) => boolean) => (v: unknown) => v == null || ok(v);
const seqNo = (v: unknown) => Number.isInteger(v);
const ANCHOR = { key: opt(str), ver: opt(str), t: opt(Number.isFinite), quote: opt((q) => str(q.exact) && str(q.prefix) && str(q.suffix)), selector: opt((s) => str(s.sel) && str(s.snap)) };
const FIELDS: Record<string, Record<string, (v: any) => boolean>> = {
  comment: { ...ANCHOR, text: str, thread: opt(seqNo) },
  // previous: the answer this one changes (155); options and rec: a Page-declared Decision's atl-decide and atl-rec.
  decide: { decision: str, option: str, previous: opt(str), options: opt(str), rec: opt(str), opened: opt((v) => typeof v === "boolean"), note: opt(str), key: opt(str), ver: opt(str),
    images: opt((v) => Array.isArray(v) && v.length <= IMAGES_MAX && v.every(str)) },
  request: { job: str, input: opt((o) => typeof o === "object" && Object.values(o).every(str)), key: opt(str), ver: opt(str) },
  rework: { target: seqNo, note: opt(str) }, cancel: { target: seqNo }, accept: { target: seqNo }, undo: { target: seqNo },
  close: { target: seqNo, ver: opt(str) }, still: { target: seqNo, ver: opt(str) }, opened: { decision: str }, send: { key: opt(str) },
};

// The bytes decide an image's type; the client's declared type and file name are never trusted.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sniff = (b: Buffer) => b.subarray(0, 8).equals(PNG) ? "png"
  : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "jpg"
  : /^GIF8[79]a$/.test(b.toString("latin1", 0, 6)) ? "gif"
  : b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" ? "webp" : undefined;

const IMAGE_NAME = /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/;

/**
 * Stores one uploaded image in <page>.images/ under its content hash and returns its name relative to the Page's
 * directory. It is written to a temp file and renamed over the name, so whatever already sits there is replaced, never trusted.
 */
export function storeImage(page: string, bytes: Buffer): { status: number; json: { name?: string; error?: string } } {
  const ext = sniff(bytes);
  if (!ext) return { status: 415, json: { error: "Images must be PNG, JPEG, WebP or GIF." } };
  const dir = imagesDir(page), base = `${sha(bytes).slice(0, 16)}.${ext}`, tmp = path.join(dir, `.upload-${randomUUID()}`);
  try {
    mkdirSync(dir, { recursive: true });
    if (!lstatSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`); // a symlink would store outside the Page's directory
    writeFileSync(tmp, bytes, { flag: "wx" });
    renameSync(tmp, path.join(dir, base));
  } catch (error) {
    rmSync(tmp, { force: true });
    return { status: 409, json: { error: `Could not store the image: ${String(error)}` } };
  }
  return { status: 200, json: { name: `${path.basename(dir)}/${base}` } };
}

/** A name a decide event may carry: a regular file (no symlink) directly in a real <page>.images/, hash-named, within size, its bytes the type its name says. */
function storedImage(page: string, name: string) {
  const dir = imagesDir(page), prefix = `${path.basename(dir)}/`, base = name.slice(prefix.length), ext = IMAGE_NAME.exec(base)?.[1];
  if (!name.startsWith(prefix) || !ext) return false;
  let fd: number | undefined;
  try {
    if (!lstatSync(dir).isDirectory() || !lstatSync(path.join(dir, base)).isFile()) return false; // a FIFO would block open
    fd = openSync(path.join(dir, base), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const s = fstatSync(fd), head = Buffer.alloc(12);
    if (!s.isFile() || s.size > IMAGE_MAX) return false;
    readSync(fd, head, 0, head.length, 0);
    return sniff(head) === ext;
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}

export type Host = ReturnType<typeof createHost>;

/**
 * One page server per session runtime (154: 127.0.0.1 only), serving project files read-only (152) and
 * taking human events for the Pages this session opened. Every event is appended to the Event Log first
 * (131, 147); Delivery goes through `send` after the undo window.
 */
export function createHost(options: {
  root: string;
  send: (message: Message, done: (idle: boolean) => void, failed: () => void) => void;
  sessionId?: string;
  now?: () => number;
  undoMs?: number;
  watchdogMs?: number;
  /** serve.mjs: the Kernel marks the Page as served by a test host, not a Pi session. */
  test?: boolean;
}) {
  const root = realpathSync(options.root);
  const sessionId = options.sessionId ?? randomUUID();
  const now = options.now ?? Date.now;
  const undoMs = options.undoMs ?? UNDO_MS;
  const watchdogMs = options.watchdogMs ?? WATCHDOG_MS;
  const pages = new Map<string, Set<ServerResponse>>();
  const inFlight = new Map<string, Set<number>>();
  const awaitingSettle: { page: string; seqs: number[] }[] = [];
  const seen = new Map<string, Set<number>>(); // started in the session, receipt written at agent_settled
  const mounts = new Map<string, string>(); // "~<hash>" -> directory of a Page outside the project
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let server: Server | undefined;
  let ready: Promise<void> | undefined;
  let port = 0;

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => { timers.delete(t); try { fn(); } catch { /* a late timer must never crash the session */ } }, ms);
    t.unref?.();
    timers.add(t);
  };
  // A Page inside the project is served with the project's files (152); one outside it only with its own directory.
  const inProject = (abs: string) => abs.startsWith(root + path.sep);
  const mount = (abs: string) => `~${sha(path.dirname(abs)).slice(0, 12)}`;
  const rel = (abs: string) => inProject(abs) ? path.relative(root, abs).split(path.sep).join("/") : abs;
  const url = (abs: string) => `http://127.0.0.1:${port}/${inProject(abs) ? rel(abs).split("/").map(encodeURIComponent).join("/") : `${mount(abs)}/${encodeURIComponent(path.basename(abs))}`}`;
  const resolve = (urlPath: string) => {
    const [head, ...rest] = urlPath.split("/");
    return mounts.has(head) ? inside(mounts.get(head)!, rest.join("/")) : inside(root, urlPath);
  };
  const broadcast = (page: string, event: string, data: unknown = {}) => {
    for (const res of pages.get(page) ?? []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const append = (page: string, entry: Record<string, unknown>) => {
    const full = appendLog(page, entry, now());
    broadcast(page, "log", { seq: full.seq });
    return full;
  };
  const flying = (page: string) => inFlight.get(page) ?? inFlight.set(page, new Set()).get(page)!;

  function deliverDue(page: string, replay = false) {
    if (!pages.has(page)) return 0;
    const entries = readLog(page);
    let texts: Map<string, string> | undefined;
    const excerpts = () => texts ??= (() => { try { return keyTexts(readFileSync(page, "utf8")); } catch { return new Map(); } })();
    let sent = 0;
    for (const due of dueMessages(entries, now(), undoMs, flying(page))) {
      // Plannotator: nothing to send means no turn.
      if (due.events.length === 0) { append(page, { origin: "kernel", type: "received", of: due.seqs, note: "nothing to send" }); continue; }
      due.seqs.forEach((s) => flying(page).add(s));
      const failed = () => due.seqs.forEach((s) => flying(page).delete(s));
      const content = compose(rel(page), url(page), due.events, entries, { replay, group: due.group, excerpt: (key: string) => excerpts().get(key), file: (name: string) => path.join(path.dirname(page), name) });
      try {
        options.send({ customType: due.customType, content, display: true, details: { page, seqs: due.seqs, replay } }, (idle) => {
          append(page, { origin: "kernel", type: "delivered", of: due.seqs, session: sessionId });
          if (idle) arm(page, due.seqs); else awaitingSettle.push({ page, seqs: due.seqs });
        }, failed);
        sent += 1;
      } catch { failed(); }
    }
    return sent;
  }

  function arm(page: string, seqs: number[]) {
    later(watchdogMs, () => {
      const received = new Set(readLog(page).filter((e) => e.type === "received").flatMap((e) => e.of));
      const missing = seqs.filter((s) => !received.has(s) && !seen.get(page)?.has(s));
      if (missing.length) append(page, { origin: "kernel", type: "unconfirmed", of: missing });
    });
  }

  function postHuman(page: string, body: any): { status: number; json: unknown } {
    const fields = Object.hasOwn(FIELDS, body?.type) ? FIELDS[body.type] : undefined;
    if (!fields) return { status: 400, json: { error: `Unknown event type ${String(body?.type)}` } };
    const cls = CLASSES[body.type as keyof typeof CLASSES];
    const event: Record<string, unknown> = { type: body.type };
    for (const [field, ok] of Object.entries(fields)) {
      if (!ok(body[field])) return { status: 400, json: { error: `Bad ${field} on ${body.type}` } };
      if (body[field] !== undefined) event[field] = body[field];
    }
    if (Array.isArray(event.images)) {
      const bad = (event.images as string[]).find((x) => !storedImage(page, x));
      if (bad !== undefined) return { status: 400, json: { error: `No stored image ${bad}; upload it first.` } };
      if (!(event.images as string[]).length) delete event.images;
    }
    const asked = body.delivery;
    if (body.type === "comment" && body.thread !== undefined && !readLog(page).some((e) => e.seq === body.thread && e.type === "comment")) return { status: 400, json: { error: `No Comment #${body.thread} to reply to.` } };
    if (body.type === "undo") {
      const log = readLog(page);
      const target = log.find((e) => e.seq === body.target && e.origin === "human" && e.type !== "undo");
      if (!target) return { status: 400, json: { error: "Nothing to undo." } };
      if (log.some((e) => e.type === "undo" && e.target === target.seq)) return { status: 409, json: { error: "Already undone." } };
      if (now() - target.at >= undoMs) return { status: 409, json: { error: "The 10-second undo window has closed." } };
    }
    // Decision 155: a Page-declared Decision is Immediate by default; atl-delivery may declare another class.
    const delivery = body.type === "decide" && ["record", "send", "immediate"].includes(asked) ? asked
      : body.type === "comment" && asked === "send" ? "send" : cls; // a Page may batch Comments (156)
    const entry = append(page, { ...event, origin: "human", delivery });
    if (delivery === "immediate" || delivery === "boundary") later(undoMs + 50, () => deliverDue(page));
    return { status: 200, json: { entry, undoMs } };
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  // One image per request, its raw bytes as the body. A refusal answers at once and closes the connection, so the
  // rest of an oversized body is never received.
  let uploads = 0;
  function upload(page: string, req: IncomingMessage, res: ServerResponse) {
    const refuse = (status: number, error: string) => { res.setHeader("connection", "close"); json(res, status, { error }); };
    if (uploads >= UPLOADS_MAX) return refuse(429, "Too many images uploading at once; try again.");
    uploads += 1;
    req.once("close", () => { uploads -= 1; });
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      if (res.headersSent) return;
      size += c.length;
      if (size <= IMAGE_MAX) chunks.push(c);
      else { chunks.length = 0; refuse(413, "An image may be at most 10 MB."); }
    });
    req.on("end", () => {
      if (res.headersSent) return;
      try { const r = storeImage(page, Buffer.concat(chunks)); json(res, r.status, r.json); } catch (error) { json(res, 500, { error: String(error) }); }
    });
  }

  function serveFile(req: IncomingMessage, res: ServerResponse, pathname: string) {
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { return json(res, 400, { error: "Bad path" }); }
    const file = resolve(decoded.slice(1));
    if (!file || !statSync(file).isFile()) return json(res, 404, { error: "Not found" });
    const size = statSync(file).size;
    const headers: Record<string, string | number> = { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store", "accept-ranges": "bytes" };
    // Byte ranges so <video> seeks (Review Studio 11f5d33c9).
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && size > 0) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      return req.method === "HEAD" ? res.end() : createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, "content-length": size });
    return req.method === "HEAD" ? res.end() : createReadStream(file).pipe(res);
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
    // Not access control (137): a Host check only keeps DNS-rebinding pages from reading project files (152).
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return json(res, 403, { error: "Use http://127.0.0.1" });
    let u: URL;
    try { u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`); } catch { return json(res, 400, { error: "Bad request target" }); }
    if (u.pathname.startsWith("/.atelier/")) {
      const page = resolve(u.searchParams.get("page") ?? "");
      if (!page || !pages.has(page)) return json(res, 404, { error: "No Pi session has this Page open. Ask the agent to open it." });
      if (u.pathname === "/.atelier/events" && req.method === "GET") {
        const since = Number(u.searchParams.get("since") ?? 0);
        return json(res, 200, { entries: readLog(page).filter((e) => e.seq > since) });
      }
      if (u.pathname === "/.atelier/events" && req.method === "POST") {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => { size += c.length; if (size <= BODY_MAX) chunks.push(c); });
        req.on("end", () => {
          if (size > BODY_MAX) return json(res, 413, { error: "Event too large" });
          let body: unknown;
          try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(res, 400, { error: "Body must be JSON" }); }
          try { const r = postHuman(page, body); json(res, r.status, r.json); } catch (error) { json(res, 500, { error: String(error) }); }
        });
        return;
      }
      if (u.pathname === "/.atelier/image" && req.method === "POST") return upload(page, req, res);
      if (u.pathname === "/.atelier/stream") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        pages.get(page)!.add(res);
        res.write(`event: hello\ndata: ${JSON.stringify({ mtime: statSync(page).mtimeMs, test: options.test || undefined })}\n\n`);
        req.on("close", () => pages.get(page)?.delete(res));
        return;
      }
      return json(res, 404, { error: "Unknown Atelier route" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Read-only" });
    if (u.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><title>Atelier</title><ul>${[...pages.keys()].map((p) => `<li><a href="${url(p)}">${rel(p).replace(/[<&]/g, "")}</a></li>`).join("")}</ul>`);
    }
    return serveFile(req, res, u.pathname);
  }

  function listen() {
    ready ??= new Promise<void>((resolve, reject) => {
      server = createServer(handle);
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { port = (server!.address() as { port: number }).port; resolve(); });
    });
    return ready;
  }

  return {
    root,
    url,
    rel,
    deliverDue,
    postHuman,
    isOpen: (page: string) => pages.has(page),
    clients: (page: string) => pages.get(page)?.size ?? 0,
    /** Starts serving the Page, copies the Kernel, and hands undelivered events to this session (131). */
    async open(page: string) {
      claimPage(page, sessionId);
      await listen();
      if (!inProject(page)) mounts.set(mount(page), path.dirname(page));
      if (!pages.has(page)) pages.set(page, new Set());
      const kernel = copyKernel(path.dirname(page));
      const replayed = deliverDue(page, true);
      if (readLog(page).some((e) => e.origin === "human" && now() - e.at < undoMs)) later(undoMs + 50, () => deliverDue(page));
      return { url: url(page), kernel, replayed };
    },
    agent(page: string, entry: Record<string, unknown>) { return append(page, { ...entry, origin: "agent" }); },
    /** Shows the rewritten Page; the one-line note names what changed in the Page's change indicators (156). */
    update(page: string, note?: string) {
      if (note) append(page, { origin: "agent", type: "update", note });
      broadcast(page, "update", { mtime: statSync(page).mtimeMs, note });
      return pages.get(page)?.size ?? 0;
    },
    receipt(details: { page?: string; seqs?: number[] } | undefined) {
      if (!details?.page || !Array.isArray(details.seqs) || !pages.has(details.page)) return;
      append(details.page, { origin: "kernel", type: "received", of: details.seqs });
    },
    /** A message reached the session (message_end); its receipt waits for agent_settled, when the session file holds it (131). */
    seen(details: { page?: string; seqs?: number[] } | undefined) {
      if (!details?.page || !Array.isArray(details.seqs) || !pages.has(details.page)) return;
      for (const s of details.seqs) (seen.get(details.page) ?? seen.set(details.page, new Set()).get(details.page)!).add(s);
    },
    settled() {
      for (const [page, seqs] of seen) if (seqs.size) this.receipt({ page, seqs: [...seqs] });
      seen.clear();
      for (const pending of awaitingSettle.splice(0)) arm(pending.page, pending.seqs);
    },
    stop() {
      for (const page of pages.keys()) releasePage(page, sessionId);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const clients of pages.values()) for (const res of clients) res.end();
      pages.clear();
      server?.close();
      server?.closeAllConnections?.();
    },
  };
}
