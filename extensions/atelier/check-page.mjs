#!/usr/bin/env node
// Page check: catches a broken Page before the owner sees it. `open` and `update` run it; from a shell:
//   node extensions/atelier/check-page.mjs <page.html>     (exit 1 on a failed check, 0 when passed or unchecked)
// It serves a test copy beside the Page (<name>.atelier-check.html, its own Event Log, like serve.mjs; a distinct name
// so a running serve.mjs keeps its copy) through the real host, loads it in agent-browser at 1512×900 and clicks every
// [aria-controls] element in turn. The Page's real Event Log is never read or touched. Measured, generic checks:
// - HTML balance: unclosed or stray end tags in the source (hidden views leak below the visible one).
// - Kernel version in the page equals the host's; the Event Log loaded.
// - Kernel layout: hiding the Kernel's own <body> children must not move the Page's first-level elements (a <body> grid
//   gives them grid cells).
// - Kernel controls: disabling the Page's stylesheets must not change a Kernel control's box styles (Page CSS such as
//   `aside button` also hits the Kernel panel, itself an <aside>), and no Page onclick sits on a Kernel control.
// - Per view: console and page errors, horizontal overflow (and the element reaching furthest right), text drawn over
//   other text, and one full-page screenshot in $PI_TMP.
// A missing or failing agent-browser leaves the browser checks "unchecked"; it never fails open or update.
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { KERNEL_VERSION, createHost, imagesDir, logPath } from "./host.ts";

const run = promisify(execFile);
const WIDTH = 1512, HEIGHT = 900;
const KERNEL_SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "kernel", "atelier.js"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
// End tags HTML lets an author omit; not counting them avoids flagging valid Pages.
const OPTIONAL = new Set("html head body p li dt dd option optgroup tr td th thead tbody tfoot colgroup caption rb rt rp rtc".split(" "));

/** Unclosed and stray end tags in Page source; script, style, textarea, title and comment bodies are skipped. */
export function tagBalance(html) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  const src = html.replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<(script|style|textarea|title)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_m, open, _n, body, close) => open + blank(body) + close);
  const lineAt = (i) => src.slice(0, i).split("\n").length;
  const stack = [], unclosed = [], stray = [];
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const name = m[2].toLowerCase();
    if (VOID.has(name) || OPTIONAL.has(name)) continue;
    if (!m[1]) { if (!m[3].trimEnd().endsWith("/")) stack.push({ name, line: lineAt(m.index) }); continue; }
    const at = stack.findLastIndex((o) => o.name === name);
    if (at < 0) { stray.push({ name, line: lineAt(m.index) }); continue; }
    unclosed.push(...stack.splice(at).slice(1));
  }
  unclosed.push(...stack);
  return { unclosed: unclosed.sort((a, b) => a.line - b.line), stray };
}

// --- Browser side: these functions run in the Page via eval. ---

function describeFn() {
  window.__atlDescribe = (el) => {
    if (!el) return "?";
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join("") : "";
    const key = el.getAttribute("atl-key") ? `[atl-key=${el.getAttribute("atl-key")}]` : "";
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls}${key}`;
  };
  return true;
}

function pageOnce() {
  const d = window.__atlDescribe, kernel = (el) => el.closest("[atl-ui]");
  const s = window.atelier?.state() ?? { loaded: false, decisions: [] };
  // Kernel layout: Page's first-level elements with and without the Kernel's <body> children taking part in layout.
  const own = [...document.body.children].filter((el) => el.hasAttribute("atl-ui"));
  const pageKids = [...document.body.children].filter((el) => !el.hasAttribute("atl-ui") && !["SCRIPT", "STYLE", "TEMPLATE", "LINK"].includes(el.tagName));
  const boxes = () => pageKids.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x + scrollX), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)]; });
  const withKernel = boxes();
  const saved = own.map((el) => el.style.getPropertyValue("display"));
  own.forEach((el) => el.style.setProperty("display", "none", "important"));
  const without = boxes();
  own.forEach((el, i) => saved[i] ? el.style.setProperty("display", saved[i]) : el.style.removeProperty("display"));
  const moved = pageKids.flatMap((el, i) => withKernel[i].some((v, j) => Math.abs(v - without[i][j]) > 1)
    ? [`${d(el)} ${without[i].slice(0, 2).join(",")} ${without[i][2]}×${without[i][3]} → ${withKernel[i].slice(0, 2).join(",")} ${withKernel[i][2]}×${withKernel[i][3]}`] : []);
  // Kernel controls: box styles with the Page's stylesheets on and off.
  const PROPS = ["display", "position", "float", "text-align", "justify-content", "flex-direction", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-bottom-width",
    "visibility", "opacity", "transform", "min-width", "max-width"];
  const controls = [...document.querySelectorAll("[atl-ui] button, [atl-ui] input, [atl-ui] select, [atl-ui] textarea, [atl-ui] a, button[atl-ui]")];
  const read = () => controls.map((el) => { const c = getComputedStyle(el); return PROPS.map((p) => c.getPropertyValue(p)); });
  const pageSheets = [...document.styleSheets].filter((sh) => !sh.ownerNode?.closest?.("[atl-ui]") && !sh.disabled);
  const styled = read();
  pageSheets.forEach((sh) => { sh.disabled = true; });
  const plain = read();
  pageSheets.forEach((sh) => { sh.disabled = false; });
  const changed = new Map(); // prop -> count
  const hit = [];
  controls.forEach((el, i) => PROPS.forEach((p, j) => {
    if (styled[i][j] === plain[i][j]) return;
    changed.set(p, (changed.get(p) ?? 0) + 1);
    if (!hit.includes(el)) hit.push(el);
  }));
  const selectors = new Set();
  const walk = (rules) => { for (const r of rules) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText && !/atl/.test(r.selectorText)) { try { if (hit.some((el) => el.matches(r.selectorText))) selectors.add(r.selectorText); } catch { /* selector the engine rejects */ } } } };
  for (const sh of pageSheets) { try { walk(sh.cssRules); } catch { /* cross-origin sheet */ } }
  const handlers = controls.filter((el) => el.onclick || el.hasAttribute("onclick")).map(d);
  // View controls: [aria-controls] outside the Kernel, visible at load.
  window.__atlViews = [...document.querySelectorAll("[aria-controls]")].filter((el) => !kernel(el) && el.getClientRects().length);
  return {
    loaded: s.loaded, decisions: s.decisions.length,
    kernelSrc: [...document.scripts].find((sc) => /(^|\/)atelier\.js(\?|#|$)/.test(sc.src))?.src ?? null,
    moved, kernelElements: own.map(d),
    restyled: { controls: hit.length, of: controls.length, props: Object.fromEntries(changed), selectors: [...selectors].slice(0, 5), examples: hit.slice(0, 3).map(d) },
    handlers,
    views: window.__atlViews.map((el) => ({ label: (el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 50), controls: el.getAttribute("aria-controls") })),
  };
}

function viewMeasure() {
  const d = window.__atlDescribe, kernel = (el) => el.closest("[atl-ui]");
  const root = document.documentElement, vw = innerWidth;
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
  // Text over text: rects of each element's own text nodes; pairs from different, unrelated elements that intersect.
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
    if (!up) c = null;
    else if (el !== document.body && (cs.overflowX !== "visible" || cs.overflowY !== "visible")) {
      const r = el.getBoundingClientRect();
      c = { left: Math.max(up.left, r.left), top: Math.max(up.top, r.top), right: Math.min(up.right, r.right), bottom: Math.min(up.bottom, r.bottom) };
    }
    clips.set(el, c);
    return c;
  };
  for (let n; (n = walker.nextNode());) {
    const el = n.parentElement, c = clipOf(el);
    // checkVisibility: false inside a closed <details>, display:none, visibility:hidden or opacity 0.
    if (!c || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      const left = Math.max(r.left, c.left), right = Math.min(r.right, c.right), top = Math.max(r.top, c.top), bottom = Math.min(r.bottom, c.bottom);
      if (right - left > 1 && bottom - top > 1) boxes.push({ el, top: top + scrollY, bottom: bottom + scrollY, left: left + scrollX, right: right + scrollX });
    }
  }
  boxes.sort((a, b) => a.top - b.top);
  const pairs = new Map();
  const PAD = 2; // ignore touching boxes and line-height overlap
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length && boxes[j].top < a.bottom - PAD; j += 1) {
      const b = boxes[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) <= PAD || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= PAD) continue;
      const key = `${d(a.el)} × ${d(b.el)}`;
      if (!pairs.has(key)) pairs.set(key, `${key} at ${Math.round(Math.max(a.left, b.left))},${Math.round(Math.max(a.top, b.top))}`);
    }
  }
  if (root.scrollWidth > vw && !widest) { // text running out of its element's box
    const far = boxes.reduce((m, x) => (x.right > (m?.right ?? vw + 1) ? x : m), null);
    if (far) widest = `text in ${d(far.el)} (right edge ${Math.round(far.right)}px)`;
  }
  return { scrollWidth: root.scrollWidth, innerWidth: vw, widest, overlaps: pairs.size, overlapExamples: [...pairs.values()].slice(0, 3) };
}

const evalFn = (fn, ...args) => `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`;

/** Checks one Page through a test copy. Never throws: a failure to measure is reported as unchecked. */
export async function checkPage(pageArg, { tmp = process.env.PI_TMP, browser = "agent-browser" } = {}) {
  const result = { status: "pass", viewport: `${WIDTH}×${HEIGHT}`, checks: [], views: [], unchecked: [] };
  const add = (name, ok, detail) => { result.checks.push({ name, ok, detail }); if (!ok) result.status = "fail"; };
  let page;
  try { page = realpathSync(path.resolve(pageArg)); } catch { return { ...result, status: "unchecked", unchecked: [`no Page file at ${pageArg}`] }; }
  const source = readFileSync(page, "utf8");
  const bal = tagBalance(source);
  add("HTML balance", !bal.unclosed.length && !bal.stray.length, `${bal.unclosed.length} unclosed, ${bal.stray.length} stray end tag(s)`
    + [...bal.unclosed.slice(0, 3).map((t) => `; <${t.name}> line ${t.line} never closed`), ...bal.stray.slice(0, 3).map((t) => `; </${t.name}> line ${t.line} closes nothing`)].join(""));

  const copy = page.replace(/(\.html?)?$/i, ".atelier-check$1");
  const clean = () => { for (const f of [copy, logPath(copy), `${logPath(copy)}.lock`, imagesDir(copy)]) rmSync(f, { force: true, recursive: true }); };
  const session = `atelier-check-${process.pid}-${Date.now()}`;
  const b = async (...args) => {
    const { stdout } = await run(browser, ["--session", session, "--json", ...args], { timeout: 45_000, maxBuffer: 16 * 1024 * 1024 });
    const r = JSON.parse(stdout);
    if (!r.success) throw new Error(`agent-browser ${args[0]}: ${r.error ?? "failed"}`);
    return r.data;
  };
  const js = async (code) => (await b("eval", code)).result;
  let host, shots;
  try {
    await run(browser, ["--version"], { timeout: 10_000 }).catch(() => { throw new Error(`${browser} is not installed or not on PATH`); });
    if (tmp) { shots = path.join(tmp, `atelier-check-${path.basename(page).replace(/\W+/g, "-")}-${Date.now()}`); mkdirSync(shots, { recursive: true }); }
    else result.unchecked.push("screenshots: PI_TMP is not set");
    clean();
    writeFileSync(copy, source);
    host = createHost({ root: path.dirname(copy), sessionId: session, test: true, send: (_m, done) => done(true) });
    const { url } = await host.open(copy);
    await b("set", "viewport", String(WIDTH), String(HEIGHT));
    await b("open", url);
    try { await b("wait", "--fn", "window.atelier?.state().loaded === true", "--timeout", "15000"); }
    catch { add("Kernel", false, "the Kernel did not load or did not read its Event Log within 15 s"); }
    await sleep(300);
    await js(evalFn(describeFn));
    const once = await js(evalFn(pageOnce));
    if (once) {
      let loaded = "unknown", note = "";
      if (!once.kernelSrc) note = "; the Page loads no atelier.js";
      else {
        const text = await (await fetch(once.kernelSrc)).text();
        const stamp = /^\/\/ atelier-copy (\S+) /.exec(text);
        const body = stamp ? text.slice(text.indexOf("\n") + 1) : text;
        // The same version with other bytes is a changed copy, not a match.
        loaded = body === KERNEL_SOURCE ? KERNEL_VERSION : stamp ? `${stamp[1]} (changed copy)` : "unknown (unstamped copy)";
      }
      add("Kernel version", loaded === KERNEL_VERSION, `page ${loaded}, host ${KERNEL_VERSION}${note}; Event Log ${once.loaded ? "loaded" : "not loaded"}, ${once.decisions} Decision(s)`);
      add("Kernel layout", !once.moved.length, once.moved.length
        ? `Kernel elements in <body> (${once.kernelElements.join(", ")}) move Page content: ${once.moved.slice(0, 3).join("; ")}. Wrap the Page in one container instead of laying out <body> itself.`
        : "Kernel elements in <body> take no layout space");
      const rs = once.restyled;
      add("Kernel controls", !rs.controls && !once.handlers.length, [
        rs.controls ? `Page CSS changes ${rs.controls} of ${rs.of} Kernel controls (${Object.keys(rs.props).join(", ")}) e.g. ${rs.examples.join(", ")}${rs.selectors.length ? `, via ${rs.selectors.map((s) => `\`${s}\``).join(", ")}` : ""}. Scope Page selectors to Page markup.` : "",
        once.handlers.length ? `Page onclick on ${once.handlers.length} Kernel control(s): ${once.handlers.slice(0, 3).join(", ")}.` : "",
      ].filter(Boolean).join(" ") || `${rs.of} Kernel controls keep their own styles and handlers`);
      const views = [{ label: "initial view", controls: null }, ...once.views];
      for (let i = 0; i < views.length; i += 1) {
        const v = views[i];
        if (i > 0) { await b("console", "--clear"); await b("errors", "--clear"); await js(`window.__atlViews[${i - 1}].click(); true`); await sleep(400); }
        const m = await js(evalFn(viewMeasure));
        const errors = [
          ...((await b("console")).messages ?? []).filter((x) => x.type === "error").map((x) => `console: ${x.text}`),
          ...((await b("errors")).errors ?? []).map((x) => `page: ${String(x.text).split("\n")[0]}`),
        ];
        let screenshot;
        if (shots) { screenshot = path.join(shots, `view-${String(i).padStart(2, "0")}.png`); await b("screenshot", "--full", screenshot); }
        const overflow = m.scrollWidth > m.innerWidth;
        result.views.push({ ...v, ok: !errors.length && !overflow && !m.overlaps, errors, overflow: overflow ? { scrollWidth: m.scrollWidth, innerWidth: m.innerWidth, widest: m.widest } : null, overlaps: m.overlaps, overlapExamples: m.overlapExamples, screenshot });
        if (errors.length || overflow || m.overlaps) result.status = "fail";
      }
    }
  } catch (error) {
    result.unchecked.push(`browser checks: ${String(error.message ?? error).split("\n")[0]}`);
  } finally {
    await run(browser, ["--session", session, "close"], { timeout: 15_000 }).catch(() => {});
    host?.stop();
    clean();
  }
  if (result.status === "pass" && result.unchecked.some((u) => u.startsWith("browser"))) result.status = "unchecked";
  return result;
}

/** The short text block `open`, `update` and the CLI print. */
export function formatCheck(r) {
  const mark = (ok) => (ok ? "pass" : "FAIL");
  const lines = [`Page check (test copy, ${r.viewport}): ${r.status === "unchecked" ? "unchecked" : mark(r.status === "pass")}`];
  for (const c of r.checks) lines.push(`- ${mark(c.ok)}  ${c.name}: ${c.detail}`);
  if (r.views.length) lines.push(`Views (${r.views.length}):`);
  for (const v of r.views) {
    const what = [
      v.errors.length ? `${v.errors.length} error(s): ${v.errors.slice(0, 2).join(" | ")}` : "no errors",
      v.overflow ? `overflow ${v.overflow.scrollWidth}px > ${v.overflow.innerWidth}px, widest ${v.overflow.widest ?? "unknown"}` : "no overflow",
      v.overlaps ? `${v.overlaps} text overlap(s): ${v.overlapExamples.join("; ")}` : "no text overlap",
    ].join("; ");
    lines.push(`- ${mark(v.ok)}  ${v.label}${v.controls ? ` (#${v.controls})` : ""}: ${what}${v.screenshot ? ` — ${v.screenshot}` : ""}`);
  }
  for (const u of r.unchecked) lines.push(`- unchecked: ${u}`);
  if (r.views.some((v) => v.screenshot)) lines.push("Have the screenshots inspected visually before handing the Page to the owner.");
  return lines.join("\n");
}

// No top-level await: index.ts imports this module.
const main = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (main) {
  const arg = process.argv[2];
  if (!arg || arg.startsWith("-")) { console.error("Usage: node check-page.mjs <page.html>"); process.exit(2); }
  checkPage(arg).then((r) => { console.log(formatCheck(r)); process.exit(r.status === "fail" ? 1 : 0); });
}
