// The Page check (check-page.mjs) on small synthetic Pages, one per real defect it must catch, and one good Page.
// The browser cases need agent-browser and skip without it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import atelierExtension from "./index.ts";
import { checkPage, formatCheck, tagBalance } from "./check-page.mjs";

const noBrowser = spawnSync("agent-browser", ["--version"]).status !== 0 && "agent-browser is not on PATH: Page check browser cases skipped";

// A sidebar with tabs and the Kernel docked in it, and two tab panels.
const page = ({ css = "", body = (inner) => `<div class="app">${inner}</div>`, panel2 = "<p>Second view.</p>", wire = "[role=tablist] button" } = {}) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fixture</title>
<style>body{margin:0;font:15px/1.5 system-ui}.app{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}
aside{padding:12px;border-right:1px solid #ddd}main{padding:16px}[role=tabpanel][hidden]{display:none}${css}</style>
<body>${body(`<aside><nav role="tablist"><button role="tab" aria-controls="p1">One</button><button role="tab" aria-controls="p2">Two</button></nav><div atl-dock></div></aside>
<main><section role="tabpanel" id="p1" atl-key="one" atl-decide="Confirm|Redo"><h2>One</h2><p>First view.</p></section>
<section role="tabpanel" id="p2" atl-key="two" hidden><h2>Two</h2>${panel2}</section></main>`)}
<script>const wire=()=>document.querySelectorAll(${JSON.stringify(wire)}).forEach((b)=>b.onclick=()=>{for(const p of document.querySelectorAll("[role=tabpanel]"))p.hidden=p.id!==b.getAttribute("aria-controls")});
wire();document.addEventListener("atelier:state",wire);</script>
<script type="module" src="atelier.js"></script></body></html>`;

const FIXTURES = {
  good: page(),
  // <body> itself is the grid: the Kernel's own <body> children take grid cells and push the Page's columns along.
  "broken-grid": page({ css: "body{display:grid;grid-template-columns:240px 1fr}", body: (inner) => inner }),
  // `aside button` also hits the Kernel's buttons docked in the aside (and the panel, itself an <aside>).
  "broken-tabs": page({ css: "aside button{display:flex;justify-content:space-between;width:100%;text-align:left;margin:2px 0}", wire: "aside button" }),
  // A <div> left open in the hidden view.
  unbalanced: page({ panel2: "<div class=row><p>Gap row.</p>" }),
  // A badge placed into the grid cell of the item's main text.
  overlap: page({ css: ".item{display:grid;grid-template-columns:120px 1fr}.item>*{grid-row:1}.badge,.text{grid-column:2}", panel2: `<div class="item"><b>Name</b><span class="text">The item's main text</span><span class="badge">badge</span></div>` }),
};

function project() {
  const root = realpathSync(mkdtempSync(path.join(process.env.PI_TMP ?? tmpdir(), "atelier-page-check-")));
  for (const [name, html] of Object.entries(FIXTURES)) writeFileSync(path.join(root, `${name}.html`), html);
  return root;
}
const failing = (r) => [...r.checks.filter((c) => !c.ok).map((c) => c.name), ...r.views.filter((v) => !v.ok).map((v) => `view ${v.label}`)];

test("tagBalance finds unclosed and stray end tags, ignoring void, optional, script and self-closed tags", () => {
  assert.deepEqual(tagBalance("<div><p>a<br><img src=x><svg><path d='a>b'/></svg></div><script>'<div>'</script><li>x"), { unclosed: [], stray: [] });
  const r = tagBalance("<main>\n<section><div class=row>\n</section></main></span>");
  assert.deepEqual(r.unclosed, [{ name: "div", line: 2 }]);
  assert.deepEqual(r.stray, [{ name: "span", line: 3 }]);
});

test("the Page check flags each real defect by its measured check and passes the good Page", { skip: noBrowser, timeout: 300_000 }, async () => {
  const root = project();
  try {
    const results = {};
    for (const name of Object.keys(FIXTURES)) results[name] = await checkPage(path.join(root, `${name}.html`));
    for (const [name, r] of Object.entries(results)) assert.deepEqual(r.unchecked.filter((u) => u.startsWith("browser")), [], `${name}: ${formatCheck(r)}`);
    assert.equal(results.good.status, "pass", formatCheck(results.good));
    assert.equal(results.good.views.length, 3, "initial view and both tabs");
    assert(results.good.views.every((v) => !v.screenshot || existsSync(v.screenshot)), "screenshots exist");
    assert.match(results.good.checks.find((c) => c.name === "Kernel version").detail, /^page (\S+), host \1; Event Log loaded, 1 Decision/);
    assert.deepEqual(failing(results["broken-grid"]), ["Kernel layout"], formatCheck(results["broken-grid"]));
    assert.match(results["broken-grid"].checks.find((c) => c.name === "Kernel layout").detail, /move Page content: aside/);
    assert.deepEqual(failing(results["broken-tabs"]), ["Kernel controls"], formatCheck(results["broken-tabs"]));
    assert.match(results["broken-tabs"].checks.find((c) => c.name === "Kernel controls").detail, /via `aside button`.*Page onclick on \d+ Kernel control/);
    assert.deepEqual(failing(results.unbalanced), ["HTML balance"], formatCheck(results.unbalanced));
    assert.deepEqual(failing(results.overlap), ["view Two"], formatCheck(results.overlap));
    assert.match(formatCheck(results.overlap), /1 text overlap\(s\): span\.text × span\.badge/);
    assert.deepEqual(readdirSync(root).filter((f) => f.includes("atelier-check")), [], "test copies and their logs are gone");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("open, update and check on the atelier tool append the Page check; a missing agent-browser leaves it unchecked", { skip: noBrowser, timeout: 120_000 }, async () => {
  const root = project();
  const tools = new Map(), handlers = {};
  atelierExtension({ registerTool: (t) => tools.set(t.name, t), on: (n, fn) => { handlers[n] = fn; }, sendMessage: () => {} });
  const ctx = { cwd: root, isIdle: () => true, sessionManager: { getSessionId: () => `s-page-check-${process.pid}` } };
  handlers.session_start({}, ctx);
  const run = (params) => tools.get("atelier").execute("id", params, undefined, undefined, ctx);
  try {
    const opened = await run({ action: "open", page: "broken-grid.html" });
    assert.match(opened.content[0].text, /^Page open: .*\n[\s\S]*Page check \(test copy, 1512×900\): FAIL\n[\s\S]*- FAIL {2}Kernel layout: /);
    assert.equal(opened.details.check.status, "fail");
    assert.equal(existsSync(path.join(root, "broken-grid.html.events.jsonl")), false, "the Page's own Event Log is untouched");
    assert.match((await run({ action: "update", page: "broken-grid.html", text: "x" })).content[0].text, /Page check \(test copy, 1512×900\): FAIL/);
    assert.match((await run({ action: "check", page: "good.html" })).content[0].text, /^Page check \(test copy, 1512×900\): pass/);
    const unchecked = await checkPage(path.join(root, "good.html"), { browser: "agent-browser-missing" });
    assert.equal(unchecked.status, "unchecked");
    assert.match(formatCheck(unchecked), /unchecked: browser checks: agent-browser-missing is not installed/);
  } finally { handlers.session_shutdown(); rmSync(root, { recursive: true, force: true }); }
});
