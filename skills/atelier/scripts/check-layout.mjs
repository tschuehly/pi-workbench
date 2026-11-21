#!/usr/bin/env node
// Layout check before reporting UI work done: loads a URL (or HTML file) at phone 390×844 and desktop 1440×900 with
// agent-browser, saves a screenshot per width and lists clipped or overflowing elements. Exit 1 on findings, 2 on error.
// Usage: node check-layout.mjs <url|file> [--out DIR]   (screenshots default to $PI_TMP)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WIDTHS = [["phone", 390, 844], ["desktop", 1440, 900]];

// Runs in the page; returns [{ path, kind, px }].
const DETECT = `(() => {
  const vw = document.documentElement.clientWidth, out = [];
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + [...el.classList].slice(0, 2).map((c) => "." + c).join("");
  const sel = (el) => { const p = []; for (let e = el; e && e !== document.documentElement && p.length < 4; e = e.parentElement) p.unshift(name(e)); return p.join(" > "); };
  const clips = (cs) => /hidden|clip/.test(cs.overflowX + cs.overflowY);
  const clippedByAncestor = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.overflowX !== "visible") return true; } return false; };
  const past = new Set();
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (cs.display === "none" || cs.visibility === "hidden" || r.width === 0 || el.clientWidth <= 1 || el.clientHeight <= 1) continue;
    if (clips(cs) && parseFloat(cs.textIndent) === 0) { // a text-indent hides an icon button's label on purpose
      const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
      if (dx > 1 && /hidden|clip/.test(cs.overflowX)) out.push({ path: sel(el), kind: cs.textOverflow === "ellipsis" ? "text truncated (ellipsis)" : "content clipped horizontally", px: dx });
      else if (dy > 1 && /hidden|clip/.test(cs.overflowY)) out.push({ path: sel(el), kind: "content clipped vertically", px: dy });
    }
    // Past the viewport's right edge and not inside a clipping or scrolling box: horizontal page scroll. Report the outermost.
    const beyond = Math.round(r.right - vw);
    if (beyond > 1 && cs.position !== "fixed" && !clippedByAncestor(el)) {
      past.add(el);
      if (!past.has(el.parentElement)) out.push({ path: sel(el), kind: "extends past viewport (horizontal scroll)", px: beyond });
    }
  }
  const page = document.documentElement.scrollWidth - vw;
  if (page > 1 && !past.size) out.push({ path: "html", kind: "page scrolls horizontally", px: page });
  return JSON.stringify(out);
})()`;

const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const out = oi >= 0 ? args.splice(oi, 2)[1] : process.env.PI_TMP;
const target = args[0];
if (!target || !out) { console.error("usage: check-layout.mjs <url|file> [--out DIR]  (needs --out or $PI_TMP)"); process.exit(2); }
const url = /^[a-z]+:/i.test(target) ? target : pathToFileURL(path.resolve(target)).href;
if (url.startsWith("file:") && !existsSync(new URL(url))) { console.error(`no such file: ${target}`); process.exit(2); }
mkdirSync(out, { recursive: true });

const session = `layout-${process.pid}`;
const ab = (...a) => {
  const r = JSON.parse(execFileSync("agent-browser", ["--session", session, "--json", ...a], { encoding: "utf8", timeout: 60_000 }));
  if (!r.success) throw new Error(`agent-browser ${a[0]}: ${r.error}`);
  return r.data;
};

let problems = 0;
try {
  for (const [label, w, h] of WIDTHS) {
    ab("set", "viewport", String(w), String(h));
    ab("open", url);
    const found = JSON.parse(ab("eval", DETECT).result);
    const shot = path.join(out, `layout-${label}-${w}x${h}-${Date.now()}.png`);
    ab("screenshot", shot);
    console.log(`${label} ${w}x${h}: ${shot}`);
    for (const f of found.slice(0, 20)) console.log(`  FAIL ${f.kind} by ${f.px}px: ${f.path}`);
    if (found.length > 20) console.log(`  … ${found.length - 20} more`);
    problems += found.length;
  }
} catch (e) {
  console.error(`check-layout: ${e.message}`);
  problems = -1;
} finally {
  try { execFileSync("agent-browser", ["--session", session, "close"], { stdio: "ignore", timeout: 10_000 }); } catch {}
}
if (problems < 0) process.exit(2);
console.log(problems ? `${problems} layout problem(s); look at the screenshots too.` : "No clipping or overflow found; look at the screenshots too.");
process.exit(problems ? 1 : 0);
