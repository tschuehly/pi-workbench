#!/usr/bin/env node
// Page check: catches a broken Page. `open` and `update` run it; from a shell, in the project directory:
//   node extensions/atelier/check-page.mjs <page.html>     (exit 1 on a FAIL; 0 on pass, WARN only, or unchecked)
// It serves a test copy beside the Page (<name>.atelier-check-<id>.html, created exclusively for this run, with its own
// Event Log; only those files are ever deleted) through the real host with the real project root, loads it in
// agent-browser at 1512×900 and opens the view of every [aria-controls] control once, nested ones by their click path.
// The Page's real Event Log is never read or touched.
// FAIL (measured; must be fixed):
// - Kernel version in the page equals the host's; Page state: the Kernel read its Event Log.
// - Kernel layout: hiding the Kernel's own <body> children must not move the Page's first-level boxes (a <body> grid
//   gives them grid cells; display:contents wrappers count as their children).
// - Per view: console and page errors; horizontal overflow (and the element reaching furthest right). Errors of a click
//   that shows no view fail as well ("Errors without a view").
// The Kernel controls probe below rewrites Page selectors; it runs after a view's measured checks and leaves the Page as
// it found it (same specificity, no transitions), so it never changes what a FAIL measures.
// WARN (heuristic; never changes the exit code; names the screenshots to inspect):
// - HTML balance: unclosed or stray end tags in the source (hidden views leak below the visible one).
// - Kernel controls: Page CSS that changes a Kernel control's box, sizing or visibility (`aside button` also hits the
//   Kernel panel, itself an <aside>); a Page onclick on a Kernel control.
// - Per view: text drawn over visible other text.
// One full-page screenshot per view in $PI_TMP. The returned result is capped; full values are only in report.json
// beside the screenshots. A missing or failing agent-browser, a cancel or the deadline leaves the browser checks
// "unchecked" (what was measured before stays); it never fails open or update. The check's agent-browser daemon and
// browser are its own (own socket directory) and are stopped when it ends, by force if close does not finish.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { KERNEL_VERSION, createHost, imagesDir, logPath } from "./host.ts";

const WIDTH = 1512, HEIGHT = 900;
const DEADLINE_MS = 120_000;
const MAX_VIEWS = 40;
const TEXT_MAX = 6_000; // characters of formatCheck output
const PAYLOAD_MAX = 24_000; // characters of the returned result as JSON
const BALANCE_MS = 500; // ponytail: a time budget instead of a streaming parser; a source too large for it gets a partial WARN
const KERNEL_SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "kernel", "atelier.js"), "utf8");
const sha = (b) => createHash("sha256").update(b).digest("hex");
// Control characters and lone surrogates become spaces and U+FFFD, so JSON escaping at most doubles a clipped string.
const clip = (s, n = 200) => { s = String(s).replace(/[\u0000-\u001f]/g, " ").toWellFormed(); return s.length > n ? `${s.slice(0, n)}… (${s.length} chars)` : s; };

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
// End tags HTML lets an author omit; not counting them avoids flagging valid Pages.
const OPTIONAL = new Set("html head body p li dt dd option optgroup tr td th thead tbody tfoot colgroup caption rb rt rp rtc".split(" "));
// Raw text and RCDATA elements: their content is text up to the matching end tag.
const RAW = new Set("script style textarea title xmp iframe noembed noframes noscript plaintext".split(" "));
// Inside <svg> or <math>, these hold HTML again.
const INTEGRATION = new Set("foreignobject desc title mi mo mn ms mtext annotation-xml".split(" "));

/**
 * Unclosed and stray end tags in Page source, a heuristic (no script escape states): comments only in markup, raw text
 * (script, style, textarea, title, …) up to its end tag, `/>` and CDATA only in SVG and MathML. Reads each character a
 * bounded number of times (no backtracking); stops after budgetMs with `partial: true`.
 */
export function tagBalance(html, budgetMs = BALANCE_MS) {
  const stack = [], inside = [], unclosed = [], stray = [], open = new Map(); // inside[k]: stack[k]'s children are SVG/MathML
  const until = Date.now() + budgetMs;
  let line = 1, counted = 0, partial = false;
  const lineAt = (i) => { for (; counted < i; counted += 1) if (html.charCodeAt(counted) === 10) line += 1; return line; };
  const foreign = () => inside.at(-1) ?? false;
  const push = (name, at) => {
    inside.push(name === "svg" || name === "math" || (!INTEGRATION.has(name) && foreign()));
    stack.push({ name, line: at });
    open.set(name, (open.get(name) ?? 0) + 1);
  };
  const skipTo = (from, re) => { re.lastIndex = from; const m = re.exec(html); return m ? m.index + m[0].length : html.length; };
  const find = (re, from) => { re.lastIndex = from; return re.exec(html)?.index ?? html.length; }; // where re next matches
  for (let i = html.indexOf("<"); i >= 0 && i < html.length; i = html.indexOf("<", i)) {
    if (Date.now() > until) { partial = true; break; }
    if (html.startsWith("<!--", i)) { const abrupt = /^-?>/.exec(html.slice(i + 4, i + 6)); i = abrupt ? i + 4 + abrupt[0].length : skipTo(i + 4, /--!?>/g); continue; }
    if (html.startsWith("<![CDATA[", i) && foreign()) { i = skipTo(i + 9, /]]>/g); continue; }
    if (html[i + 1] === "!" || html[i + 1] === "?" || (html[i + 1] === "/" && !/[a-zA-Z]/.test(html[i + 2] ?? ""))) { i = skipTo(i + 1, />/g); continue; } // doctype, bogus comment
    // A tag as the HTML tokenizer reads it: the name runs to whitespace, `/` or `>`; a quote opens a value only after
    // `=`. A tag the source ends inside is no tag, and nothing follows it.
    const end = html[i + 1] === "/", from = i + (end ? 2 : 1);
    if (!/[a-zA-Z]/.test(html[from] ?? "")) { i += 1; continue; }
    let j = find(/[\s/>]/g, from);
    const name = html.slice(from, j).toLowerCase(), attrsAt = j;
    while ((j = find(/[>=]/g, j)) < html.length && html[j] === "=") {
      j = find(/\S/g, j + 1);
      if (html[j] === '"' || html[j] === "'") { const q = html.indexOf(html[j], j + 1); j = q < 0 ? html.length : q + 1; }
    }
    if (j >= html.length) break;
    const attrs = html.slice(attrsAt, j), at = lineAt(i);
    i = j + 1;
    if (end) {
      if (VOID.has(name) || OPTIONAL.has(name)) continue;
      if (!open.get(name)) { stray.push({ name, line: at }); continue; }
      const k = stack.findLastIndex((o) => o.name === name); // scans only what it then pops
      const gone = stack.splice(k);
      inside.length = k;
      gone.forEach((o, j) => { open.set(o.name, open.get(o.name) - 1); if (j) unclosed.push(o); });
      continue;
    }
    const inForeign = foreign();
    if ((inForeign || name === "svg" || name === "math") && attrs.trimEnd().endsWith("/")) continue; // self-closed
    if (!inForeign && (VOID.has(name) || OPTIONAL.has(name))) continue;
    push(name, at);
    if (!inForeign && RAW.has(name)) {
      const close = new RegExp(`</${name}[\\s/>]`, "ig");
      close.lastIndex = i;
      const e = name === "plaintext" ? null : close.exec(html);
      if (!e) break;
      i = e.index; // the end tag closes it on the next turn
    }
  }
  return { unclosed: unclosed.concat(stack).sort((a, b) => a.line - b.line), stray, ...(partial && { partial }) };
}

// --- Browser side: these functions run in the Page via eval; each gets `d`, which names an element briefly. ---

function describe(el) {
  if (!el) return "?";
  const cut = (s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
  const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${cut(c)}`).join("") : "";
  const key = el.getAttribute("atl-key") ? `[atl-key=${cut(el.getAttribute("atl-key"))}]` : "";
  return `${el.tagName.toLowerCase()}${el.id ? `#${cut(el.id)}` : ""}${cls}${key}`;
}

function kernelOnce(d) {
  const s = window.atelier?.state() ?? { loaded: false, decisions: [] };
  // Kernel layout: the Page's first-level boxes with and without the Kernel's <body> children taking part in layout. A
  // display:contents element has no box; its children are laid out in its place.
  const own = [...document.body.children].filter((el) => el.hasAttribute("atl-ui"));
  const boxed = (els) => els.flatMap((el) => (getComputedStyle(el).display === "contents" ? boxed([...el.children]) : [el]));
  const pageKids = boxed([...document.body.children]).filter((el) => !el.hasAttribute("atl-ui") && !["SCRIPT", "STYLE", "TEMPLATE", "LINK"].includes(el.tagName));
  const boxes = () => pageKids.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x + scrollX), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)]; });
  const withKernel = boxes();
  const saved = own.map((el) => el.style.getPropertyValue("display"));
  own.forEach((el) => el.style.setProperty("display", "none", "important"));
  const without = boxes();
  own.forEach((el, i) => saved[i] ? el.style.setProperty("display", saved[i]) : el.style.removeProperty("display"));
  const moved = pageKids.flatMap((el, i) => withKernel[i].some((v, j) => Math.abs(v - without[i][j]) > 1)
    ? [`${d(el)} ${without[i].slice(0, 2).join(",")} ${without[i][2]}×${without[i][3]} → ${withKernel[i].slice(0, 2).join(",")} ${withKernel[i][2]}×${withKernel[i][3]}`] : []);
  return {
    loaded: s.loaded, decisions: s.decisions.length,
    kernelSrc: [...document.scripts].find((sc) => /(^|\/)atelier\.js(\?|#|$)/.test(sc.src))?.src ?? null,
    moved: moved.slice(0, 3), kernelElements: own.slice(0, 5).map(d),
  };
}

// Kernel controls: scope every Page rule that matches a Kernel element away from the Kernel, and see which control
// properties change that such a rule declares on the control or on its Kernel ancestors (panel, Decision group).
// Page rules on Page ancestors stay, so a hidden Page panel or a Page layout never counts.
function kernelControls(d) {
  const PROPS = ["display", "position", "float", "text-align", "justify-content", "flex-direction", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-bottom-width",
    "visibility", "opacity", "transform", "width", "height", "min-width", "max-width", "min-height", "max-height"];
  const controls = [...document.querySelectorAll("[atl-ui] button, [atl-ui] input, [atl-ui] select, [atl-ui] textarea, [atl-ui] a, button[atl-ui]")];
  const rules = []; // [rule, Kernel elements it matches]
  const walk = (list) => {
    for (const r of list) {
      if (r.selectorText) {
        try { const hit = [...document.querySelectorAll(r.selectorText)].filter((el) => el.closest("[atl-ui]")); if (hit.length) rules.push([r, new Set(hit)]); } catch { /* selector the engine rejects */ }
      }
      if (r.cssRules?.length) walk(r.cssRules);
    }
  };
  for (const sh of document.styleSheets) { if (sh.disabled || sh.ownerNode?.closest?.("[atl-ui]")) continue; try { walk(sh.cssRules); } catch { /* cross-origin sheet */ } }
  const read = () => controls.map((el) => { const c = getComputedStyle(el); return PROPS.map((p) => c.getPropertyValue(p)); });
  // The probe must leave the Page as it found it. Each item of a selector list gets `:where(:not(Kernel))`, which keeps
  // its specificity, so the cascade for Page elements does not change; transitions are off while selectors change and
  // until the restored styles are computed, so none starts.
  const items = (sel) => { // top-level items of a selector list: commas outside (), [] and strings
    const out = [];
    let depth = 0, quote = "", from = 0;
    for (let i = 0; i < sel.length; i += 1) {
      const c = sel[i];
      if (c === "\\") i += 1;
      else if (quote) { if (c === quote) quote = ""; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === "(" || c === "[") depth += 1;
      else if (c === ")" || c === "]") depth -= 1;
      else if (c === "," && !depth) { out.push(sel.slice(from, i)); from = i + 1; }
    }
    return [...out, sel.slice(from)];
  };
  const still = new CSSStyleSheet(), adopted = document.adoptedStyleSheets;
  still.replaceSync("*,*::before,*::after{transition:none!important}");
  document.adoptedStyleSheets = [...adopted, still];
  const saved = rules.map(([r]) => r.selectorText);
  let styled, plain;
  try {
    styled = read();
    rules.forEach(([r]) => { r.selectorText = items(r.selectorText).map((s) => `${s.trim()}:where(:not([atl-ui], [atl-ui] *))`).join(", "); });
    plain = read();
  } finally {
    rules.forEach(([r], i) => { r.selectorText = saved[i]; });
    read();
    document.adoptedStyleSheets = adopted;
  }
  const hits = [];
  controls.forEach((el, i) => {
    const chain = [];
    for (let e = el; e?.closest("[atl-ui]"); e = e.parentElement) chain.push(e);
    const mine = rules.filter(([, set]) => chain.some((e) => set.has(e)));
    const props = PROPS.filter((p, j) => styled[i][j] !== plain[i][j] && mine.some(([r]) => r.style.getPropertyValue(p) !== ""));
    if (props.length) hits.push({ el: d(el), props, selectors: mine.filter(([r]) => props.some((p) => r.style.getPropertyValue(p) !== "")).map(([r]) => r.selectorText) });
  });
  return {
    of: controls.length,
    hits: hits.slice(0, 20).map((h) => ({ ...h, selectors: h.selectors.slice(0, 5).map((s) => (s.length > 120 ? `${s.slice(0, 120)}…` : s)) })),
    count: hits.length,
    handlers: controls.filter((el) => el.onclick || el.hasAttribute("onclick")).slice(0, 5).map(d),
  };
}

// The [aria-controls] elements outside the Kernel that show now, whether what each controls shows, and whether another
// shown control has the same target (then an open target does not tell which control's view it holds).
function viewControls() {
  const all = [...document.querySelectorAll("[aria-controls]")].filter((el) => !el.closest("[atl-ui]"));
  const shown = all.filter((el) => el.checkVisibility({ visibilityProperty: true }));
  return shown.map((el) => {
    const controls = el.getAttribute("aria-controls"), ids = controls.split(/\s+/).filter(Boolean);
    return {
      controls, nth: all.filter((x) => x.getAttribute("aria-controls") === controls).indexOf(el),
      label: (el.textContent || el.getAttribute("aria-label") || "").slice(0, 200).replace(/\s+/g, " ").trim().slice(0, 50),
      shared: shown.some((x) => x !== el && x.getAttribute("aria-controls") === controls),
      open: ids.length > 0 && ids.every((id) => document.getElementById(id)?.checkVisibility({ visibilityProperty: true })),
    };
  });
}

function clickControl(_d, controls, nth) {
  const el = [...document.querySelectorAll("[aria-controls]")].filter((x) => !x.closest("[atl-ui]") && x.getAttribute("aria-controls") === controls)[nth];
  if (!el?.checkVisibility({ visibilityProperty: true })) return false;
  el.click();
  return true;
}

function viewMeasure(d) {
  const kernel = (el) => el.closest("[atl-ui]");
  const root = document.documentElement, vw = innerWidth, vh = innerHeight;
  let widest = null;
  if (root.scrollWidth > vw) {
    let best = vw + 1;
    for (const el of root.querySelectorAll("body *, html > [atl-ui], html > [atl-ui] *")) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right + scrollX <= best) continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body && p !== root; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") { clipped = true; break; }
      if (clipped) continue;
      best = r.right + scrollX; widest = `${d(el)} (right edge ${Math.round(best)}px)`;
    }
  }
  // Text over text: the rects of every visible text node, in page coordinates.
  const boxes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.data.trim() && n.parentElement && !kernel(n.parentElement) && !["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(n.parentElement.tagName) ? 1 : 2 });
  const range = document.createRange();
  // What of an element can show: overflow-clipping ancestors cut it (collapsed panels, scrollers).
  const clips = new Map();
  const clipOf = (el) => {
    if (!el || el === document.documentElement) return { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    if (clips.has(el)) return clips.get(el);
    const up = clipOf(el.parentElement), cs = getComputedStyle(el);
    let c = up;
    if (el !== document.body && (cs.overflowX !== "visible" || cs.overflowY !== "visible")) {
      const r = el.getBoundingClientRect();
      c = { left: Math.max(up.left, r.left), top: Math.max(up.top, r.top), right: Math.min(up.right, r.right), bottom: Math.min(up.bottom, r.bottom) };
    }
    clips.set(el, c);
    return c;
  };
  for (let n; (n = walker.nextNode());) {
    const el = n.parentElement, c = clipOf(el);
    // checkVisibility: false inside a closed <details>, display:none, visibility:hidden or opacity 0.
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      const left = Math.max(r.left, c.left), right = Math.min(r.right, c.right), top = Math.max(r.top, c.top), bottom = Math.min(r.bottom, c.bottom);
      if (right - left > 1 && bottom - top > 1) boxes.push({ n, el, top: top + scrollY, bottom: bottom + scrollY, left: left + scrollX, right: right + scrollX });
    }
  }
  boxes.sort((a, b) => a.top - b.top);
  const PAD = 2; // ignore touching boxes and line-height overlap
  const ids = new Map(), id = (el) => ids.get(el) ?? ids.set(el, ids.size).get(el);
  const candidates = [];
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length && boxes[j].top < a.bottom - PAD; j += 1) {
      const b = boxes[j];
      if (a.n === b.n) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w <= PAD || h <= PAD) continue;
      // Text of one element and its descendants shares lines; only a real overlap, not the next line's ascent, counts.
      const related = a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el);
      if (related && h <= Math.min(a.bottom - a.top, b.bottom - b.top) / 2) continue;
      candidates.push([a, b]);
    }
  }
  // Each candidate is hit-tested where its boxes meet (scrolled into view). Rotated or skewed text has only a bounding
  // box, so its element must be hit there (a rotated label's box corner is not its text); other text boxes are exact
  // (and text overflowing its element's box is never hit, so it is not asked). The lower text must not sit under an
  // opaque fixed or sticky layer the other is not in (content scrolled under a header).
  const hitEl = (el) => { while (el && getComputedStyle(el).display === "contents") el = el.parentElement; return el; };
  const turns = new Map();
  const turned = (el) => {
    if (!el || el === document.documentElement) return false;
    if (!turns.has(el)) {
      const c = getComputedStyle(el), m = /^matrix(3d)?\(([^)]*)\)/.exec(c.transform), v = m?.[2].split(",").map(Number) ?? [];
      const ctm = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
      turns.set(el, Math.abs(v[1] ?? 0) > 1e-6 || Math.abs(m?.[1] ? v[4] : v[2] ?? 0) > 1e-6 || (c.rotate !== "none" && parseFloat(c.rotate.split(" ").at(-1)) % 360 !== 0)
        || (!!ctm && (Math.abs(ctm.b) > 1e-6 || Math.abs(ctm.c) > 1e-6)) || turned(el.parentElement));
    }
    return turns.get(el);
  };
  // Paint order: the stack index of the element, or of its nearest ancestor there; not there at all is lowest.
  const order = (stack, el) => { const i = stack.findIndex((e) => e === el || e.contains(el)); return i < 0 ? stack.length : i; };
  const layers = new Map();
  const layer = (el) => {
    if (!el || el === document.documentElement) return null;
    if (!layers.has(el)) { const p = getComputedStyle(el).position; layers.set(el, p === "fixed" || p === "sticky" ? el : layer(el.parentElement)); }
    return layers.get(el);
  };
  const opaque = (el) => {
    const c = getComputedStyle(el), bg = c.backgroundColor;
    const alpha = /^rgba?\(/.test(bg) ? Number(bg.match(/[\d.]+/g)[3] ?? 1) : Number(/\/\s*([\d.]+)/.exec(bg)?.[1] ?? 1);
    return c.backgroundImage !== "none" || alpha >= 1;
  };
  const sheet = new CSSStyleSheet();
  sheet.replaceSync("*{pointer-events:visible!important}"); // hit-test text in pointer-events:none elements too
  const adopted = document.adoptedStyleSheets;
  document.adoptedStyleSheets = [...adopted, sheet];
  const x0 = scrollX, y0 = scrollY;
  const collides = (a, b) => {
    const cx = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2, cy = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
    if (cx < scrollX || cx > scrollX + vw || cy < scrollY || cy > scrollY + vh) scrollTo({ left: cx - vw / 2, top: cy - vh / 2, behavior: "instant" });
    const ea = hitEl(a.el), eb = hitEl(b.el), ta = turned(ea), tb = turned(eb);
    const rects = (n) => { range.selectNodeContents(n); return [...range.getClientRects()]; };
    for (const ra of rects(a.n)) for (const rb of rects(b.n)) {
      const l = Math.max(ra.left, rb.left, 0), r = Math.min(ra.right, rb.right, vw), t = Math.max(ra.top, rb.top, 0), btm = Math.min(ra.bottom, rb.bottom, vh);
      if (r - l <= PAD || btm - t <= PAD) continue;
      for (let i = 1; i <= 5; i += 1) for (let k = 1; k <= 3; k += 1) {
        const stack = document.elementsFromPoint(l + ((r - l) * i) / 6, t + ((btm - t) * k) / 4);
        if ((ta && !stack.includes(ea)) || (tb && !stack.includes(eb))) continue;
        const ia = order(stack, ea), ib = order(stack, eb), lower = ia > ib ? ea : eb;
        if (!stack.slice(0, Math.max(ia, ib)).some((e) => { const L = layer(e); return L && !L.contains(lower) && opaque(e); })) return true;
      }
    }
    return false;
  };
  const pairs = new Map();
  try {
    for (const [a, b] of candidates) {
      const key = `${id(a.el)}-${id(b.el)}`;
      if (pairs.has(key)) continue;
      if (collides(a, b)) pairs.set(key, `${d(a.el)} × ${d(b.el)} at ${Math.round(Math.max(a.left, b.left))},${Math.round(Math.max(a.top, b.top))}`);
      if (pairs.size >= 100) break; // ponytail: a Page this broken needs no exact count
    }
  } finally {
    document.adoptedStyleSheets = adopted;
    scrollTo({ left: x0, top: y0, behavior: "instant" });
  }
  if (root.scrollWidth > vw && !widest) { // text running out of its element's box
    const far = boxes.reduce((m, x) => (x.right > (m?.right ?? vw + 1) ? x : m), null);
    if (far) widest = `text in ${d(far.el)} (right edge ${Math.round(far.right)}px)`;
  }
  return { scrollWidth: root.scrollWidth, innerWidth: vw, widest, overlaps: pairs.size, overlapExamples: [...pairs.values()].slice(0, 3) };
}

const evalFn = (fn, ...args) => `(${fn.toString()})(${[describe.toString(), ...args.map((a) => JSON.stringify(a))].join(",")})`;
const MEASURE = `({ view: ${evalFn(viewMeasure)}, controls: ${evalFn(viewControls)} })`;

/**
 * Checks one Page through a test copy. Never throws: a failure to measure is reported as unchecked.
 * root: the host's project root (relative URLs resolve as on the live host). source: the exact revision to check
 * (update passes what it just showed). signal: cancels the check; deadlineMs bounds it.
 * Returns a capped summary; report.json beside the screenshots holds the full values.
 */
export async function checkPage(pageArg, { tmp = process.env.PI_TMP, browser = "agent-browser", root, source, signal, deadlineMs = DEADLINE_MS } = {}) {
  const result = { status: "pass", viewport: `${WIDTH}×${HEIGHT}`, revision: null, checks: [], views: [], notReached: 0, coverage: null, unchecked: [], report: null };
  const hard = (name, ok, detail) => result.checks.push({ name, status: ok ? "pass" : "fail", detail });
  let page, bytes;
  try { page = realpathSync(path.resolve(pageArg)); bytes = source === undefined ? readFileSync(page) : Buffer.from(source); }
  catch { return { ...result, status: "unchecked", unchecked: [`no Page file at ${clip(pageArg)}`] }; }
  const revision = sha(bytes);
  result.revision = revision.slice(0, 12);
  const stop = AbortSignal.any([AbortSignal.timeout(deadlineMs), ...(signal ? [signal] : [])]);
  if (stop.aborted) return { ...result, status: "unchecked", unchecked: ["browser checks: cancelled"] };
  const bal = tagBalance(bytes.toString("utf8"));
  const balance = { name: "HTML balance", status: bal.unclosed.length || bal.stray.length || bal.partial ? "warn" : "pass",
    detail: `${bal.unclosed.length} unclosed, ${bal.stray.length} stray end tag(s)${bal.partial ? ` in the part read within ${BALANCE_MS} ms` : ""}`
      + [...bal.unclosed.slice(0, 3).map((t) => `; <${clip(t.name, 40)}> line ${t.line} never closed`), ...bal.stray.slice(0, 3).map((t) => `; </${clip(t.name, 40)}> line ${t.line} closes nothing`)].join("") };
  result.checks.push(balance);

  const id = randomUUID().slice(0, 8);
  const copy = page.replace(/(\.html?)?$/i, `.atelier-check-${id}$1`);
  let made = false, host, shots, sockets, launched = false;
  // Only this run's exclusively created copy and the files the test host made for it.
  const clean = () => { if (made) for (const f of [copy, logPath(copy), `${logPath(copy)}.lock`, imagesDir(copy)]) rmSync(f, { force: true, recursive: true }); };
  const session = `atl-${id}`; // short: a socket path has ~100 characters
  // Each agent-browser command runs in its own process group: a cancel or timeout kills the launcher and the native
  // binary it starts. Its own socket directory makes the daemon (and the browser it starts) this check's alone; the idle
  // timeout ends them should even the teardown below never run.
  const env = { ...process.env, AGENT_BROWSER_IDLE_TIMEOUT_MS: "180000" };
  delete env.AGENT_BROWSER_NAMESPACE;
  const ab = (args, { timeout = 45_000, signal = stop } = {}) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const child = spawn(browser, args, { detached: true, env: { ...env, AGENT_BROWSER_SOCKET_DIR: sockets }, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const end = (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (!error) { resolve(out); return; }
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ }
      reject(error);
    };
    const onAbort = () => end(signal.reason);
    const timer = setTimeout(() => end(new Error(`agent-browser ${args.at(-1)}: no answer within ${timeout / 1000} s`)), timeout);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (s) => { out += s; });
    child.on("error", end);
    child.on("close", (code) => end(code === 0 ? null : new Error(`agent-browser ${args.find((a) => !a.startsWith("-") && a !== session)} exited with ${code}`)));
  });
  // Close the session, then kill what still runs with this check's socket directory in its environment: commands, the
  // daemon (even one still starting), the browser and its helpers. ponytail: `ps e` (macOS, Linux); not Windows.
  const teardown = async () => {
    await ab(["--session", session, "close"], { timeout: 5_000, signal: null }).catch(() => {});
    const left = () => execFileSync("ps", ["eww", "-A", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { PATH: `${process.env.PATH}:/bin:/usr/bin` } }).split("\n")
      .filter((l) => l.includes(`AGENT_BROWSER_SOCKET_DIR=${sockets}`)).map((l) => Number(l.trim().split(/\s/)[0]));
    for (const until = Date.now() + 2_000; Date.now() < until && left().length;) await sleep(200);
    for (const pid of left()) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
  };
  const b = async (...args) => {
    const r = JSON.parse(await ab(["--session", session, "--json", ...args]));
    if (!r.success) throw new Error(`agent-browser ${args[0]}: ${r.error ?? "failed"}`);
    return r.data;
  };
  const js = async (code) => (await b("eval", code)).result;
  const kc = { of: 0, count: 0, props: new Set(), selectors: new Set(), examples: new Set(), handlers: new Set(), shots: new Set() };
  try {
    sockets = mkdtempSync(path.join(tmpdir(), "atl-"));
    await ab(["--version"], { timeout: 10_000 }).catch((error) => { throw stop.aborted ? error : new Error(`${browser} is not installed or not on PATH`); });
    launched = true;
    if (tmp) { shots = path.join(tmp, `atelier-check-${path.basename(page).replace(/\W+/g, "-").slice(0, 60)}-${id}`); mkdirSync(shots, { recursive: true }); }
    else result.unchecked.push("screenshots and full report: PI_TMP is not set");
    writeFileSync(copy, bytes, { flag: "wx" });
    made = true;
    process.once("exit", clean);
    host = createHost({ root: root ?? path.dirname(page), sessionId: session, test: true, send: (_m, done) => done(true) });
    const { url } = await host.open(copy);
    const load = async () => {
      await b("open", url);
      try { await b("wait", "--fn", "window.atelier?.state().loaded === true", "--timeout", "15000"); return true; }
      catch (error) { if (stop.aborted) throw error; return false; }
      finally { await sleep(300, undefined, { signal: stop }); }
    };
    await b("set", "viewport", String(WIDTH), String(HEIGHT));
    const ready = await load();
    const once = await js(evalFn(kernelOnce));
    let loaded = "unknown", note = "";
    if (!once.kernelSrc) note = "; the Page loads no atelier.js";
    else {
      const text = await (await fetch(once.kernelSrc, { signal: AbortSignal.any([stop, AbortSignal.timeout(10_000)]) })).text();
      const stamp = /^\/\/ atelier-copy (\S+) /.exec(text);
      const body = stamp ? text.slice(text.indexOf("\n") + 1) : text;
      // The same version with other bytes is a changed copy, not a match.
      loaded = body === KERNEL_SOURCE ? KERNEL_VERSION : stamp ? `${clip(stamp[1], 40)} (changed copy)` : "unknown (unstamped copy)";
    }
    hard("Kernel version", loaded === KERNEL_VERSION, `page ${loaded}, host ${KERNEL_VERSION}${note}`);
    hard("Page state", once.loaded, once.loaded ? `the Kernel read its Event Log; ${once.decisions} Decision(s)` : `the Kernel did not read its Event Log${ready ? "" : " within 15 s"}`);
    hard("Kernel layout", !once.moved.length, once.moved.length
      ? `Kernel elements in <body> (${once.kernelElements.join(", ")}) move Page content: ${once.moved.join("; ")}. Wrap the Page in one container instead of laying out <body> itself.`
      : "Kernel elements in <body> take no layout space");

    // Views: the initial one, then one per [aria-controls] control (its target, its index among that target's
    // controls, its label), depth first. An open target counts as that control's view only when no other shown control
    // shares the target. A control that no longer shows is reached again by reloading and replaying its path.
    const key = (c) => JSON.stringify([c.controls, c.nth, c.label]);
    const covered = new Set(), queued = new Set(), todo = [], lost = [];
    // Console and page errors since the last clear (agent-browser keeps them across loads).
    const pageErrors = async () => [
      ...((await b("console")).messages ?? []).filter((x) => x.type === "error").map((x) => `console: ${x.text}`),
      ...((await b("errors")).errors ?? []).map((x) => `page: ${String(x.text).split("\n")[0]}`),
    ];
    const measure = async (label, item) => {
      const m = await js(MEASURE), errors = await pageErrors();
      let screenshot;
      if (shots) { screenshot = path.join(shots, `view-${String(result.views.length).padStart(2, "0")}.png`); await b("screenshot", "--full", screenshot); }
      const v = m.view, overflow = v.scrollWidth > v.innerWidth;
      result.views.push({ label, controls: item?.controls ?? null, status: errors.length || overflow ? "fail" : v.overlaps ? "warn" : "pass", errorCount: errors.length, errors,
        overflow: overflow ? { scrollWidth: v.scrollWidth, innerWidth: v.innerWidth, widest: v.widest } : null, overlaps: v.overlaps, overlapExamples: v.overlapExamples, screenshot });
      const k = await js(evalFn(kernelControls)); // last: it changes the Page
      kc.of = Math.max(kc.of, k.of); kc.count = Math.max(kc.count, k.count);
      for (const h of k.hits) { h.props.forEach((p) => kc.props.add(p)); h.selectors.forEach((s) => kc.selectors.add(s)); kc.examples.add(h.el); }
      k.handlers.forEach((h) => kc.handlers.add(h));
      if ((k.count || k.handlers.length) && screenshot) kc.shots.add(screenshot);
      if (item) covered.add(key(item));
      for (const c of m.controls) if (c.open && !c.shared) covered.add(key(c));
      const via = item ? [...item.path, item] : [];
      todo.unshift(...m.controls.filter((c) => !covered.has(key(c)) && !queued.has(key(c))).map((c) => { queued.add(key(c)); return { ...c, path: via }; }));
    };
    const click = (c) => js(evalFn(clickControl, c.controls, c.nth));
    const shown = async (c) => (await js(evalFn(viewControls))).find((x) => x.controls === c.controls)?.open
      ?? (await js(`${JSON.stringify(c.controls)}.split(/\\s+/).every((id) => document.getElementById(id)?.checkVisibility({ visibilityProperty: true }))`));
    const UNREACHED = "its control could not be reached again";
    const trail = (c) => [...c.path, c].map((s) => s.label || `#${clip(s.controls, 40)}`).join(" › ");
    await measure("initial view");
    while (todo.length) {
      const item = todo.shift();
      if (covered.has(key(item))) continue;
      if (result.views.length >= MAX_VIEWS) {
        const more = todo.filter((c) => !covered.has(key(c))).length + 1;
        result.notReached += more;
        result.unchecked.push(`views: ${more} more not opened (limit ${MAX_VIEWS})`);
        break;
      }
      await b("console", "--clear"); await b("errors", "--clear");
      const reach = async (steps) => {
        for (const step of steps) {
          if (!(await click(step))) return UNREACHED;
          await sleep(400, undefined, { signal: stop });
          if (!(await shown(step))) return step === item ? `clicking it did not show #${clip(item.controls, 60)}` : UNREACHED;
        }
        return null;
      };
      let gap = await reach([item]);
      if (gap === UNREACHED) { await load(); gap = await reach([...item.path, item]); }
      if (!gap) { await measure(trail(item), item); continue; }
      result.notReached += 1;
      result.unchecked.push(`view ${trail(item)}: ${gap}`);
      const errors = await pageErrors();
      if (errors.length) lost.push(`${trail(item)}: ${errors.join(" | ")}`);
    }
    if (lost.length) hard("Errors without a view", false, lost.join("; "));
  } catch (error) {
    result.unchecked.push(`browser checks: ${stop.aborted ? (signal?.aborted ? "cancelled" : `stopped at the ${deadlineMs / 1000} s deadline`) : clip(String(error.message ?? error).split("\n")[0], 300)}`);
  } finally {
    if (launched) await teardown().catch(() => {});
    if (sockets) rmSync(sockets, { recursive: true, force: true });
    host?.stop();
    clean();
    process.off("exit", clean);
  }
  if (result.views.length) {
    result.coverage = `${result.views.length} view(s): the initial one, then each [aria-controls] control's view once, by the first click path that reached it; other interactions and states are not exercised`;
    const restyled = kc.count || kc.handlers.size;
    result.checks.push({ name: "Kernel controls", status: restyled ? "warn" : "pass", detail: [
      kc.count ? `Page CSS changes ${kc.count} of ${kc.of} Kernel controls (${[...kc.props].join(", ")}) e.g. ${[...kc.examples].slice(0, 3).join(", ")}${kc.selectors.size ? `, via ${[...kc.selectors].slice(0, 5).map((s) => `\`${s}\``).join(", ")}` : ""}. Scope Page selectors to Page markup.` : "",
      kc.handlers.size ? `Page onclick on Kernel control(s): ${[...kc.handlers].join(", ")}.` : "",
    ].filter(Boolean).join(" ") || `${kc.of} Kernel controls keep their own styles and handlers`, ...(restyled && { screenshots: [...kc.shots] }) });
    if (balance.status === "warn") balance.screenshots = result.views.flatMap((v) => v.screenshot ?? []);
  }
  try { if (sha(readFileSync(page)) !== revision) result.unchecked.push(`revision: the Page file changed during the check; this result is for revision ${result.revision}`); } catch { /* gone */ }
  const statuses = [...result.checks, ...result.views].map((x) => x.status);
  result.status = statuses.includes("fail") ? "fail" : result.unchecked.some((u) => u.startsWith("browser")) ? "unchecked" : statuses.includes("warn") ? "warn" : "pass";
  if (shots) { result.report = path.join(shots, "report.json"); writeFileSync(result.report, JSON.stringify(result, null, 2)); }
  return summarize(result);
}

// What open, update and check return: every Page-controlled string clipped, lists shortened, and views dropped from
// the end while the whole is over PAYLOAD_MAX.
function summarize(r) {
  const s = {
    ...r,
    checks: r.checks.map((c) => ({ ...c, detail: clip(c.detail, 600), ...(c.screenshots && { screenshots: c.screenshots.slice(0, 3) }) })),
    views: r.views.map((v) => ({ ...v, label: clip(v.label, 160), controls: v.controls && clip(v.controls, 80), errors: v.errors.slice(0, 3).map((e) => clip(e)),
      overflow: v.overflow && { ...v.overflow, widest: v.overflow.widest && clip(v.overflow.widest, 160) }, overlapExamples: v.overlapExamples.slice(0, 3).map((e) => clip(e, 160)) })),
    unchecked: r.unchecked.slice(0, 10).map((u) => clip(u, 300)),
  };
  while (s.views.length && JSON.stringify(s).length > PAYLOAD_MAX) { s.views.pop(); s.viewsOmitted = r.views.length - s.views.length; }
  return s;
}

const MARK = { pass: "pass", warn: "WARN", fail: "FAIL", unchecked: "unchecked" };

/** The short text block `open`, `update` and the CLI print; bounded, the rest is in the full report. */
export function formatCheck(r) {
  const gaps = r.notReached;
  const lines = [`Page check (revision ${r.revision ?? "none"}, test copy at ${r.viewport}): ${MARK[r.status]}${gaps ? `, ${gaps} view(s) not reached` : ""}`];
  for (const c of r.checks) lines.push(`- ${MARK[c.status]}  ${c.name}: ${clip(c.detail, 600)}${c.status === "warn" && c.screenshots?.length ? ` Inspect: ${c.screenshots.join(", ")}` : ""}`);
  if (r.views.length) lines.push(`Views (${r.views.length}${r.viewsOmitted ? `, ${r.viewsOmitted} more in the full report` : ""}):`);
  for (const v of r.views) {
    const what = [
      v.errorCount ? `${v.errorCount} error(s): ${v.errors.slice(0, 2).join(" | ")}` : "no errors",
      v.overflow ? `overflow ${v.overflow.scrollWidth}px > ${v.overflow.innerWidth}px, widest ${v.overflow.widest ?? "unknown"}` : "no overflow",
      v.overlaps ? `WARN ${v.overlaps} possible text overlap(s): ${v.overlapExamples.join("; ")}` : "no text overlap",
    ].join("; ");
    lines.push(`- ${MARK[v.status]}  ${v.label}${v.controls ? ` (#${clip(v.controls, 60)})` : ""}: ${what}${v.screenshot ? ` — ${v.screenshot}` : ""}`);
  }
  if (r.coverage) lines.push(`Coverage: ${r.coverage}`);
  for (const u of r.unchecked) lines.push(`- unchecked: ${clip(u, 300)}`);
  const all = [...r.checks, ...r.views].map((x) => x.status);
  if (all.includes("fail")) lines.push("Fix every FAIL: it is measured.");
  if (all.includes("warn")) lines.push("WARN is a heuristic and never fails the check: open the screenshot(s) it names and fix what is really broken.");
  if (r.views.some((v) => v.screenshot)) lines.push("Have the screenshots inspected visually before handing the Page to the owner.");
  if (r.report) lines.push(`Full report: ${r.report}`);
  let text = "";
  for (const [i, line] of lines.entries()) {
    if (text.length + line.length > TEXT_MAX) return `${text}… ${lines.length - i} more line(s)${r.report ? ` in ${r.report}` : ""}`;
    text += `${line}\n`;
  }
  return text.trimEnd();
}

// No top-level await: index.ts imports this module.
const main = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (main) {
  const arg = process.argv[2];
  if (!arg || arg.startsWith("-")) { console.error("Usage: node check-page.mjs <page.html>  (run from the project directory)"); process.exit(2); }
  const cancel = new AbortController();
  let code = 0;
  for (const [sig, n] of [["SIGINT", 130], ["SIGTERM", 143]]) process.once(sig, () => { code = n; cancel.abort(); });
  checkPage(arg, { root: process.cwd(), signal: cancel.signal }).then((r) => { console.log(formatCheck(r)); process.exit(code || (r.status === "fail" ? 1 : 0)); });
}
