// Atelier Kernel 2.0.0: the Page side of Atelier (pi-workbench extensions/atelier, decisions 107-133).
// A dependency-free ES module with no build step (120), copied beside each Page (111). A change made in
// a copy is a Contribution: raise it as a pull request against pi-workbench (114).
//
// Page contract (mechanics only, decision 117):
//   <script type="module" src="atelier.js"></script>   the Kernel; idiomorph.js sits beside it
//   atl-key="turn-3"           an element the human judges; nested Keys form the address run-12/turn-3 (118)
//   atl-ver="sha-or-rev"       version of the content under it; every event records it (127)
//   atl-decide="A|B|C"        a Decision on a keyed element; its id is the Key address (133). Optional:
//     atl-rec="A"              the recommended option
//     atl-note="Redo"          options that need a note before they post
//     atl-delivery="record|send|immediate" (default immediate); atl-material="key" counts as opened (113)
//   atl-slot                   inside a Decision: where its options render, e.g. one table cell; else at the end
//   atl-request="job"          a button or form that asks the agent for a typed job; form fields become its input (108)
//   atl-group                  on a keyed element: its Comments get their own "Send (n)" (128)
//   document "atelier:update"  fires after each Update, so page scripts re-read their data files (130)
// Human state lives only in <page>.events.jsonl, never in the HTML (125).
// Kernel controls take the Page's colours: override --atl-bg, --atl-fg, --atl-muted, --atl-line, --atl-accent, --atl-warn.
//
// Icons: Lucide (lucide-static 1.52.0), ISC License, Copyright (c) 2026 Lucide Icons and Contributors.
// Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby
// granted, provided that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS
// PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
// OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR
// CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF
// CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
import { Idiomorph } from "./idiomorph.js";

export const UNDO_MS = 10_000; // decision 129
// Delivery class per human event type (128). `boundary` is the Send that releases drafts; `control` is undo.
export const CLASSES = {
  comment: "send", decide: "immediate", request: "immediate", cancel: "immediate", rework: "immediate",
  accept: "record", opened: "record", close: "record", still: "record", send: "boundary", undo: "control",
};
export const REQUEST_STATES = ["queued", "running", "done", "failed", "cancelled"];

export const inGroup = (key, group) => !group || key === group || (typeof key === "string" && key.startsWith(`${group}/`));

const pipe = (s) => String(s ?? "").split("|").map((x) => x.trim()).filter(Boolean);
// A Page-declared Decision (133): its id and Key are the element's address; it has no question beyond the Page.
const declaredDecision = (id, options, rec, extra = {}) => ({ id, key: id, declared: true, options: pipe(options).map((label) => ({ label, recommended: label === rec })), ...extra });

/**
 * Replays the Event Log into the state the Page shows. `currentVer(key)` reads atl-ver on the live Page (127);
 * `declared` lists the Page's atl-decide Decisions, so unanswered ones count as to answer (133).
 */
export function derive(entries, currentVer = () => null, declared = []) {
  const undone = new Set(entries.filter((e) => e.type === "undo").map((e) => e.target));
  const live = entries.filter((e) => e.type !== "undo" && !undone.has(e.seq));
  const delivered = new Set(), received = new Set(), unconfirmed = new Set();
  for (const e of entries) {
    if (e.type === "delivered") e.of.forEach((s) => delivered.add(s));
    if (e.type === "unconfirmed") e.of.forEach((s) => unconfirmed.add(s));
    if (e.type === "received") e.of.forEach((s) => { received.add(s); unconfirmed.delete(s); });
  }
  const bySeq = new Map(live.map((e) => [e.seq, e]));
  // A draft (Send class) belongs to the first later Send whose group covers it (Review Studio's "Offene senden" flush boundary).
  const sentBy = new Map();
  for (const s of live.filter((e) => e.type === "send")) {
    for (const d of live) if (d.delivery === "send" && d.seq < s.seq && !sentBy.has(d.seq) && inGroup(d.key, s.key)) sentBy.set(d.seq, s.seq);
  }
  const status = (e) => {
    if (e.local) return "local";
    if (e.origin !== "human") return "agent";
    if (e.delivery === "record") return "recorded";
    if (e.delivery === "send" && !sentBy.has(e.seq)) return "draft"; // unsent drafts carry no state (Review Studio b0a391aee)
    if (received.has(e.seq)) return "delivered";
    if (unconfirmed.has(e.seq)) return "unconfirmed";
    if (delivered.has(e.seq)) return "queued";
    return "pending"; // inside the undo window, or waiting for a session to open the Page
  };
  const rootOf = (seq) => { let e = bySeq.get(seq); while (e?.thread < e?.seq && bySeq.has(e.thread)) e = bySeq.get(e.thread); return e?.seq; };
  const stale = (key, ver) => { const now = key ? currentVer(key) : null; return ver != null && now != null && ver !== now; };

  const threads = new Map(), decisions = new Map(), requests = new Map();
  for (const d of declared) if (!decisions.has(d.id)) decisions.set(d.id, { ...d, answer: null, opened: false });
  for (const e of live) {
    if (e.type === "comment") {
      const root = e.thread < e.seq ? threads.get(rootOf(e.thread)) : undefined;
      if (root) { root.msgs.push(e); root.closed = false; }
      else threads.set(e.seq, { root: e, msgs: [e], closed: false, ver: e.ver ?? null, key: e.key ?? null });
    } else if (e.type === "answer") threads.get(rootOf(e.target))?.msgs.push(e);
    else if (e.type === "close") { const t = threads.get(rootOf(e.target)); if (t) { t.closed = true; if (e.ver !== undefined) t.ver = e.ver; } } // closed on the version the human saw
    else if (e.type === "still") { const t = threads.get(rootOf(e.target)); if (t) { t.ver = e.ver ?? null; t.closed = false; } }
    else if (e.type === "ask") decisions.set(e.decision.id, { ...e.decision, askSeq: e.seq, answer: null, opened: false });
    else if (e.type === "opened") { const d = decisions.get(e.decision); if (d) d.opened = true; }
    else if (e.type === "decide") {
      // A Page-declared answer carries its options, so the Decision replays even where the Page is not loaded.
      if (!decisions.has(e.decision) && e.options) decisions.set(e.decision, { ...declaredDecision(e.decision, e.options, e.rec), answer: null, opened: false });
      const d = decisions.get(e.decision); if (d) d.answer = e; // the newest answer counts; the human may change it any time (133)
    }
    else if (e.type === "request") requests.set(e.seq, { req: e, state: null, revision: 1, note: null, cancel: false, accepted: false, rework: null });
    else if (e.type === "status") {
      // agentclick's revision: a status written for an earlier revision is stale and ignored.
      const r = requests.get(e.target);
      if (r && (e.revision ?? r.revision) === r.revision) { r.state = e.state; r.note = e.note ?? null; }
    } else if (e.type === "rework") {
      // agentclick pending → rewriting → pending(revision+1): rework clears the result and raises the revision.
      const r = requests.get(e.target);
      if (r) Object.assign(r, { revision: r.revision + 1, state: null, note: null, rework: e, accepted: false });
    } else if (e.type === "cancel") { const r = requests.get(e.target); if (r) r.cancel = true; }
    else if (e.type === "accept") { const r = requests.get(e.target); if (r) r.accepted = true; }
  }
  // Decision 127: a close or an answer holds for the version it was made on; a newer version reopens it.
  for (const t of threads.values()) { t.stale = stale(t.key, t.ver); if (t.stale) t.closed = false; }
  for (const d of decisions.values()) d.stale = d.answer !== null && stale(d.key ?? d.answer.key, d.answer.ver);
  const drafts = live.filter((e) => status(e) === "draft");
  return {
    threads: [...threads.values()], decisions: [...decisions.values()],
    requests: [...requests.values()], drafts, status,
    openThreads: [...threads.values()].filter((t) => !t.closed && status(t.root) !== "draft"),
    toAnswer: [...decisions.values()].filter((d) => d.answer === null || d.stale),
  };
}

const quote = (s) => JSON.stringify(String(s ?? ""));
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
// Where an event sits, with enough of the Page that the agent need not open it: the quoted selection, else the Key's text.
const at = (e, excerpt) => {
  const text = e.key && !e.quote ? clip(excerpt?.(e.key), 120) : "";
  const where = e.quote ? `on the text ${quote(clip(e.quote.exact, 120))}${e.key ? ` in ${e.key}` : ""}` : e.key ? `on ${e.key}${text ? ` (${quote(text)})` : ""}` : e.selector ? `on ${e.selector.sel}` : "on the Page";
  return [where, e.t != null ? `at ${Number(e.t).toFixed(1)} s` : "", e.ver ? `(version ${e.ver})` : ""].filter(Boolean).join(" ");
};

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", middot: "·", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", rarr: "→", larr: "←" };
/**
 * The text under each Key address in a Page's HTML source, for excerpts in Delivery. Keys a page script
 * renders later are not in the source and get none.
 */
// ponytail: a tag-stack scan, not an HTML parser; implied end tags (an unclosed <p>) can blur an excerpt, every
// tag counts as a word break, and only common named entities decode. Use parse5 if excerpts must be exact.
export function keyTexts(html) {
  const texts = new Map(), stack = [];
  const re = /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/gi;
  for (const [, , close, tag, attrs, text] of String(html).matchAll(re)) {
    if (text === undefined) for (const f of stack) if (f.addr) f.text += " ";
    if (text !== undefined) {
      const t = text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) => c[0] === "#" ? String.fromCodePoint(c[1].toLowerCase() === "x" ? parseInt(c.slice(2), 16) : +c.slice(1)) : ENTITY[c] ?? m);
      for (const f of stack) if (f.addr && f.text.length < 400) f.text += t;
    } else if (tag && close) {
      const i = stack.findLastIndex((f) => f.tag === tag.toLowerCase());
      if (i >= 0) for (const f of stack.splice(i)) if (f.addr && !texts.has(f.addr)) texts.set(f.addr, f.text);
    } else if (tag && !VOID.has(tag.toLowerCase()) && !attrs.trimEnd().endsWith("/")) {
      const key = /\satl-key\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const parent = stack.findLast((f) => f.addr)?.addr;
      const own = key ? key[1] ?? key[2] ?? key[3] : undefined;
      stack.push({ tag: tag.toLowerCase(), addr: own === undefined ? undefined : parent ? `${parent}/${own}` : own, text: "" });
    }
  }
  for (const f of stack) if (f.addr && !texts.has(f.addr)) texts.set(f.addr, f.text);
  return texts;
}

/** Which messages a thread card shows: all of a short thread; of a long one the first, a fold, and the last two. */
export function threadLayout(msgs, expanded = false) {
  if (expanded || msgs.length <= 4) return { head: msgs, folded: [], tail: [] };
  return { head: msgs.slice(0, 1), folded: msgs.slice(1, -2), tail: msgs.slice(-2) };
}

/** One line per human event, numbered like the Page's markers (pi-artifacts `[annotationId]`, Plannotator numbering). */
export function describe(e, entries, excerpt) {
  const ask = (id) => [...entries].reverse().find((x) => x.type === "ask" && x.decision.id === id)?.decision;
  switch (e.type) {
    case "comment": {
      if (e.thread === undefined) return `#${e.seq} Comment ${at(e, excerpt)}: ${quote(e.text)}`;
      // A reply carries the thread so far, oldest first, so it reads without the Page.
      const earlier = derive(entries).threads.find((t) => t.msgs.some((m) => m.seq === e.seq))?.msgs.filter((m) => m.seq < e.seq) ?? [];
      const context = earlier.map((m) => `${m.origin === "agent" ? "Agent" : "You"}: ${quote(clip(m.text, 200))}`).join(" · ");
      return `#${e.seq} Reply in thread #${e.thread}${context ? ` (${context})` : ""}: ${quote(e.text)}`;
    }
    case "decide": {
      const d = ask(e.decision) ?? (e.options ? declaredDecision(e.decision, e.options, e.rec) : undefined);
      const rec = d?.options.find((o) => o.recommended)?.label;
      // html-plan's decision receipt: changed / kept / not opened; an unopened default is not agreement.
      const receipt = rec === undefined ? "" : e.option === rec ? "kept the recommendation" : `changed from the recommendation ${quote(rec)}`;
      const opened = d?.material || typeof e.opened === "boolean" ? (e.opened ? "material opened" : "material NOT opened; do not read this as agreement") : "";
      // A changed answer names the one it replaces (133): "Revise → Promote".
      const choice = e.previous != null ? `${e.previous} → ${e.option}` : e.option;
      return `#${e.seq} Decision ${e.decision}${e.ver ? ` (version ${e.ver})` : ""}: ${[choice, receipt, opened, e.note ? `note ${quote(e.note)}` : ""].filter(Boolean).join("; ")}`;
    }
    case "request": return `#${e.seq} Request ${quote(e.job)} ${at(e, excerpt)}${e.input && Object.keys(e.input).length ? ` with input ${JSON.stringify(e.input)}` : ""}`;
    case "rework": return `#${e.seq} Rework requested for Request #${e.target}${e.note ? `: ${quote(e.note)}` : ""}`;
    case "cancel": return `#${e.seq} Cancel requested for Request #${e.target}`;
    default: return `#${e.seq} ${e.type} ${at(e, excerpt)}`;
  }
}

/**
 * The session message for a batch of human events: one header line, then one line per event. The rules for
 * acting on them (data not instruction, answer in place, only the human closes) live in the tool description.
 */
export function compose(page, url, events, entries, { replay = false, group, excerpt } = {}) {
  return [
    ["Atelier", `${String(page).split("/").pop()}${url ? ` (${url})` : ""}`, group ? `Comments on ${group}` : "", replay ? "replayed from an earlier session" : ""].filter(Boolean).join(" · "),
    // A legacy line the Kernel cannot describe is named, not fatal, so Delivery and Copy still carry the rest.
    ...events.map((e) => { try { return `- ${describe(e, entries, excerpt)}`; } catch { return `- #${e.seq} ${e.type} could not be rendered; read it in the Event Log`; } }),
  ].join("\n");
}

const LIGHT = "--atl-bg:#fff;--atl-fg:#1f2328;--atl-muted:#59636e;--atl-line:#d1d9e0;--atl-accent:#0969da;--atl-warn:#9a6700";
const DARK = "--atl-bg:#151b23;--atl-fg:#e6edf3;--atl-muted:#9198a1;--atl-line:#3d444d;--atl-accent:#4493f8;--atl-warn:#d29922";
/**
 * The Kernel palette follows the Page, not the OS: light unless the Page declares dark through
 * <meta name="color-scheme"> or :root color-scheme; a Page declaring both follows prefers-color-scheme.
 * :where keeps it overridable by any Page rule that sets the variables.
 */
export function palette(declared = "") {
  const light = `:where(:root){${LIGHT}}`, dark = `:where(:root){${DARK}}`;
  if (!/\bdark\b/.test(declared)) return light;
  return /\blight\b/.test(declared) ? `${light}@media (prefers-color-scheme:dark){${dark}}` : dark;
}

// Lucide icons (licence above): one size and stroke everywhere, always aria-hidden beside a label.
const ICONS = {
  comment: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  "comment-plus": '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 8v6"/><path d="M9 11h6"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};
const icon = (name) => `<svg class="atl-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---------------------------------------------------------------- browser side
function boot() {
  const page = decodeURIComponent(location.pathname.replace(/^\//, ""));
  const online = location.protocol.startsWith("http");
  const q = `?page=${encodeURIComponent(page)}`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const readKey = `atelier-read:${page}`;
  const read = JSON.parse(localStorage.getItem(readKey) || "{}");
  let cursor = 0, entries = [], local = [], conn = online ? "connecting" : "no session", es = null, mtime = null, composer = null, nextIndex = 0;
  const expanded = new Set(); // threads whose folded middle the human opened
  const touched = new WeakSet(), keyUis = new Map(), pins = new Map(), decUis = new Map(), cards = new Map();
  let hot = null, savedRange = null;

  const isUi = (n) => n.closest?.("[atl-ui]");
  const keyOf = (el) => { const parts = []; for (let n = el?.closest?.("[atl-key]"); n; n = n.parentElement?.closest("[atl-key]")) if (!isUi(n)) parts.unshift(n.getAttribute("atl-key")); return parts.join("/") || undefined; };
  const keyed = () => [...document.querySelectorAll("[atl-key]")].filter((el) => !isUi(el));
  // ponytail: the Key map is rebuilt once per render; fine for hundreds of Keys.
  let keyMap = null;
  const findKey = (addr) => {
    if (!keyMap) { keyMap = new Map(); for (const el of keyed()) { const k = keyOf(el); if (!keyMap.has(k)) keyMap.set(k, el); } }
    return addr ? keyMap.get(addr) : undefined;
  };
  const verOf = (el) => el?.closest("[atl-ver]")?.getAttribute("atl-ver") ?? null;
  const currentVer = (addr) => verOf(findKey(addr));
  // Decisions the Page declares with atl-decide (133); the first element at an address wins, like findKey.
  const declared = () => keyed().filter((el) => el.hasAttribute("atl-decide")).map((el) => {
    const id = keyOf(el);
    return declaredDecision(id, el.getAttribute("atl-decide"), el.getAttribute("atl-rec"), { note: pipe(el.getAttribute("atl-note")), material: el.getAttribute("atl-material") ?? undefined, delivery: el.getAttribute("atl-delivery") ?? undefined });
  });
  const all = () => [...entries, ...local];
  const state = () => derive(all(), currentVer, declared());
  const now = () => Date.now();

  // ---- UI roots. Everything the Kernel draws carries atl-ui and is lifted out before each morph.
  const panel = h(`<aside atl-ui="panel" aria-label="Atelier"><style class="atl-palette"></style><style>${STYLE}</style><div class="atl-bar"></div><div class="atl-undo" aria-live="polite"></div><div class="atl-slot"></div><div class="atl-list"></div></aside>`);
  const orphans = h(`<section atl-ui="orphans" aria-label="Decisions"></section>`);
  // Shown beside a text selection on the Page; pointerdown keeps the selection it comments on.
  const selBtn = h(`<button atl-ui="sel" class="atl-selbtn" data-atl="selcomment" hidden>${icon("comment-plus")} Comment</button>`);
  selBtn.addEventListener("pointerdown", (ev) => ev.preventDefault());
  document.body.prepend(orphans);
  document.body.append(panel, selBtn);

  function h(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function set(el, html) { if (el && el.__html !== html) { el.__html = html; el.innerHTML = html; } }
  // Keyed reconcile: an item's node survives while its id stays, so focus and typed notes survive (Review Studio review-studio-focus.test.mjs).
  function reconcile(container, items) {
    const keep = new Set(items.map((i) => i.id));
    for (const child of [...container.children]) if (!keep.has(child.dataset.id)) child.remove();
    items.forEach((item, i) => {
      let node = cards.get(item.id);
      if (!node) { node = h(`<div class="atl-card" tabindex="-1" data-id="${esc(item.id)}"><div class="atl-c"></div>${item.extra ?? ""}</div>`); cards.set(item.id, node); }
      set(node.firstElementChild, item.html);
      node.classList.toggle("atl-open-item", !!item.open);
      if (container.children[i] !== node) container.insertBefore(node, container.children[i] ?? null);
    });
  }

  // ---- talking to the page server. A pull and a POST can return the same entry, so entries merge by seq.
  function add(list) {
    const known = new Set(entries.map((e) => e.seq));
    const fresh = list.filter((e) => !known.has(e.seq));
    if (fresh.length) { entries.push(...fresh); entries.sort((a, b) => a.seq - b.seq); }
    return fresh.length;
  }
  async function pull() {
    if (!online) return;
    try {
      // Only a pull moves the cursor: a POST's own entry may be newer than another tab's unfetched one.
      const r = await fetch(`/.atelier/events${q}&since=${cursor}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error);
      const list = (await r.json()).entries;
      cursor = list.reduce((max, e) => Math.max(max, e.seq), cursor);
      if (add(list)) render();
    } catch { conn = "no session"; render(); }
  }

  async function post(body) {
    if (online) {
      try {
        const r = await fetch(`/.atelier/events${q}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json();
        if (r.ok) { add([j.entry]); render(); return j.entry; }
        if (r.status !== 404) { flash(j.error ?? "Rejected"); return; }
      } catch { /* no server: fall through */ }
      conn = "no session";
    }
    // No session serves this Page: keep the event here and offer Copy (decision 109; pi-artifacts' 503 + Copy).
    if (body.type === "undo") { local = local.filter((e) => e.seq !== body.target); render(); return; }
    const e = { ...body, seq: -(local.length + 1), at: now(), origin: "human", local: true, delivery: body.delivery ?? CLASSES[body.type] };
    local.push(e); render(); return e;
  }

  function connect() {
    if (!online || es) return;
    es = new EventSource(`/.atelier/stream${q}`);
    es.addEventListener("hello", (m) => { const t = JSON.parse(m.data).mtime; if (mtime !== null && t !== mtime) morph(); mtime = t; conn = "live"; render(); pull(); });
    es.addEventListener("log", pull);
    es.addEventListener("update", (m) => { mtime = JSON.parse(m.data).mtime; morph(); });
    es.onerror = () => { conn = "reconnecting"; render(); };
  }
  // pi-artifacts 1.5.0: one EventSource per tab, closed while hidden, so many tabs never starve the connection limit.
  document.addEventListener("visibilitychange", () => { if (document.hidden) { es?.close(); es = null; } else connect(); });

  // ---- Update (123): morph the body with idiomorph and keep the human's open input.
  async function morph() {
    const html = await (await fetch(location.pathname, { cache: "no-store" })).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const active = document.activeElement;
    const range = active && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
    // Lift out only top-level Kernel nodes; a composer inside a Key's UI travels with it.
    document.querySelectorAll("[atl-ui]").forEach((n) => { if (!n.parentElement.closest("[atl-ui]")) n.remove(); });
    const sheet = (d) => [...d.head.querySelectorAll("style,link[rel=stylesheet]")];
    if (sheet(document).map((n) => n.outerHTML).join() !== sheet(doc).map((n) => n.outerHTML).join()) {
      sheet(document).forEach((n) => n.remove());
      sheet(doc).forEach((n) => document.head.append(document.importNode(n, true)));
    }
    document.title = doc.title;
    // idiomorph keeps node identity only through ids, so Keys lend theirs for the morph: a keyed element
    // survives even among same-tag siblings, and with it any state the page script holds on it.
    const lend = (root) => root.querySelectorAll("[atl-key]:not([id])").forEach((el) => { if (!isUi(el)) el.id = `atl-key:${keyOf(el)}`; });
    lend(document); lend(doc);
    Idiomorph.morph(document.body, doc.body, {
      morphStyle: "innerHTML", ignoreActiveValue: true, restoreFocus: true,
      callbacks: { beforeAttributeUpdated: (name, el) => !(touched.has(el) && /^(value|checked|selected)$/.test(name)) },
    });
    document.querySelectorAll('[id^="atl-key:"]').forEach((el) => el.removeAttribute("id"));
    document.body.prepend(orphans);
    document.body.append(panel, selBtn);
    render();
    if (active?.isConnected && document.activeElement !== active) { active.focus({ preventScroll: true }); if (range) active.setSelectionRange(...range); }
    document.dispatchEvent(new CustomEvent("atelier:update"));
  }

  // ---- text anchors: quote fallback (pi-artifacts {exact,prefix,suffix}) painted with the CSS Custom Highlight API
  function textIndex() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => isUi(n.parentElement) || n.parentElement.closest("script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; let text = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ n, start: text.length }); text += n.data; }
    return { text, nodes };
  }
  const offsetOf = (idx, node, off) => (idx.nodes.find((x) => x.n === node)?.start ?? -1) + off;
  function rangeAt(idx, start, end) {
    const pos = (o) => { const x = [...idx.nodes].reverse().find((y) => y.start <= o); return x ? [x.n, Math.min(o - x.start, x.n.data.length)] : null; };
    const a = pos(start), b = pos(end); if (!a || !b) return null;
    const r = document.createRange(); r.setStart(...a); r.setEnd(...b); return r;
  }
  function findQuote(qt, idx) {
    // Plannotator's rule: verify the text itself; ambiguous or missing quotes fail closed into Unanchored.
    const hits = []; for (let i = idx.text.indexOf(qt.exact); i >= 0 && hits.length < 50; i = idx.text.indexOf(qt.exact, i + 1)) hits.push(i);
    const best = hits.find((i) => idx.text.slice(Math.max(0, i - qt.prefix.length), i).endsWith(qt.prefix) && idx.text.slice(i + qt.exact.length).startsWith(qt.suffix)) ?? (hits.length === 1 ? hits[0] : undefined);
    return best === undefined ? null : rangeAt(idx, best, best + qt.exact.length);
  }
  // A verified selector for unkeyed spots (decision 118): unique match plus a text snapshot, else Unanchored.
  function selectorFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) parts.unshift(`${n.localName}:nth-of-type(${[...n.parentElement.children].filter((c) => c.localName === n.localName).indexOf(n) + 1})`);
    return `body > ${parts.join(" > ")}`;
  }
  function findSelector(s) { try { const hits = document.querySelectorAll(s.sel); return hits.length === 1 && !isUi(hits[0]) && hits[0].textContent.trim().startsWith(s.snap) ? hits[0] : null; } catch { return null; } }

  // Where a thread is drawn: its Key, else its quote or selector, else Unanchored (118).
  // A Key's own text without Kernel UI, for the excerpt a copied message carries.
  function keyText(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => isUi(n.parentElement) || n.parentElement.closest("script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let text = ""; for (let n = walker.nextNode(); n && text.length < 400; n = walker.nextNode()) text += n.data;
    return text;
  }
  function placeThread(t, idx) {
    const r = t.root;
    if (r.key && findKey(r.key)) return { where: "key", el: findKey(r.key) };
    if (r.quote) { const range = findQuote(r.quote, idx); if (range) return { where: "text", range }; }
    if (r.selector) { const el = findSelector(r.selector); if (el) return { where: "text", el }; }
    return { where: "unanchored" };
  }

  // ---- rendering
  const STATUS = { draft: "draft, not sent", pending: "waiting", queued: "queued for the agent", delivered: "delivered", unconfirmed: "not confirmed: Copy it", local: "no session: Copy it", recorded: "recorded" };
  const left = (e) => Math.ceil((e.at + UNDO_MS - now()) / 1000);
  const statusText = (st, e) => { const s = st.status(e); return s === "pending" && left(e) > 0 ? `sends in ${left(e)} s` : STATUS[s] ?? ""; };

  function threadHtml(t, st) {
    const lastRead = read[t.root.seq] ?? 0;
    const unread = t.msgs.filter((m) => m.origin === "agent" && m.seq > lastRead).length;
    const msg = (m) => `<div class="atl-msg ${m.origin === "agent" ? "atl-agent" : "atl-you"}"><div class="atl-who"><b>${m.origin === "agent" ? "Agent" : "You"}</b> <span class="atl-dim">#${m.seq}${m.origin === "human" ? ` · ${esc(statusText(st, m))}` : ""}</span></div><div>${esc(m.text)}</div></div>`;
    const { head, folded, tail } = threadLayout(t.msgs, expanded.has(t.root.seq));
    const anchor = t.root.quote ? `<div class="atl-quote">“${esc(t.root.quote.exact.slice(0, 140))}”</div>` : t.root.t != null ? `<div class="atl-dim">at ${Number(t.root.t).toFixed(1)} s</div>` : "";
    return `<div class="atl-head"><span class="atl-tag">${t.closed ? "closed" : "open"}</span>${t.stale ? `<span class="atl-tag atl-warn">${icon("alert")} on an earlier version</span>` : ""}${unread ? `<span class="atl-tag atl-new">${unread} new</span>` : ""}</div>${anchor}
      ${head.map(msg).join("")}${folded.length ? `<button data-atl="expand" data-seq="${t.root.seq}" class="atl-earlier">${folded.length} earlier</button>` : ""}${tail.map(msg).join("")}
      <div class="atl-actions"><button data-atl="reply" data-seq="${t.root.seq}">${icon("pencil")} Reply</button>${t.stale && !t.closed ? `<button data-atl="close" data-seq="${t.root.seq}">${icon("check")} Fixed: close</button><button data-atl="still" data-seq="${t.root.seq}">Still applies</button>` : t.closed ? "" : `<button data-atl="close" data-seq="${t.root.seq}">${icon("check")} Close</button>`}${t.root.key || t.root.quote || t.root.selector ? `<button data-atl="jump" data-seq="${t.root.seq}">${icon("eye")} Show</button>` : ""}</div>`;
  }

  function decisionHtml(d, st) {
    const a = d.answer;
    const opts = d.options.map((o) => `<button data-atl="decide" data-id="${esc(d.id)}" data-label="${esc(o.label)}" class="atl-opt${o.recommended ? " atl-rec" : ""}${a?.option === o.label ? " atl-chosen" : ""}"><b>${esc(o.label)}</b>${o.recommended ? ` <span class="atl-tag">recommended</span>` : ""}<span class="atl-dim">${esc(o.consequence)}</span></button>`).join("");
    return `<div class="atl-head"><span class="atl-tag">${a && !d.stale ? "answered" : "to answer"}</span>${d.stale ? `<span class="atl-tag atl-warn">${icon("alert")} answered on an earlier version</span>` : ""}</div>
      <div class="atl-q">${esc(d.question)}</div>${d.detail ? `<div class="atl-dim">${esc(d.detail)}</div>` : ""}
      ${materialHtml(d)}<div class="atl-opts">${opts}</div>${receiptHtml(d, st)}`;
  }
  const materialHtml = (d) => d.material ? `<button data-atl="material" data-id="${esc(d.id)}">${d.opened ? `${icon("check")} Material opened` : `${icon("eye")} Open the material`}</button>` : "";
  // The current answer, what it changed from, and the recommendation receipt; always editable (133).
  function receiptHtml(d, st) {
    const a = d.answer;
    if (!a) return "";
    const rec = d.options.find((o) => o.recommended)?.label;
    return `<div class="atl-dim">${[`Your answer: ${esc(a.option)}`, a.previous != null ? `changed from ${esc(a.previous)}` : "", rec === undefined ? "" : a.option === rec ? "kept the recommendation" : "not the recommendation", d.material ? `material ${a.opened ? "opened" : "not opened"}` : "", a.note ? `note: ${esc(a.note)}` : "", esc(statusText(st, a))].filter(Boolean).join(" · ")}</div>`;
  }

  // A Page-declared Decision renders as a row of options in its atl-slot, or at the end of its element (133).
  function declaredHtml(d, st) {
    const a = d.answer;
    return d.options.map((o) => `<button data-atl="decide" data-id="${esc(d.id)}" data-label="${esc(o.label)}" aria-pressed="${a?.option === o.label}" class="${o.recommended ? "atl-rec" : ""}${a?.option === o.label ? " atl-chosen" : ""}"${o.recommended ? ` title="Recommended"` : ""}>${esc(o.label)}${o.recommended ? `<span class="atl-sr"> (recommended)</span>` : ""}</button>`).join("")
      + materialHtml(d) + (d.stale ? `<span class="atl-tag atl-warn">${icon("alert")} answered on an earlier version</span>` : "");
  }

  function requestHtml(r, st) {
    const last = r.rework ?? r.req;
    const state = r.state ?? (st.status(last) === "delivered" || st.status(last) === "queued" ? "queued" : statusText(st, last));
    const terminal = ["done", "failed", "cancelled"].includes(r.state);
    return `<div><b>${esc(r.req.job)}</b> <span class="atl-dim">#${r.req.seq}${r.req.key ? ` · ${esc(r.req.key)}` : ""}${r.revision > 1 ? ` · revision ${r.revision}` : ""}</span></div>
      <div><span class="atl-tag atl-state-${esc(r.state ?? "wait")}">${esc(state)}</span>${r.accepted ? ` <span class="atl-tag">accepted</span>` : ""}${r.cancel && !terminal ? ` <span class="atl-dim">cancel requested</span>` : ""} ${r.note ? `<span>${esc(r.note)}</span>` : ""}</div>
      ${r.rework?.note ? `<div class="atl-dim">Rework: ${esc(r.rework.note)}</div>` : ""}
      <div class="atl-actions">${!terminal && !r.cancel ? `<button data-atl="cancel" data-seq="${r.req.seq}">Cancel</button>` : ""}${r.state === "done" && !r.accepted ? `<button data-atl="accept" data-seq="${r.req.seq}">Accept</button><button data-atl="rework" data-seq="${r.req.seq}">Rework…</button>` : ""}</div>`;
  }

  // A Key's UI goes inside it, except where children would not show: after media and void elements, into a row's last cell.
  function place(ui, el) {
    if (el.matches("img,video,audio,canvas,iframe,input,textarea,select,svg,hr,br")) { if (el.nextSibling !== ui) el.after(ui); }
    else { const box = el.matches("tr") ? el.lastElementChild ?? el : el; if (ui.parentElement !== box) box.append(ui); }
  }

  function render() {
    keyMap = null;
    const st = state();
    set(panel.querySelector(".atl-palette"), palette(`${document.querySelector('meta[name="color-scheme"]')?.content ?? ""} ${getComputedStyle(document.documentElement).colorScheme ?? ""}`));
    const idx = textIndex();
    const placed = new Map(st.threads.map((t) => [t.root.seq, placeThread(t, idx)]));
    const seen = new Set(), kept = new Set();
    for (const el of keyed()) {
      const addr = keyOf(el);
      if (seen.has(addr)) continue; seen.add(addr);
      let ui = keyUis.get(addr);
      if (!ui) { ui = h(`<div atl-ui="key" data-key="${esc(addr)}"><div class="atl-khead"></div><div class="atl-kbody"></div><div class="atl-slot"></div></div>`); keyUis.set(addr, ui); }
      const threadsHere = st.threads.filter((t) => placed.get(t.root.seq).where === "key" && t.root.key === addr);
      // A Decision renders before the threads, so its options stay where the Page put them.
      const d = el.hasAttribute("atl-decide") ? st.decisions.find((x) => x.id === addr && x.declared) : undefined;
      if (d) {
        let dec = decUis.get(addr);
        if (!dec) { dec = h(`<span atl-ui="decide" class="atl-decide" role="group" aria-label="Decision on ${esc(addr)}"><span class="atl-dopts"></span><input class="atl-note" hidden aria-label="Note"><span class="atl-dstate"></span></span>`); decUis.set(addr, dec); }
        const slot = [...el.querySelectorAll("[atl-slot]")].find((s) => !isUi(s) && s.closest("[atl-decide]") === el);
        if (slot) { if (dec.parentElement !== slot) slot.append(dec); } else place(dec, el);
        set(dec.firstElementChild, declaredHtml(d, st));
        set(dec.lastElementChild, receiptHtml(d, st));
        dec.classList.toggle("atl-open-item", !d.answer || d.stale);
        kept.add(dec);
      }
      place(ui, el);
      // The Comment button floats at the element's top-right, takes no layout space, and shows on hover or focus;
      // with threads it stays as a count. A Key that only marks a Decision's slot gets none.
      if (!el.hasAttribute("atl-slot")) {
        let pin = pins.get(addr);
        if (!pin) { pin = h(`<span atl-ui="pin" class="atl-pin" data-key="${esc(addr)}"></span>`); pins.set(addr, pin); }
        place(pin, el);
        set(pin, `<button data-atl="comment" data-key="${esc(addr)}" class="atl-add" aria-label="Comment on ${esc(addr)}${threadsHere.length ? ` (${threadsHere.length} threads)` : ""}" title="Comment on ${esc(addr)}">${icon("comment")}${threadsHere.length ? `<span>${threadsHere.length}</span>` : ""}</button>`);
        pin.classList.toggle("atl-has", threadsHere.length > 0);
        kept.add(pin);
      }
      const groupDrafts = el.hasAttribute("atl-group") ? st.drafts.filter((x) => inGroup(x.key, addr)).length : 0;
      set(ui.firstElementChild, groupDrafts ? `<button data-atl="send" data-key="${esc(addr)}" class="atl-primary">${icon("send")} Send (${groupDrafts})</button>` : "");
      reconcile(ui.children[1], [
        ...st.decisions.filter((x) => !x.declared && x.key === addr).map((x) => ({ id: `d:${x.id}`, html: decisionHtml(x, st), open: !x.answer || x.stale, extra: `<input class="atl-note" placeholder="Optional note with your answer" aria-label="Note">` })),
        ...threadsHere.map((t) => ({ id: `t:${t.root.seq}`, html: threadHtml(t, st), open: !t.closed && st.status(t.root) !== "draft" })),
      ]);
    }
    for (const map of [pins, decUis]) for (const [addr, node] of map) if (!kept.has(node)) { node.remove(); map.delete(addr); }
    for (const [addr, ui] of keyUis) {
      if (seen.has(addr)) continue;
      if (composer && ui.contains(composer.node)) panel.querySelector(".atl-slot").append(composer.node); // an Update removed its Key: keep the text
      ui.remove(); keyUis.delete(addr);
    }

    // Decisions with no Key on the Page sit in the reading path, capped at 50vh (Review Studio a41040901).
    reconcile(orphans, st.decisions.filter((d) => !d.declared && !findKey(d.key)).map((d) => ({ id: `d:${d.id}`, html: decisionHtml(d, st), open: !d.answer || d.stale, extra: `<input class="atl-note" placeholder="Optional note with your answer" aria-label="Note">` })));

    const onText = st.threads.filter((t) => placed.get(t.root.seq).where === "text");
    const unanchored = st.threads.filter((t) => placed.get(t.root.seq).where === "unanchored");
    const undoable = all().filter((e) => e.origin === "human" && e.type !== "undo" && left(e) > 0 && !all().some((u) => u.type === "undo" && u.target === e.seq));
    const notDelivered = all().filter((e) => ["local", "unconfirmed"].includes(st.status(e)));
    const open = st.openThreads.length + st.toAnswer.length;
    set(panel.querySelector(".atl-bar"), `<button data-atl="next" ${open ? "" : "disabled"}>${open} open${open ? " · next ↓" : ""}</button>${st.toAnswer.length ? `<span class="atl-tag">${st.toAnswer.length} to answer</span>` : ""}<button data-atl="send" class="atl-primary" ${st.drafts.length ? "" : "disabled"}>${icon("send")} Send (${st.drafts.length})</button><button data-atl="selcomment" aria-label="Comment on the selected text" title="Select text on the Page, then comment on it">${icon("comment-plus")}</button><span class="atl-dim atl-conn">${esc(conn)}</span>`);
    renderUndo(undoable);
    const section = (title, items) => items.length ? `<h4>${title}</h4>` : "";
    const list = panel.querySelector(".atl-list");
    if (!list.firstChild) list.append(h(`<div><div class="atl-h-copy"></div><div class="atl-h-req"></div><div class="atl-req"></div><div class="atl-h-text"></div><div class="atl-text"></div><div class="atl-h-un"></div><div class="atl-un"></div></div>`));
    set(list.querySelector(".atl-h-copy"), notDelivered.length ? `<p class="atl-warn">${icon("alert")} ${notDelivered.length} not delivered to a session. <button data-atl="copy">Copy</button></p>` : "");
    set(list.querySelector(".atl-h-req"), section("Requests", st.requests));
    reconcile(list.querySelector(".atl-req"), st.requests.map((r) => ({ id: `r:${r.req.seq}`, html: requestHtml(r, st) })));
    set(list.querySelector(".atl-h-text"), section("On the text", onText));
    reconcile(list.querySelector(".atl-text"), onText.map((t) => ({ id: `t:${t.root.seq}`, html: threadHtml(t, st), open: !t.closed })));
    set(list.querySelector(".atl-h-un"), section(`Unanchored (${unanchored.length})`, unanchored));
    reconcile(list.querySelector(".atl-un"), unanchored.map((t) => ({ id: `t:${t.root.seq}`, html: threadHtml(t, st), open: !t.closed })));

    if (globalThis.Highlight && CSS.highlights) {
      const ranges = st.threads.filter((t) => !t.closed && t.root.quote).map((t) => findQuote(t.root.quote, idx)).filter(Boolean);
      CSS.highlights.set("atl-quote", new Highlight(...ranges));
    }
    // html-plan: a closed parent shows how many decisions wait inside it.
    document.querySelectorAll("[atl-ui=badge]").forEach((b) => b.remove());
    for (const d of document.querySelectorAll("details:not([open])")) {
      if (isUi(d)) continue;
      const n = d.querySelectorAll(".atl-open-item").length;
      if (n) d.querySelector("summary")?.append(h(`<span atl-ui="badge" class="atl-tag">${n} open</span>`));
    }
    positionPins();
  }

  // ---- the floating Comment button: only the innermost hovered or focused Key shows it (no stacked duplicates)
  function pinAt(pin) {
    const el = findKey(pin.dataset.key), b = pin.firstElementChild;
    if (!el || !b) return;
    pin.style.translate = "";
    const p = pin.getBoundingClientRect(), r = el.getBoundingClientRect();
    pin.style.translate = `${Math.round(r.right - p.left - b.offsetWidth - 4)}px ${Math.round(r.top - p.top + 4)}px`;
  }
  function positionPins() { for (const pin of pins.values()) if (pin.matches(".atl-has,.atl-hot,:focus-within")) pinAt(pin); }
  function setHot(target) {
    const el = target?.closest?.("[atl-key]:not([atl-slot])");
    const addr = el && !isUi(el) ? keyOf(el) : null;
    if (addr === hot) return;
    pins.get(hot)?.classList.remove("atl-hot");
    hot = addr;
    const pin = pins.get(addr);
    if (pin) { pin.classList.add("atl-hot"); pinAt(pin); }
  }
  document.addEventListener("pointerover", (ev) => { if (!isUi(ev.target)) setHot(ev.target); });
  document.documentElement.addEventListener("pointerleave", () => setHot(null));
  document.addEventListener("focusin", (ev) => { const pin = ev.target.closest?.("[atl-ui=pin]"); if (pin) pinAt(pin); else if (!isUi(ev.target)) setHot(ev.target); });
  addEventListener("resize", positionPins);
  new ResizeObserver(() => positionPins()).observe(document.body);

  // ---- the floating selection button: a Comment on the selected Page text (the bar button is the keyboard path)
  function pageRange() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || document.activeElement?.matches("input,textarea")) return null;
    const r = sel.getRangeAt(0), node = r.commonAncestorContainer, el = node.nodeType === 1 ? node : node.parentElement;
    return el && document.body.contains(el) && !isUi(el) && r.toString().trim() ? r : null;
  }
  function placeSel() {
    const r = pageRange();
    if (r) savedRange = r.cloneRange();
    selBtn.hidden = !r;
    if (!r) return;
    const rects = r.getClientRects(), last = rects[rects.length - 1] ?? r.getBoundingClientRect();
    selBtn.style.left = `${Math.max(4, Math.min(innerWidth - selBtn.offsetWidth - 4, last.right + 4))}px`;
    selBtn.style.top = `${Math.max(4, Math.min(innerHeight - selBtn.offsetHeight - 4, last.bottom + 6))}px`;
  }
  let selQueued = false;
  document.addEventListener("selectionchange", () => { if (!selQueued) { selQueued = true; requestAnimationFrame(() => { selQueued = false; placeSel(); }); } });
  addEventListener("scroll", () => { if (!selBtn.hidden) placeSel(); }, { capture: true, passive: true });

  function renderUndo(undoable) {
    // Decision 129: every interaction can be undone for 10 seconds, with a visible countdown.
    const label = (e) => ({ comment: "Comment saved", decide: e.previous != null ? `Changed ${e.previous} → ${e.option}` : `Chose ${e.option}`, request: `Requested ${e.job}`, send: "Comments sent", close: "Closed", still: "Marked still applies", opened: "Material opened", cancel: "Cancel requested", accept: "Accepted", rework: "Rework requested" })[e.type] ?? e.type;
    set(panel.querySelector(".atl-undo"), undoable.map((e) => `<div class="atl-toast">${esc(label(e))} <button data-atl="undo" data-seq="${e.seq}">${icon("undo")} Undo (${left(e)} s)</button></div>`).join(""));
  }
  setInterval(() => { if (panel.querySelector(".atl-toast") || panel.innerHTML.includes("sends in")) render(); }, 1000);

  // ---- composer: one per slot, persistent while open so typing survives every render and morph
  function openComposer(spec, slot) {
    composer?.node.remove();
    const node = h(`<form atl-ui="composer" class="atl-composer"><div class="atl-label">${esc(spec.label)}</div><textarea required rows="3" aria-label="${esc(spec.label)}"></textarea><div class="atl-actions"><button type="submit" class="atl-primary">${icon("check")} Save</button><button type="button" data-atl="dismiss">${icon("x")} Cancel</button></div></form>`);
    composer = { spec, node };
    slot.append(node);
    node.querySelector("textarea").focus();
    node.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const text = node.querySelector("textarea").value.trim();
      if (!text) return;
      composer = null; node.remove();
      await post(spec.kind === "rework" ? { type: "rework", target: spec.target, note: text } : { type: "comment", ...spec.anchor, text });
    });
  }
  const slotFor = (addr) => (addr && keyUis.get(addr)?.querySelector(".atl-slot")) || panel.querySelector(".atl-slot");
  const mediaTime = (el) => { const m = el?.querySelector("video,audio"); return m ? Math.round(m.currentTime * 10) / 10 : undefined; };
  function anchorForKey(addr) { const el = findKey(addr); return { key: addr, ver: verOf(el), t: mediaTime(el) }; }

  function jumpTo(el) {
    if (!el) return;
    for (let d = el.closest("details:not([open])"); d; d = d.parentElement?.closest("details:not([open])")) d.open = true; // reveal hidden Keys
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("atl-flash"); setTimeout(() => el.classList.remove("atl-flash"), 1200);
    if (el.tabIndex >= -1 && el.focus) el.focus({ preventScroll: true });
  }
  function markRead(seq) { const st = state(); const t = st.threads.find((x) => x.root.seq === seq); if (t) { read[seq] = Math.max(...t.msgs.map((m) => m.seq)); localStorage.setItem(readKey, JSON.stringify(read)); } }

  const actions = {
    comment: (b) => openComposer({ label: `Comment on ${b.dataset.key}`, anchor: anchorForKey(b.dataset.key) }, slotFor(b.dataset.key)),
    reply: (b) => { const seq = +b.dataset.seq; const root = all().find((e) => e.seq === seq); markRead(seq); openComposer({ label: `Reply in thread #${seq}`, anchor: { thread: seq, key: root?.key, ver: root?.key ? currentVer(root.key) : undefined } }, b.closest("[atl-ui=key]")?.querySelector(".atl-slot") ?? panel.querySelector(".atl-slot")); },
    close: (b) => { const root = all().find((e) => e.seq === +b.dataset.seq); post({ type: "close", target: +b.dataset.seq, ver: root?.key ? currentVer(root.key) : undefined }); },
    still: (b) => { const root = all().find((e) => e.seq === +b.dataset.seq); post({ type: "still", target: +b.dataset.seq, ver: root?.key ? currentVer(root.key) : null }); },
    jump: (b) => { const t = state().threads.find((x) => x.root.seq === +b.dataset.seq); const p = t && placeThread(t, textIndex()); markRead(+b.dataset.seq); if (p?.range) { p.range.startContainer.parentElement.scrollIntoView({ block: "center", behavior: "smooth" }); } else jumpTo(p?.el); },
    decide: (b) => {
      const d = state().decisions.find((x) => x.id === b.dataset.id);
      if (!d) return;
      const label = b.dataset.label, note = b.closest(".atl-card,[atl-ui=decide]")?.querySelector(".atl-note"), text = note?.value.trim();
      if (d.answer?.option === label && !d.stale && !text) return; // already the answer
      // atl-note: these options need a reason; the Kernel asks for it and posts nothing without it.
      if (d.note?.includes(label) && !text) {
        Object.assign(note, { hidden: false, placeholder: `Why ${label}? (required)` });
        note.dataset.pending = label; note.setAttribute("aria-invalid", "true"); note.focus();
        flash(`${label} needs a note.`);
        return;
      }
      // Always editable (133): a change is a new answer that names the one it replaces.
      const previous = d.answer && d.answer.option !== label ? d.answer.option : undefined;
      const page = d.declared ? { options: d.options.map((o) => o.label).join("|"), rec: d.options.find((o) => o.recommended)?.label, delivery: d.delivery } : {};
      post({ type: "decide", decision: d.id, option: label, previous, opened: d.material ? d.opened : null, note: text || undefined, key: d.key, ver: d.key ? currentVer(d.key) : undefined, ...page });
      if (note) { note.value = ""; note.removeAttribute("aria-invalid"); delete note.dataset.pending; if (d.declared) note.hidden = true; }
    },
    material: (b) => { const d = state().decisions.find((x) => x.id === b.dataset.id); jumpTo(findKey(d?.material)); if (d && !d.opened) markOpened(d); },
    send: (b) => post({ type: "send", key: b.dataset.key || undefined }),
    undo: (b) => post({ type: "undo", target: +b.dataset.seq }),
    cancel: (b) => post({ type: "cancel", target: +b.dataset.seq }),
    accept: (b) => post({ type: "accept", target: +b.dataset.seq }),
    rework: (b) => openComposer({ label: `What should change in Request #${b.dataset.seq}?`, kind: "rework", target: +b.dataset.seq }, panel.querySelector(".atl-slot")),
    expand: (b) => { expanded.add(+b.dataset.seq); render(); },
    dismiss: () => { composer?.node.remove(); composer = null; },
    next: () => {
      const items = [...document.querySelectorAll(".atl-open-item")];
      if (!items.length) return;
      jumpTo(items[nextIndex++ % items.length]);
    },
    selcomment: () => {
      const r = pageRange() ?? savedRange, idx = textIndex();
      selBtn.hidden = true; savedRange = null;
      if (!r) { flash("Select text on the Page first."); return; }
      const start = offsetOf(idx, r.startContainer, r.startOffset), end = offsetOf(idx, r.endContainer, r.endOffset);
      const exact = idx.text.slice(start, end).trim();
      if (start < 0 || !exact) { flash("Select text on the Page first."); return; }
      const key = keyOf(r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement);
      const anchor = { quote: { exact: exact.slice(0, 500), prefix: idx.text.slice(Math.max(0, start - 32), start), suffix: idx.text.slice(end, end + 32) }, ...(key ? anchorForKey(key) : {}) };
      openComposer({ label: `Comment on “${exact.slice(0, 60)}”`, anchor }, slotFor(key));
    },
    copy: async () => {
      const st = state();
      const events = all().filter((e) => ["local", "unconfirmed"].includes(st.status(e)));
      const text = compose(page, location.href, events, all(), { excerpt: (k) => { const el = findKey(k); return el && keyText(el); } });
      try { await navigator.clipboard.writeText(text); flash("Copied. Paste it into the Pi session."); } catch { prompt("Copy this into the Pi session:", text); }
    },
  };

  document.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-atl]");
    if (b && isUi(b)) { ev.preventDefault(); actions[b.dataset.atl]?.(b); return; }
    const req = ev.target.closest?.("[atl-request]:not(form)");
    if (req && !isUi(req)) { ev.preventDefault(); post({ type: "request", job: req.getAttribute("atl-request"), key: keyOf(req), ver: verOf(req), input: {} }); return; }
    // Alt+click comments on the nearest Key, or on a verified selector where there is none.
    if (ev.altKey && !isUi(ev.target)) {
      ev.preventDefault();
      const key = keyOf(ev.target);
      if (key) actions.comment({ dataset: { key } });
      else openComposer({ label: `Comment on ${ev.target.localName}`, anchor: { selector: { sel: selectorFor(ev.target), snap: ev.target.textContent.trim().slice(0, 80) } } }, panel.querySelector(".atl-slot"));
    }
  });
  document.addEventListener("submit", (ev) => {
    const form = ev.target.closest?.("form[atl-request]");
    if (!form || isUi(form)) return;
    ev.preventDefault();
    post({ type: "request", job: form.getAttribute("atl-request"), key: keyOf(form), ver: verOf(form), input: Object.fromEntries(new FormData(form)) });
  });
  document.addEventListener("input", (ev) => { if (!isUi(ev.target)) touched.add(ev.target); }, true);
  // Enter in a required note posts the option that asked for it.
  document.addEventListener("keydown", (ev) => {
    const note = ev.target.closest?.("[atl-ui=decide] .atl-note[data-pending]");
    if (!note || ev.key !== "Enter") return;
    ev.preventDefault();
    const b = [...note.parentElement.querySelectorAll("[data-atl=decide]")].find((x) => x.dataset.label === note.dataset.pending);
    if (b) actions.decide(b);
  });
  // Decision 113: only the human's own click or key on the material counts as opened (expanding and playing start
  // with one). toggle and play also fire for the Page's own <details open>, Updates and autoplay, so they never count.
  const opening = new Set(); // one POST in flight per Decision; after it, the log says whether it is opened
  function markOpened(d) {
    if (opening.has(d.id)) return;
    opening.add(d.id);
    post({ type: "opened", decision: d.id }).finally(() => opening.delete(d.id));
  }
  const opened = (ev) => {
    if (!ev.isTrusted || isUi(ev.target) || (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ")) return;
    for (const d of state().decisions) if (!d.answer && !d.opened && d.material && findKey(d.material)?.contains(ev.target)) markOpened(d);
  };
  document.addEventListener("pointerdown", opened, true);
  document.addEventListener("keydown", opened, true);

  function flash(text) { const n = h(`<div class="atl-toast" role="status">${esc(text)}</div>`); panel.querySelector(".atl-undo").before(n); setTimeout(() => n.remove(), 4000); }

  // Pages render keyed rows from their data files after load (130); draw their Kernel UI once the page settles.
  let queued = false;
  new MutationObserver((records) => {
    const pageChange = records.some((r) => !isUi(r.target) && [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1 && !n.hasAttribute("atl-ui")));
    if (pageChange && !queued) { queued = true; requestAnimationFrame(() => { queued = false; render(); }); }
  }).observe(document.body, { childList: true, subtree: true });

  render();
  if (online) { connect(); pull(); }
}

// Every control is styled from the --atl-* palette, never from system colours, so the Kernel matches the Page.
const STYLE = `
[atl-ui]{font:13px/1.4 system-ui,sans-serif;color:var(--atl-fg)}
[atl-ui][hidden],[atl-ui] [hidden]{display:none!important}
[atl-ui=panel]{position:fixed;right:12px;bottom:12px;z-index:2147483000;width:340px;max-height:70vh;overflow:auto;background:var(--atl-bg);border:1px solid var(--atl-line);border-radius:10px;padding:8px;box-shadow:0 4px 18px #0002}
[atl-ui=orphans]:not(:empty){max-height:50vh;overflow:auto;margin:8px;display:grid;gap:8px}
[atl-ui=key]{margin:4px 0}[atl-ui=key]:not(:has(.atl-card,form,button)){display:none}.atl-khead:empty,.atl-kbody:empty{display:none}
.atl-i{width:14px;height:14px;flex:none}
[atl-ui] button,button[atl-ui]{font:inherit;line-height:1.2;display:inline-flex;align-items:center;gap:5px;box-sizing:border-box;min-height:28px;padding:0 10px;border:1px solid var(--atl-line);border-radius:6px;background:var(--atl-bg);color:var(--atl-fg);cursor:pointer}
[atl-ui] button:hover:not(:disabled),button[atl-ui]:hover{border-color:var(--atl-muted)}
[atl-ui] button.atl-primary:not(:disabled){background:var(--atl-accent);border-color:var(--atl-accent);color:#fff}
[atl-ui] button:disabled{opacity:.5;cursor:default}
[atl-ui] :focus-visible,[atl-ui]:focus-visible{outline:2px solid var(--atl-accent);outline-offset:1px}
[atl-ui] textarea,[atl-ui] input{font:inherit;color:var(--atl-fg);background:var(--atl-bg);border:1px solid var(--atl-line);border-radius:8px;padding:7px 9px;box-sizing:border-box;width:100%;margin:0}
[atl-ui] textarea{display:block;min-height:76px;resize:vertical}
[atl-ui] textarea:focus,[atl-ui] input:focus{outline:none;border-color:var(--atl-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--atl-accent) 22%,transparent)}
[atl-ui] [aria-invalid=true]{border-color:var(--atl-warn)}
[atl-ui] ::placeholder{color:var(--atl-muted);opacity:1}
.atl-bar,.atl-khead,.atl-actions,.atl-head{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.atl-card{border:1px solid var(--atl-line);border-radius:8px;padding:8px 10px;margin:6px 0;background:var(--atl-bg);display:grid;gap:6px}
.atl-card.atl-open-item{border-left:3px solid var(--atl-accent)}
.atl-opts{display:grid;gap:4px}[atl-ui] button.atl-opt{display:grid;justify-items:start;text-align:left;padding:4px 10px}
[atl-ui] button.atl-rec{border-color:var(--atl-accent);border-style:dashed}
[atl-ui] button.atl-chosen{background:var(--atl-accent);border-color:var(--atl-accent);border-style:solid;color:#fff}
[atl-ui] button.atl-chosen .atl-dim{color:inherit}
.atl-decide{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center;margin:2px 0}.atl-decide .atl-note{width:auto;flex:1 1 14em}.atl-dstate:empty{display:none}
.atl-pin{position:absolute;width:0;height:0;z-index:2147482000}
.atl-pin .atl-add{position:absolute;left:0;top:0;min-height:0;height:24px;padding:0 5px;gap:3px;color:var(--atl-muted);box-shadow:0 1px 3px #0002;opacity:0;pointer-events:none;transition:opacity .12s}
.atl-pin.atl-hot .atl-add,.atl-pin.atl-has .atl-add,.atl-pin .atl-add:focus-visible{opacity:1!important;pointer-events:auto!important}
.atl-pin.atl-has .atl-add,.atl-pin .atl-add:hover{color:var(--atl-accent)}
.atl-selbtn{position:fixed;z-index:2147483001;box-shadow:0 2px 8px #0003}
.atl-tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;border:1px solid var(--atl-line);border-radius:9px;padding:0 6px;color:var(--atl-muted)}
.atl-warn,.atl-tag.atl-warn{color:var(--atl-warn)}.atl-tag.atl-new{background:var(--atl-accent);border-color:var(--atl-accent);color:#fff}
.atl-dim,.atl-label{color:var(--atl-muted);font-size:12px}
.atl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.atl-msg{border:1px solid var(--atl-line);border-radius:6px;padding:5px 8px;background:var(--atl-bg)}.atl-msg>div:last-child{white-space:pre-wrap;overflow-wrap:anywhere}
.atl-agent{background:color-mix(in srgb,var(--atl-accent) 7%,var(--atl-bg));border-color:color-mix(in srgb,var(--atl-accent) 28%,var(--atl-line))}.atl-agent .atl-who b{color:var(--atl-accent)}.atl-who{font-size:12px}
[atl-ui] button.atl-earlier{justify-self:start;min-height:22px;font-size:12px;color:var(--atl-muted);border-style:dashed}
.atl-quote{font-style:italic;border-left:3px solid var(--atl-warn);padding-left:6px}
.atl-toast{display:flex;gap:6px;align-items:center;justify-content:space-between;padding:2px 0}
.atl-composer{display:grid;gap:6px;margin:6px 0}
.atl-flash{outline:3px solid var(--atl-accent);outline-offset:2px}
::highlight(atl-quote){background:#fde68a;color:#000}
[atl-ui] h4{margin:8px 0 2px;font-size:12px}
`;

if (typeof document !== "undefined" && !globalThis.__atelierKernel) {
  globalThis.__atelierKernel = true;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
}
