// Shared Pages, stand-ins and helpers of the page-check*.test.mjs files: one file per group of slow browser tests lets node --test run them in parallel.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import atelierExtension from "./index.ts";
import { checkPage, formatCheck, tagBalance } from "./check-page.mjs";

export const CHECK = fileURLToPath(new URL("./check-page.mjs", import.meta.url));
// The tool writes check output to its session's PI_TMP folder; keep those folders out of the real root.
export const PI_TMP_ROOT = process.env.PI_TMP_ROOT = realpathSync(mkdtempSync(path.join(process.env.PI_TMP ?? tmpdir(), "atelier-pitmp-")));
test.after(() => rmSync(PI_TMP_ROOT, { recursive: true, force: true }));
export const noBrowser = spawnSync("agent-browser", ["--version"]).status !== 0 && "agent-browser is not on PATH: Page check browser cases skipped";
export const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 12);
export const HEAD = /^Page check \(revision [0-9a-f]{12}, test copy at 1512×900 and 900×900\): /;

// A sidebar with tabs and the Kernel docked in it, and two tab panels.
export const page = ({ css = "", body = (inner) => `<div class="app">${inner}</div>`, panel2 = "<p>Second view.</p>", wire = "[role=tablist] button" } = {}) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fixture</title>
<style>body{margin:0;font:15px/1.5 system-ui}.app{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}
aside{padding:12px;border-right:1px solid #ddd}main{padding:16px}[role=tabpanel][hidden]{display:none}${css}</style>
<body>${body(`<aside><nav role="tablist"><button role="tab" aria-controls="p1">One</button><button role="tab" aria-controls="p2">Two</button></nav><div atl-dock></div></aside>
<main><section role="tabpanel" id="p1" atl-key="one" atl-decide="Confirm|Redo"><h2>One</h2><p>First view.</p></section>
<section role="tabpanel" id="p2" atl-key="two" hidden><h2>Two</h2>${panel2}</section></main>`)}
<script>const wire=()=>document.querySelectorAll(${JSON.stringify(wire)}).forEach((b)=>b.onclick=()=>{for(const p of document.querySelectorAll("[role=tabpanel]"))p.hidden=p.id!==b.getAttribute("aria-controls")});
wire();document.addEventListener("atelier:state",wire);</script>
<script type="module" src="atelier.js"></script></body></html>`;
// One <main> and nothing else.
export const bare = (body, css = "", script = "") => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fixture</title><style>body{margin:0;font:16px/1.5 system-ui}${css}</style>
<body><main>${body}</main><script>${script}</script><script type="module" src="atelier.js"></script></body></html>`;
export const show = (id, hide = "") => `onclick="document.getElementById('${id}').hidden=false${hide && `;document.getElementById('${hide}').hidden=true`}"`;
export const absTwice = '<div style="position:relative;height:30px"><span style="position:absolute">COLLISION ONE</span><span style="position:absolute">COLLISION TWO</span></div>';
export const sticky = (bg, top = "var(--atl-top, 0)") => bare('<header>HEADER</header><h2>SCROLLED CONTENT</h2><div style="height:1200px"></div>', `header{position:sticky;top:${top};z-index:1;height:60px;background:${bg}}h2{margin:0}`, 'addEventListener("load",()=>scrollTo(0,60))');

export const FIXTURES = {
  good: page(),
  // <body> itself is the grid: the Kernel's own <body> children take grid cells and push the Page's columns along.
  "broken-grid": page({ css: "body{display:grid;grid-template-columns:240px 1fr}", body: (inner) => inner }),
  // `div button` also hits the Kernel's top bar buttons (an idle docked panel is hidden, 2.15.0).
  "broken-tabs": page({ css: "div button{display:flex;justify-content:space-between;width:100%;text-align:left;margin:2px 0}", wire: "div button" }),
  // A <div> left open in the hidden view.
  unbalanced: page({ panel2: "<div class=row><p>Gap row.</p>" }),
  // A badge placed into the grid cell of the item's main text.
  overlap: page({ css: ".item{display:grid;grid-template-columns:120px 1fr}.item>*{grid-row:1}.badge,.text{grid-column:2}", panel2: `<div class="item"><b>Name</b><span class="text">The item's main text</span><span class="badge">badge</span></div>` }),
  // Finding 4: a Page rule hiding a Page panel is no Kernel restyle; a sizing rule on every button is.
  "hidden-panel": bare(`<button aria-controls="p" onclick="document.getElementById('p').classList.toggle('open')">Show</button><section id="p" atl-key="a" atl-decide="Yes|No">A hidden Decision</section>`, "#p:not(.open){display:none}"),
  sized: bare('<p atl-key="a" atl-decide="Yes|No">Decide</p>', "button{width:100%}"),
  // Finding 5: parallel rotated labels whose boxes meet; crossing ones; a header over scrolled content; a related span.
  rotated: bare('<svg width="400" height="140"><g transform="translate(100 30) rotate(45)"><text x="0" y="0">LONG LABEL ONE</text><text x="0" y="25">LONG LABEL TWO</text></g></svg>'),
  crossing: bare('<svg width="400" height="220" font-size="16"><text x="100" y="100" transform="rotate(45 175 95)">CROSSING LABEL ONE</text><text x="100" y="100" transform="rotate(-45 175 95)">CROSSING LABEL TWO</text></svg>'),
  "sticky-opaque": sticky("white"),
  "sticky-clear": sticky("transparent"),
  // 2.15.0: a sticky header at top 0 sits under the Kernel's top bar.
  "sticky-under-bar": sticky("white", "0"),
  // 2.15.0 review: the Kernel's empty Decisions container takes a 36px <body> grid row, as high as the top bar: still a FAIL.
  "bar-height-shift": bare("CONTENT", "body{display:grid;grid-auto-rows:36px}").replace("<html lang=\"en\">", '<html lang="en" style="padding-top:0">'),
  // A full-height app: the bar moves <main> down and shortens it by its height, and that alone passes.
  "app-full-height": bare('<button style="position:absolute;bottom:8px">Bottom</button>', "html,body{height:100%;overflow:hidden}main{height:100%;position:relative}"),
  inline: bare('<p>FIRST WORDS <span style="position:relative;left:-100px">SECOND WORDS</span></p>'),
  // Finding 7: a nested view, one reached again by reload (Away hides Outer), and a control that shows nothing.
  nested: bare(`<button aria-controls="outer" ${show("outer")}>Outer</button><button aria-controls="nowhere">Dead</button>
<section id="outer" hidden><button aria-controls="inner" ${show("inner")}>Inner</button><button aria-controls="away" ${show("away", "outer")}>Away</button><button aria-controls="again" ${show("again")}>Again</button>
<section id="inner" hidden>${absTwice}</section><section id="again" hidden><p>Again.</p></section></section><section id="away" hidden><p>Away.</p></section>`),
  // Finding 9: one 200,000-character console error.
  bloat: bare("<h1>Loud</h1>", "", 'console.error("x".repeat(200000))'),
  // Second review, finding 4: two controls render different views into one target; only the second overflows.
  "reuse-target": bare(`<button aria-controls="view" onclick="view.innerHTML='<p>Good</p>';view.hidden=false">Good</button><button aria-controls="view" onclick="view.innerHTML='<p style=width:2200px>Broken</p>';view.hidden=false">Broken</button><section id="view" hidden></section>`),
  // Second review, finding 7: a 120,000-character aria-controls value.
  "long-controls": bare(`<button aria-controls="${"x".repeat(120_000)}" onclick="this.nextElementSibling.hidden=false">Open</button><section id="${"x".repeat(120_000)}" hidden><p>Fine</p></section>`),
};
// Third review, one Page per finding, each checked in its own test.
export const THIRD = {
  // Finding 1: a probe that raised `nav button, #none` (it hits Kernel buttons) over `.nav button`, even while it lists
  // `#none`, would widen the Page's button, and restoring it would start a 30 s transition.
  "transition-leak": bare('<nav class="nav"><button aria-controls="panel" onclick="panel.hidden=false">Show</button></nav><section id="panel" hidden><p>Good</p></section>',
    "nav button, #none{width:2500px;transition:none}.nav button{width:100px;transition:width 30s}"),
  // Finding 3: the click throws before it shows its view.
  "throws-on-click": bare(`<button aria-controls="panel" onclick="throw new Error('render failed')">Broken</button><section id="panel" hidden><p>Never renders</p></section>`),
  // Finding 4: <main> is display:contents, so its children are the <body> grid's items.
  "contents-grid": bare("<aside>Sidebar</aside><article>Content</article>", "body{display:grid;grid-template-columns:250px 1fr}main{display:contents}"),
};

// A narrow desktop window (the 900px pass): a fixed decision bar over the last card, the same with its height reserved, a
// row only the narrow window overflows, and Kernel controls pushed over each other.
export const cards = (css) => bare(`${Array.from({ length: 4 }, (_, i) => `<article class="card"><h3>Card ${i + 1}</h3><p>CARD TEXT ${i + 1}</p></article>`).join("")}<div class="bar" atl-key="d">Decide here</div>`,
  `.card{min-height:240px;display:flex;flex-direction:column;justify-content:flex-end;border:1px solid #ddd;padding:8px}.bar{position:fixed;left:0;right:0;bottom:0;height:90px;background:#fff;border-top:1px solid #ddd}${css}`);
export const NARROW = {
  "bar-covers": cards(""),
  "bar-reserved": cards("main{padding-bottom:90px}"),
  "narrow-overflow": bare('<div style="min-width:1100px">A row wider than a narrow window</div>'),
  "kernel-squashed": bare('<p atl-key="a" atl-decide="Yes|No|Later">Decide</p>', "[atl-ui] button+button{margin-left:-40px}"),
};

export function project(fixtures = FIXTURES) {
  const root = realpathSync(mkdtempSync(path.join(process.env.PI_TMP ?? tmpdir(), "atelier-page-check-")));
  for (const [name, html] of Object.entries(fixtures)) writeFileSync(path.join(root, `${name}.html`), html);
  return root;
}
export const marked = (status) => (r) => [...r.checks.filter((c) => c.status === status).map((c) => c.name), ...r.views.filter((v) => v.status === status).map((v) => `view ${v.label}`)];
export const failing = marked("fail"), warned = marked("warn");
export const leftovers = (dir) => readdirSync(dir).filter((f) => /atelier-check-/.test(f));

// A stand-in agent-browser: logs each call to $SHIM_LOG; on `open` it fetches the test copy and ../data.json through
// the test host and logs them, then fails, so the check ends "unchecked". Like the real one, the first command starts a
// detached daemon (pid file in $AGENT_BROWSER_SOCKET_DIR) with a browser in its own process group, and close stops it.
// SHIM_SLOW hangs every command but --version and close in a child process, as the real launcher waits for its native
// binary; SHIM_SLOW=close hangs close too. SHIM_MUTATE names a file it rewrites on the first command (the Page changing
// during its check).
export function shim() {
  const dir = realpathSync(mkdtempSync(path.join(process.env.PI_TMP ?? tmpdir(), "atelier-shim-")));
  const log = path.join(dir, "log.jsonl"), bin = path.join(dir, "agent-browser");
  writeFileSync(bin, `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
const a = process.argv.slice(2), log = (o) => appendFileSync(process.env.SHIM_LOG, JSON.stringify({ pid: process.pid, ...o }) + "\\n");
const reply = (ok) => { console.log(JSON.stringify(ok ? { success: true, data: {} } : { success: false, error: "shim" })); process.exit(0); };
const sockets = process.env.AGENT_BROWSER_SOCKET_DIR;
log({ sockets, mode: sockets && existsSync(sockets) ? statSync(sockets).mode & 0o777 : null });
if (a[0] === "--version") { console.log("shim"); process.exit(0); }
const cmd = a.includes("close") ? "close" : a[a.indexOf("--json") + 1];
log({ cmd });
const forever = ["-e", "setInterval(() => {}, 1e9)"];
const hang = () => { log({ child: spawn(process.execPath, forever, { stdio: "ignore" }).pid }); return new Promise((r) => setTimeout(r, 60_000)); };
const pidFile = process.env.AGENT_BROWSER_SOCKET_DIR && \`\${process.env.AGENT_BROWSER_SOCKET_DIR}/\${a[a.indexOf("--session") + 1]}.pid\`;
if (cmd === "close") {
  if (process.env.SHIM_SLOW === "close") await hang();
  if (pidFile && existsSync(pidFile)) process.kill(Number(readFileSync(pidFile, "utf8")));
  reply(true);
}
if (pidFile && !existsSync(pidFile)) {
  const daemon = spawn(process.execPath, ["-e", \`const c = require("child_process").spawn(process.execPath, \${JSON.stringify(forever)}, { detached: true, stdio: "ignore" });
require("fs").appendFileSync(process.env.SHIM_LOG, JSON.stringify({ browser: c.pid }) + "\\\\n");
process.on("SIGTERM", () => { c.kill("SIGKILL"); process.exit(0); }); setInterval(() => {}, 1e9);\`], { detached: true, stdio: "ignore" });
  daemon.unref();
  writeFileSync(pidFile, String(daemon.pid));
  log({ daemon: daemon.pid });
}
if (process.env.SHIM_SLOW) await hang();
if (process.env.SHIM_MUTATE && cmd === "set") writeFileSync(process.env.SHIM_MUTATE, "<p>changed during the check</p>");
if (cmd === "set") reply(true);
if (cmd === "open") { const url = a.at(-1); log({ url, page: await (await fetch(url)).text(), data: (await fetch(new URL("../data.json", url))).status }); }
reply(false);
`);
  chmodSync(bin, 0o755);
  const env = { PATH: `${dir}${path.delimiter}${process.env.PATH}`, SHIM_LOG: log, SHIM_SLOW: "", SHIM_MUTATE: "" };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  return {
    env, dir,
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []),
    use: (extra = {}) => Object.assign(process.env, env, extra),
    restore: () => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(dir, { recursive: true, force: true }); },
  };
}
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export function tool(root) {
  const tools = new Map(), handlers = {};
  atelierExtension({ registerTool: (t) => tools.set(t.name, t), on: (n, fn) => { handlers[n] = fn; }, sendMessage: () => {} });
  const ctx = { cwd: root, isIdle: () => true, sessionManager: { getSessionId: () => `s-page-check-${process.pid}-${Math.random()}` } };
  handlers.session_start({}, ctx);
  return { run: (params, signal) => tools.get("atelier").execute("id", params, signal, undefined, ctx), stop: () => handlers.session_shutdown() };
}
// The check is on unless a test turns it off; restored after.
export const withCheck = async (value, fn) => {
  const saved = process.env.ATELIER_PAGE_CHECK;
  if (value === undefined) delete process.env.ATELIER_PAGE_CHECK; else process.env.ATELIER_PAGE_CHECK = value;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.ATELIER_PAGE_CHECK; else process.env.ATELIER_PAGE_CHECK = saved; }
};
