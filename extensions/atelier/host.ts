import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, constants, createReadStream, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSES, UNDO_MS, compose, derive, inGroup, keyTexts } from "./kernel/atelier.js";

// Atelier host (decisions 129-156): the page server and Delivery of human events from a Page's Event Log.
// No Pi dependency, so the `atelier` tool (index.ts) and the builder CLI (serve.mjs) run the same code.
// The Page side lives in kernel/atelier.js.

const KERNEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "kernel");
export const KERNEL_FILES = ["atelier.js", "idiomorph.js"];
export const KERNEL_VERSION = "2.12.0";
// Plannotator pi-session-bridge.ts: Pi's sendMessage returns void, so a send is only "queued" until the
// message starts; a watchdog flags one that never starts. Busy sessions arm it at agent_settled, because
// agent_end is not final.
export const WATCHDOG_MS = 15_000;
// How long a takeover waits for the receiving session to finish its run before it refuses.
export const QUIESCE_MS = 10_000;
// A Decision's answer, a Comment or a reply may name up to four images, each uploaded on its own (POST /.atelier/image) before the answer
// posts, so an event body stays small.
export const IMAGE_MAX = 10 * 1024 * 1024;
const IMAGES_MAX = 4;
const UPLOADS_MAX = 4; // ponytail: images receiving at once per host (4 x 10 MB in memory); raise it if tabs upload in parallel
const BODY_MAX = 64 * 1024;

type Entry = { seq: number; at: number; origin: string; type: string; [field: string]: any };
export type Message = { customType: string; content: string; display: true; details: { page: string; seqs: number[]; replay: boolean; generation?: number; uncertain?: number[] } };

export const logPath = (page: string) => `${page}.events.jsonl`;
/** Images the human attaches to a Decision's answer or a Comment live beside the Event Log; the log names them relative to the Page's directory. */
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

// Only the endpoint serving the Page for its receiver appends (claimPage), so reading the log for the next seq is safe.
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
 * The receiver lock `<page>.events.jsonl.lock`, present while a session receives the Page: its process, session and
 * receiver generation. It keeps other processes out; moving the receiver between sessions happens only inside one
 * process (PI WEB's sessiond), through REG.
 */
type Lock = { pid?: number; session?: string; generation?: number; label?: string };
function readLock(page: string): Lock {
  try { return JSON.parse(readFileSync(lockPath(page), "utf8")); } catch (error: any) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Cannot read ${lockPath(page)}; delete it if no Pi session has this Page open.`);
  }
}
const named = (lock: Lock) => lock.label ?? lock.session ?? "no session";

// Process-wide, so sessions sharing one process see each other: the Pages served here, the sessions whose Atelier
// runs, each Page's last receiver generation, and each Page's queue of takeovers. Versioned key: another Atelier
// version in the process keeps its own.
const REG: { served: Map<string, Served>; live: Set<string>; generation: Map<string, number>; queue: Map<string, Promise<unknown>> } =
  ((globalThis as any)[Symbol.for("pi-workbench.atelier.receivers.v2")] ??= { served: new Map(), live: new Set(), generation: new Map(), queue: new Map() });

/**
 * Live: a running session of this process. Elsewhere: a live session of another process. Legacy: an older Atelier's
 * lock (no generation), whose running code no lock change can fence. Stale: its process is gone, or it is this
 * process and its session's Atelier no longer runs.
 */
function holder(lock: Lock) {
  if (!lock.session) return "free";
  if (Number.isInteger(lock.pid) && !alive(lock.pid)) return "stale";
  if (lock.generation === undefined) return "legacy";
  if (lock.pid !== process.pid) return "elsewhere";
  return REG.live.has(lock.session) ? "live" : "stale";
}

/**
 * One session receives a Page's human events (131, 143). `open` (no `takeover`) claims a free or stale lock and never
 * steals; `takeover` moves it from a live session of this process, only from the generation the caller was shown.
 * Returns the receiver generation; `check` only validates. Synchronous, so nothing in this process runs between the
 * check and the write.
 */
export function claimPage(page: string, session: string, label = session, takeover?: number, check = false): number {
  const file = lockPath(page), lock = readLock(page), state = holder(lock);
  const generation = Math.max(lock.generation ?? 0, REG.generation.get(page) ?? 0);
  if (lock.session === session && lock.pid === process.pid && state !== "legacy") return lock.generation!;
  const reload = "close or /reload it first";
  if (state === "legacy") throw new Error(`This Page is held by session ${named(lock)}, which runs an older Atelier that cannot hand it over; ${reload}. If it is gone, delete ${file}.`);
  if (state === "elsewhere") throw new Error(`This Page is held by session ${named(lock)} in another process (pid ${lock.pid}); ${reload}. Atelier moves a Page's input only between sessions of one process.`);
  if (takeover !== undefined && (state !== "live" || takeover !== generation)) throw new Error(`The receiver changed since generation ${takeover}: this Page's input now goes to ${state === "live" ? named(lock) : "no session"} (generation ${generation}). ${state === "live" ? "Ask the human before taking it over again." : "Open it instead."}`);
  if (takeover === undefined && state === "live") throw new Error(`This Page's input goes to another live Pi session (${named(lock)}). To move its input here, call atelier with action takeover and generation ${generation}.`);
  if (check) return generation;
  const next = { pid: process.pid, session, generation: generation + 1, label };
  const tmp = `${file}.${process.pid}.${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(next));
  try {
    if (state === "free") linkSync(tmp, file); // exclusive: another process claiming at once gets EEXIST
    else renameSync(tmp, file); // ponytail: two processes breaking one dead process's lock can race; only a crash leaves one
  } catch (error: any) {
    if (error.code === "EEXIST") throw new Error(`Another Pi session claimed this Page just now (${file}). Try again.`);
    throw error;
  } finally { rmSync(tmp, { force: true }); }
  REG.generation.set(page, next.generation);
  return next.generation;
}

function releasePage(page: string, session: string, generation: number) {
  try { const lock = readLock(page); if (lock.pid === process.pid && lock.session === session && lock.generation === generation) unlinkSync(lockPath(page)); } catch { /* gone */ }
}

/**
 * Which human events are due for Delivery (150, 151): Immediate events and Sends whose 3-second undo
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
const images = opt((v) => Array.isArray(v) && v.length <= IMAGES_MAX && v.every(str));
const FIELDS: Record<string, Record<string, (v: any) => boolean>> = {
  comment: { ...ANCHOR, text: str, thread: opt(seqNo), images },
  // previous: the answer this one changes (155); options and rec: a Page-declared Decision's atl-decide and atl-rec;
  // custom: the human wrote his own answer ("Other…") instead of picking an option.
  decide: { decision: str, option: str, custom: opt((v) => typeof v === "boolean"), previous: opt(str), options: opt(str), rec: opt(str), opened: opt((v) => typeof v === "boolean"), note: opt(str), key: opt(str), ver: opt(str), images },
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

/** A name a decide or comment event may carry: a regular file (no symlink) directly in a real <page>.images/, hash-named, within size, its bytes the type its name says. */
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
type Send = (message: Message, done: (idle: boolean) => void, failed: () => void) => void;
type Receiver = { session: string; label: string; generation: number; send: Send; handoff?: (message: Message) => void; idle?: () => boolean };
/**
 * A served Page: its serving endpoint (the page server that gave the tab its URL, its connected tabs, its undo
 * timers) and its current receiver session. A takeover inside the process swaps only the receiver.
 */
type Served = { page: string; ep: Endpoint; clients: Set<ServerResponse>; receiver?: Receiver; inFlight: Set<number>; seen: Set<number>; awaiting: number[][] };
type Endpoint = {
  url: (page: string) => string; rel: (page: string) => string; now: () => number; undoMs: number;
  deliver: (rec: Served, replay?: boolean) => number; postHuman: (rec: Served, body: any) => { status: number; json: unknown };
  append: (page: string, entry: Record<string, unknown>) => Entry; broadcast: (page: string, event: string, data?: unknown) => void;
  arm: (rec: Served, r: Receiver, seqs: number[]) => void; later: (ms: number, fn: () => void) => void; closeIfIdle: () => void;
};
const receiverInfo = (r?: Receiver) => r ? { label: r.label, generation: r.generation } : null;

/**
 * One page server per session runtime (154: 127.0.0.1 only), serving project files read-only (152) and taking human
 * events for the Pages it serves. Every event is appended to the Event Log first (131, 147); Delivery goes through the
 * current receiver's `send` after the undo window. The server outlives its session while another session in the
 * process receives one of its Pages, so a takeover keeps the tab's URL and Undo.
 */
export function createHost(options: {
  root: string;
  send: Send;
  sessionId?: string;
  /** The receiver's name on the Kernel bar and in handover messages: the session title, else a short id. */
  label?: string;
  /** Tells this session a Page's input moved to another session. */
  handoff?: (message: Message) => void;
  /** Whether this session is between runs; a takeover from it waits for that. */
  idle?: () => boolean;
  quiesceMs?: number;
  now?: () => number;
  undoMs?: number;
  watchdogMs?: number;
  /** serve.mjs: the Kernel marks the Page as served by a test host, not a Pi session. */
  test?: boolean;
}) {
  const root = realpathSync(options.root);
  const sessionId = options.sessionId ?? randomUUID();
  const label = options.label || sessionId.slice(0, 8);
  const now = options.now ?? Date.now;
  const undoMs = options.undoMs ?? UNDO_MS;
  const watchdogMs = options.watchdogMs ?? WATCHDOG_MS;
  const opened = new Set<string>(); // Pages this session opened or took over, received here or handed on since
  let running = true; // this session's Atelier; its endpoint serves while it runs or while one of its Pages has a receiver
  REG.live.add(sessionId);
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
  const served = (page: string) => { const rec = REG.served.get(page); return rec?.ep === ep ? rec : undefined; };
  const broadcast = (page: string, event: string, data: unknown = {}) => {
    for (const res of served(page)?.clients ?? []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const append = (page: string, entry: Record<string, unknown>) => {
    const full = appendLog(page, entry, now());
    broadcast(page, "log", { seq: full.seq });
    return full;
  };

  // Delivers to the Page's current receiver. The receiver changes only in one synchronous step (bind), so
  // checking it and handing the message to its send happen with nothing in between. Every callback checks the
  // receiver it was made for, so a handed-over session's late send, receipt or watchdog changes nothing. A replay
  // flags events an earlier receiver was sent but never confirmed.
  function deliver(rec: Served, replay = false) {
    const r = rec.receiver, page = rec.page;
    if (!r) return 0;
    const entries = readLog(page);
    const sentTo = new Map<number, string>(entries.filter((e) => e.type === "delivered").flatMap((e) => e.of.map((s: number) => [s, e.label ?? e.session])));
    let texts: Map<string, string> | undefined;
    const excerpts = () => texts ??= (() => { try { return keyTexts(readFileSync(page, "utf8")); } catch { return new Map(); } })();
    let sent = 0;
    for (const due of dueMessages(entries, now(), undoMs, rec.inFlight)) {
      // Plannotator: nothing to send means no turn.
      if (due.events.length === 0) { append(page, { origin: "kernel", type: "received", of: due.seqs, note: "nothing to send" }); continue; }
      due.seqs.forEach((s) => rec.inFlight.add(s));
      const failed = () => { if (rec.receiver === r) due.seqs.forEach((s) => rec.inFlight.delete(s)); };
      const uncertain = replay ? due.seqs.filter((s) => sentTo.has(s)) : [];
      const doubt = uncertain.length ? `${uncertain.map((s) => `#${s}`).join(", ")} may already have reached ${[...new Set(uncertain.map((s) => sentTo.get(s)))].join(", ")}; check before repeating ${uncertain.length > 1 ? "their" : "its"} effects` : undefined;
      const content = compose(rel(page), url(page), due.events, entries, { replay, doubt, group: due.group, excerpt: (key: string) => excerpts().get(key), file: (name: string) => path.join(path.dirname(page), name) });
      try {
        r.send({ customType: due.customType, content, display: true, details: { page, seqs: due.seqs, replay, generation: r.generation, ...(uncertain.length ? { uncertain } : {}) } }, (idle) => {
          if (rec.receiver !== r) return;
          append(page, { origin: "kernel", type: "delivered", of: due.seqs, session: r.session, label: r.label });
          if (idle) arm(rec, r, due.seqs); else rec.awaiting.push(due.seqs);
        }, failed);
        sent += 1;
      } catch { failed(); }
    }
    return sent;
  }

  function arm(rec: Served, r: Receiver, seqs: number[]) {
    later(watchdogMs, () => {
      if (rec.receiver !== r) return;
      const received = new Set(readLog(rec.page).filter((e) => e.type === "received").flatMap((e) => e.of));
      const missing = seqs.filter((s) => !received.has(s) && !rec.seen.has(s));
      if (missing.length) append(rec.page, { origin: "kernel", type: "unconfirmed", of: missing });
    });
  }

  function postHuman(rec: Served, body: any): { status: number; json: unknown } {
    const page = rec.page;
    // With no receiver here, another process may have opened the Page since: its endpoint writes the Event Log then.
    let elsewhere: Lock | undefined;
    if (!rec.receiver) try { const lock = readLock(page); if (lock.session) elsewhere = lock; } catch { elsewhere = {}; }
    if (elsewhere) return { status: 409, json: { error: `This Page's input now goes to ${named(elsewhere)} in another Pi process. Ask the agent there for its link.` } };
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
    if (body.type === "decide" && body.custom && !body.option.trim()) return { status: 400, json: { error: "An own answer needs its text." } };
    const asked = body.delivery;
    if (body.type === "comment" && body.thread !== undefined && !readLog(page).some((e) => e.seq === body.thread && e.type === "comment")) return { status: 400, json: { error: `No Comment #${body.thread} to reply to.` } };
    if (body.type === "undo") {
      const log = readLog(page);
      const target = log.find((e) => e.seq === body.target && e.origin === "human" && e.type !== "undo");
      if (!target) return { status: 400, json: { error: "Nothing to undo." } };
      if (log.some((e) => e.type === "undo" && e.target === target.seq)) return { status: 409, json: { error: "Already undone." } };
      if (now() - target.at >= undoMs) return { status: 409, json: { error: `The ${undoMs / 1000}-second undo window has closed.` } };
    }
    // Decision 155: a Page-declared Decision is Immediate by default; atl-delivery may declare another class.
    const delivery = body.type === "decide" && ["record", "send", "immediate"].includes(asked) ? asked
      : body.type === "comment" && asked === "send" ? "send" : cls; // a Page may batch Comments (156)
    const entry = append(page, { ...event, origin: "human", delivery });
    if (delivery === "immediate" || delivery === "boundary") later(undoMs + 50, () => deliver(rec));
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
      const page = resolve(u.searchParams.get("page") ?? ""), rec = page ? served(page) : undefined;
      if (!page || !rec) return json(res, 404, { error: "No Pi session has this Page open. Ask the agent to open it." });
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
          try { const r = postHuman(rec, body); json(res, r.status, r.json); } catch (error) { json(res, 500, { error: String(error) }); }
        });
        return;
      }
      if (u.pathname === "/.atelier/image" && req.method === "POST") return upload(page, req, res);
      if (u.pathname === "/.atelier/stream") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        rec.clients.add(res);
        res.write(`event: hello\ndata: ${JSON.stringify({ mtime: statSync(page).mtimeMs, test: options.test || undefined, receiver: receiverInfo(rec.receiver) })}\n\n`);
        req.on("close", () => rec.clients.delete(res));
        return;
      }
      return json(res, 404, { error: "Unknown Atelier route" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Read-only" });
    if (u.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><title>Atelier</title><ul>${[...REG.served.values()].filter((r) => r.ep === ep).map((r) => r.page).map((p) => `<li><a href="${url(p)}">${rel(p).replace(/[<&]/g, "")}</a></li>`).join("")}</ul>`);
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

  // The server closes once its session has ended and no Page it serves has a receiver.
  function closeIfIdle() {
    const mine = [...REG.served.values()].filter((r) => r.ep === ep);
    if (running || mine.some((r) => r.receiver)) return;
    for (const r of mine) { for (const res of r.clients) res.end(); REG.served.delete(r.page); }
    for (const t of timers) clearTimeout(t);
    timers.clear();
    server?.close();
    server?.closeAllConnections?.();
  }

  const ep: Endpoint = { url, rel, now, undoMs, deliver, postHuman, append, broadcast, arm, later, closeIfIdle };

  /** The Page's record while this session is its receiver; otherwise why not, for the agent. */
  function receiving(page: string) {
    const rec = REG.served.get(page);
    if (rec?.receiver?.session === sessionId) return rec;
    let lock: Lock = {};
    try { lock = readLock(page); } catch { /* unreadable: named below as no session */ }
    throw new Error(`This Page was handed over to ${named(lock)} (generation ${lock.generation ?? 0}): its human input and Atelier actions belong to that session now. Stop working on it here.`);
  }
  // The receiver's record for a message's details, if this session still receives that generation.
  const mineFor = (details: { page?: string; seqs?: number[]; generation?: number } | undefined) => {
    const rec = details?.page && Array.isArray(details.seqs) ? REG.served.get(details.page) : undefined;
    const r = rec?.receiver;
    return r?.session === sessionId && details!.generation === r.generation ? rec : undefined;
  };

  /**
   * Makes this session the Page's receiver at the generation `claim` returns, on the endpoint already serving it in
   * this process, else on this one. From the claim to the receiver switch nothing awaits, so no delivery, receipt or
   * takeover in this process runs in between.
   */
  async function bind(page: string, claim: (check?: boolean) => number) {
    if (!REG.served.has(page)) { claim(true); await listen(); } // a refused claim starts no server
    const generation = claim();
    const rec = REG.served.get(page) ?? { page, ep, clients: new Set(), inFlight: new Set(), seen: new Set(), awaiting: [] };
    if (rec.ep === ep && !inProject(page)) mounts.set(mount(page), path.dirname(page));
    REG.served.set(page, rec);
    const previous = rec.receiver;
    if (previous?.session !== sessionId || previous.generation !== generation) {
      // Sends the previous receiver queued but never confirmed are replayed here, flagged; the rest it held are dropped.
      rec.receiver = { session: sessionId, label, generation, send: options.send, handoff: options.handoff, idle: options.idle };
      rec.inFlight.clear(); rec.seen.clear(); rec.awaiting.length = 0;
      rec.ep.broadcast(page, "receiver", { receiver: receiverInfo(rec.receiver) });
    }
    // Both sides of a takeover get the unfinished Requests: the old receiver to stop, the new one to carry on.
    const handedOver = !!previous && previous.session !== sessionId, unfinished = handedOver ? unfinishedRequests(page) : [];
    if (handedOver) previous!.handoff?.(handoffMessage(rec, unfinished));
    opened.add(page);
    const kernel = copyKernel(path.dirname(page));
    const replayed = rec.ep.deliver(rec, true);
    if (readLog(page).some((e) => e.origin === "human" && rec.ep.now() - e.at < rec.ep.undoMs)) rec.ep.later(rec.ep.undoMs + 50, () => rec.ep.deliver(rec));
    return { url: rec.ep.url(page), kernel, replayed, generation, unfinished };
  }

  const unfinishedRequests = (page: string): string[] => derive(readLog(page)).requests
    .filter((r: any) => !r.accepted && !r.cancel && !["done", "failed", "cancelled"].includes(r.state))
    .map((r: any) => `Request #${r.req.seq} "${r.req.job}" (${r.state ?? "not started"}, revision ${r.revision})`);

  function handoffMessage(rec: Served, unfinished: string[]): Message {
    return {
      customType: "atelier:handoff", display: true, details: { page: rec.page, seqs: [], replay: false },
      content: [`Atelier · ${path.basename(rec.page)} · handed over: its human input now goes to ${label} (generation ${rec.receiver!.generation}). Stop working on this Page here; your atelier actions on it now fail.`,
        ...unfinished.map((u) => `- unfinished: ${u}`)].join("\n"),
    };
  }

  /**
   * A takeover waits until the receiving session is between runs (its `idle`), checking every 50 ms up to quiesceMs,
   * then claims and switches in one synchronous step; it never forces a busy session. Takeovers of one Page queue in REG.
   */
  function takeover(page: string, generation: number) {
    const wait = options.quiesceMs ?? QUIESCE_MS;
    const run = async () => {
      const deadline = Date.now() + wait;
      for (;;) {
        const lock = readLock(page), r = REG.served.get(page)?.receiver;
        const busy = r && r.session === lock.session && r.session !== sessionId && r.idle && !safe(r.idle);
        if (!busy) return bind(page, (check) => claimPage(page, sessionId, label, generation, check));
        claimPage(page, sessionId, label, generation, true); // still the generation the caller saw? else throws why
        if (Date.now() >= deadline) throw new Error(`Session ${r!.label} is busy: its run did not end within ${wait / 1000} s. Try again when it is idle.`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    const queued = (REG.queue.get(page) ?? Promise.resolve()).then(run, run);
    REG.queue.set(page, queued.catch(() => {}));
    return queued;
  }
  const safe = (idle: () => boolean) => { try { return idle(); } catch { return false; } };

  const deliverDue = (page: string, replay = false) => { const rec = REG.served.get(page); return rec?.receiver?.session === sessionId ? rec.ep.deliver(rec, replay) : 0; };
  return {
    root,
    url: (page: string) => REG.served.get(page)?.ep.url(page) ?? url(page),
    rel,
    deliverDue,
    /** A human event from the Page's tab, through whichever endpoint serves it. */
    postHuman: (page: string, body: any) => { const rec = REG.served.get(page); return rec ? rec.ep.postHuman(rec, body) : { status: 404, json: { error: "Not open" } }; },
    isOpen: (page: string) => opened.has(page),
    clients: (page: string) => REG.served.get(page)?.clients.size ?? 0,
    /** False once the Page was handed over: a send this session still holds must not go out. */
    current: (details: { page?: string; seqs?: number[]; generation?: number }) => !!mineFor(details),
    /** Serves the Page, copies the Kernel, and hands undelivered events to this session (131). Never takes the Page from another live receiver. */
    async open(page: string) { return bind(page, (check) => claimPage(page, sessionId, label, undefined, check)); },
    /** Moves the Page's receiver here from a live session of this process, at the generation the caller was shown, once that session is idle; the URL and open tabs stay. */
    takeover,
    agent(page: string, entry: Record<string, unknown>) { return receiving(page).ep.append(page, { ...entry, origin: "agent" }); },
    /** Shows the rewritten Page; the one-line note names what changed in the Page's change indicators (156). */
    update(page: string, note?: string) {
      const rec = receiving(page);
      if (note) rec.ep.append(page, { origin: "agent", type: "update", note });
      rec.ep.broadcast(page, "update", { mtime: statSync(page).mtimeMs, note });
      return rec.clients.size;
    },
    receipt(details: { page?: string; seqs?: number[]; generation?: number } | undefined) {
      const rec = mineFor(details);
      if (rec) rec.ep.append(rec.page, { origin: "kernel", type: "received", of: details!.seqs });
    },
    /** A message reached the session (message_end); its receipt waits for agent_settled, when the session file holds it (131). */
    seen(details: { page?: string; seqs?: number[]; generation?: number } | undefined) {
      const rec = mineFor(details);
      for (const s of rec ? details!.seqs! : []) rec!.seen.add(s);
    },
    settled() {
      for (const rec of REG.served.values()) {
        const r = rec.receiver;
        if (r?.session !== sessionId) continue;
        if (rec.seen.size) rec.ep.append(rec.page, { origin: "kernel", type: "received", of: [...rec.seen] });
        rec.seen.clear();
        for (const seqs of rec.awaiting.splice(0)) rec.ep.arm(rec, r, seqs);
      }
    },
    stop() {
      if (!running) return;
      running = false;
      REG.live.delete(sessionId);
      const endpoints = new Set<Endpoint>([ep]);
      for (const rec of [...REG.served.values()]) {
        if (rec.receiver?.session !== sessionId) continue;
        releasePage(rec.page, sessionId, rec.receiver.generation);
        rec.receiver = undefined;
        rec.inFlight.clear(); rec.seen.clear(); rec.awaiting.length = 0;
        rec.ep.broadcast(rec.page, "receiver", { receiver: null });
        endpoints.add(rec.ep);
      }
      for (const e of endpoints) e.closeIfIdle();
    },
  };
}
