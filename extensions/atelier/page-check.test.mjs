// The Page check (check-page.mjs) on small synthetic Pages, one per defect it must catch and per false alarm it must not
// raise. The browser cases need agent-browser and skip without it; the rest run a stand-in agent-browser (a script that
// records what it is asked) or none at all, so cleanup, cancel, root, revision and the missing browser are always tested.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import atelierExtension from "./index.ts";
import { checkPage, formatCheck, tagBalance } from "./check-page.mjs";

const CHECK = fileURLToPath(new URL("./check-page.mjs", import.meta.url));
const noBrowser = spawnSync("agent-browser", ["--version"]).status !== 0 && "agent-browser is not on PATH: Page check browser cases skipped";
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 12);
const HEAD = /^Page check \(revision [0-9a-f]{12}, test copy at 1512×900\): /;

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
// One <main> and nothing else.
const bare = (body, css = "", script = "") => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fixture</title><style>body{margin:0;font:16px/1.5 system-ui}${css}</style>
<body><main>${body}</main><script>${script}</script><script type="module" src="atelier.js"></script></body></html>`;
const show = (id, hide = "") => `onclick="document.getElementById('${id}').hidden=false${hide && `;document.getElementById('${hide}').hidden=true`}"`;
const absTwice = '<div style="position:relative;height:30px"><span style="position:absolute">COLLISION ONE</span><span style="position:absolute">COLLISION TWO</span></div>';
const sticky = (bg) => bare('<header>HEADER</header><h2>SCROLLED CONTENT</h2><div style="height:1200px"></div>', `header{position:sticky;top:0;z-index:1;height:60px;background:${bg}}h2{margin:0}`, 'addEventListener("load",()=>scrollTo(0,60))');

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
  // Finding 4: a Page rule hiding a Page panel is no Kernel restyle; a sizing rule on every button is.
  "hidden-panel": bare(`<button aria-controls="p" onclick="document.getElementById('p').classList.toggle('open')">Show</button><section id="p" atl-key="a" atl-decide="Yes|No">A hidden Decision</section>`, "#p:not(.open){display:none}"),
  sized: bare('<p atl-key="a" atl-decide="Yes|No">Decide</p>', "button{width:100%}"),
  // Finding 5: parallel rotated labels whose boxes meet; crossing ones; a header over scrolled content; a related span.
  rotated: bare('<svg width="400" height="140"><g transform="translate(100 30) rotate(45)"><text x="0" y="0">LONG LABEL ONE</text><text x="0" y="25">LONG LABEL TWO</text></g></svg>'),
  crossing: bare('<svg width="400" height="220" font-size="16"><text x="100" y="100" transform="rotate(45 175 95)">CROSSING LABEL ONE</text><text x="100" y="100" transform="rotate(-45 175 95)">CROSSING LABEL TWO</text></svg>'),
  "sticky-opaque": sticky("white"),
  "sticky-clear": sticky("transparent"),
  inline: bare('<p>FIRST WORDS <span style="position:relative;left:-100px">SECOND WORDS</span></p>'),
  // Finding 7: a nested view, one reached again by reload (Away hides Outer), and a control that shows nothing.
  nested: bare(`<button aria-controls="outer" ${show("outer")}>Outer</button><button aria-controls="nowhere">Dead</button>
<section id="outer" hidden><button aria-controls="inner" ${show("inner")}>Inner</button><button aria-controls="away" ${show("away", "outer")}>Away</button><button aria-controls="again" ${show("again")}>Again</button>
<section id="inner" hidden>${absTwice}</section><section id="again" hidden><p>Again.</p></section></section><section id="away" hidden><p>Away.</p></section>`),
  // Finding 9: one 200,000-character console error.
  bloat: bare("<h1>Loud</h1>", "", 'console.error("x".repeat(200000))'),
};

function project(fixtures = FIXTURES) {
  const root = realpathSync(mkdtempSync(path.join(process.env.PI_TMP ?? tmpdir(), "atelier-page-check-")));
  for (const [name, html] of Object.entries(fixtures)) writeFileSync(path.join(root, `${name}.html`), html);
  return root;
}
const failing = (r) => [...r.checks.filter((c) => !c.ok).map((c) => c.name), ...r.views.filter((v) => !v.ok).map((v) => `view ${v.label}`)];
const leftovers = (dir) => readdirSync(dir).filter((f) => /atelier-check-/.test(f));

// A stand-in agent-browser: logs each call to $SHIM_LOG; on `open` it fetches the test copy and ../data.json through
// the test host and logs them, then fails, so the check ends "unchecked". SHIM_SLOW hangs every command but --version
// and close; SHIM_MUTATE names a file it rewrites on the first command (the Page changing during its check).
function shim() {
  const dir = realpathSync(mkdtempSync(path.join(process.env.PI_TMP ?? tmpdir(), "atelier-shim-")));
  const log = path.join(dir, "log.jsonl"), bin = path.join(dir, "agent-browser");
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const a = process.argv.slice(2), log = (o) => appendFileSync(process.env.SHIM_LOG, JSON.stringify({ pid: process.pid, ...o }) + "\\n");
const reply = (ok) => { console.log(JSON.stringify(ok ? { success: true, data: {} } : { success: false, error: "shim" })); process.exit(0); };
if (a[0] === "--version") { console.log("shim"); process.exit(0); }
const cmd = a.includes("close") ? "close" : a[a.indexOf("--json") + 1];
log({ cmd });
if (cmd === "close") reply(true);
if (process.env.SHIM_SLOW) await new Promise((r) => setTimeout(r, 60_000));
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
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function tool(root) {
  const tools = new Map(), handlers = {};
  atelierExtension({ registerTool: (t) => tools.set(t.name, t), on: (n, fn) => { handlers[n] = fn; }, sendMessage: () => {} });
  const ctx = { cwd: root, isIdle: () => true, sessionManager: { getSessionId: () => `s-page-check-${process.pid}-${Math.random()}` } };
  handlers.session_start({}, ctx);
  return { run: (params, signal) => tools.get("atelier").execute("id", params, signal, undefined, ctx), stop: () => handlers.session_shutdown() };
}
// The check is on unless a test turns it off; restored after.
const withCheck = async (value, fn) => {
  const saved = process.env.ATELIER_PAGE_CHECK;
  if (value === undefined) delete process.env.ATELIER_PAGE_CHECK; else process.env.ATELIER_PAGE_CHECK = value;
  try { return await fn(); } finally { if (saved === undefined) delete process.env.ATELIER_PAGE_CHECK; else process.env.ATELIER_PAGE_CHECK = saved; }
};

test("tagBalance tokenizes like the HTML parser: comments only in markup, raw text, CDATA and `/>` only in SVG", () => {
  assert.deepEqual(tagBalance("<div><p>a<br><img src=x><svg><path d='a>b'/></svg></div><script>'<div>'</script><li>x"), { unclosed: [], stray: [] });
  const r = tagBalance("<main>\n<section><div class=row>\n</section></main></span>");
  assert.deepEqual(r.unclosed, [{ name: "div", line: 2 }]);
  assert.deepEqual(r.stray, [{ name: "span", line: 3 }]);
  // Finding 6: a comment opener inside a script string, CDATA in SVG, markup inside a template literal, an empty comment.
  assert.deepEqual(tagBalance('<main><script>const marker="<!--";</script><p>Valid</p><!-- real comment --></main>'), { unclosed: [], stray: [] });
  assert.deepEqual(tagBalance("<main><svg><text><![CDATA[Use <widget> here]]></text></svg></main>"), { unclosed: [], stray: [] });
  assert.deepEqual(tagBalance("<h1>Page <script>const html=`<section><p>x</p></section>`;</script></h1><!--><div></div><textarea><b></textarea><style>a::after{content:'</div>'}</style>"), { unclosed: [], stray: [] });
  // In HTML, `<div/>` stays open and CDATA is a bogus comment up to the first `>`.
  assert.deepEqual(tagBalance("<main><div/></main>").unclosed, [{ name: "div", line: 1 }]);
  assert.deepEqual(tagBalance("<main><![CDATA[<b>]]></main>"), { unclosed: [], stray: [] });
  assert.deepEqual(tagBalance("<main><svg><foreignObject><div/></foreignObject></svg></main>").unclosed, [{ name: "div", line: 1 }]);
  assert.deepEqual(tagBalance("<main><script>never closed").unclosed.map((t) => t.name), ["main", "script"]);
});

test("formatCheck stays bounded however long the measured text is", () => {
  const long = "y".repeat(50_000);
  const r = { status: "fail", viewport: "1512×900", revision: "abc", report: "/x/report.json", unchecked: [long],
    checks: [{ name: "Kernel controls", ok: false, detail: long }],
    views: Array.from({ length: 40 }, (_, i) => ({ label: `${i} ${long.slice(0, 50)}`, controls: long, ok: false, errorCount: 9, errors: [long, long], overflow: null, overlaps: 0, overlapExamples: [] })) };
  const text = formatCheck(r);
  assert(text.length < 7_000, `${text.length} chars`);
  assert.match(text, /more line\(s\) in \/x\/report\.json$/);
});

test("without agent-browser on PATH the check is unchecked, exits 0 and creates no file", () => {
  const root = project({ good: FIXTURES.good });
  const empty = path.join(root, "empty-bin");
  mkdirSync(empty);
  try {
    const cli = spawnSync(process.execPath, ["--no-warnings", CHECK, "good.html"], { cwd: root, env: { PATH: empty }, encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /: unchecked\n[\s\S]*- unchecked: browser checks: agent-browser is not installed or not on PATH/);
    assert.deepEqual(readdirSync(root).sort(), ["empty-bin", "good.html"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the check never touches files it did not create: another Page named like a test copy, its log, lock, images, a symlinked log", async () => {
  const root = project({ page: FIXTURES.good });
  const other = path.join(root, "page.atelier-check.html");
  writeFileSync(other, "<title>Other real Page</title>");
  writeFileSync(`${other}.events.jsonl.lock`, "{}");
  mkdirSync(`${other}.images`);
  writeFileSync(path.join(root, "real.log"), "KEEP");
  symlinkSync(path.join(root, "real.log"), `${other}.events.jsonl`);
  const s = shim();
  try {
    assert.equal((await checkPage(path.join(root, "page.html"), { browser: "agent-browser-missing" })).status, "unchecked");
    s.use();
    const both = await Promise.all([checkPage(path.join(root, "page.html")), checkPage(path.join(root, "page.html"))]);
    assert.deepEqual(both.map((r) => r.status), ["unchecked", "unchecked"]);
    const copies = s.calls().filter((c) => c.url).map((c) => c.url);
    assert.equal(new Set(copies).size, 2, "each check serves its own copy");
    assert.equal(readFileSync(other, "utf8"), "<title>Other real Page</title>");
    assert.equal(readFileSync(`${other}.events.jsonl`, "utf8"), "KEEP");
    assert(existsSync(`${other}.events.jsonl.lock`) && existsSync(`${other}.images`));
    assert.deepEqual(leftovers(root), []);
  } finally { s.restore(); rmSync(root, { recursive: true, force: true }); }
});

test("cancel and deadline stop the check, kill agent-browser and delete the copy; SIGTERM does the same for the CLI", { timeout: 60_000 }, async () => {
  const root = project({ page: FIXTURES.good });
  const s = shim();
  try {
    s.use({ SHIM_SLOW: "1" });
    const cancel = new AbortController(), started = Date.now();
    setTimeout(() => cancel.abort(), 300);
    const r = await checkPage(path.join(root, "page.html"), { signal: cancel.signal });
    assert(Date.now() - started < 5_000, `took ${Date.now() - started} ms`);
    assert.equal(r.status, "unchecked");
    assert.deepEqual(r.unchecked.filter((u) => u.startsWith("browser")), ["browser checks: cancelled"]);
    const late = await checkPage(path.join(root, "page.html"), { deadlineMs: 300 });
    assert.deepEqual(late.unchecked.filter((u) => u.startsWith("browser")), ["browser checks: stopped at the 0.3 s deadline"]);
    // The tool passes its own signal.
    const t = tool(root);
    try {
      const toolCancel = new AbortController();
      setTimeout(() => toolCancel.abort(), 300);
      const res = await withCheck(undefined, () => t.run({ action: "check", page: "page.html" }, toolCancel.signal));
      assert.match(res.content[0].text, /unchecked: browser checks: cancelled/);
    } finally { t.stop(); }
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(s.calls().filter((c) => c.cmd === "set" && alive(c.pid)), [], "no agent-browser left running");
    assert.deepEqual(leftovers(root), []);
    // CLI: SIGTERM while agent-browser hangs.
    const sets = () => s.calls().filter((c) => c.cmd === "set").length, before = sets();
    const cli = spawn(process.execPath, ["--no-warnings", CHECK, "page.html"], { cwd: root, env: { ...process.env } });
    while (sets() === before) await new Promise((r) => setTimeout(r, 50));
    assert.equal(leftovers(root).filter((f) => f.endsWith(".html")).length, 1, "the copy exists while the check runs");
    cli.kill("SIGTERM");
    const code = await new Promise((r) => cli.on("close", r));
    assert.equal(code, 143);
    assert.deepEqual(leftovers(root), []);
  } finally { s.restore(); rmSync(root, { recursive: true, force: true }); }
});

test("update shows the new revision at once and returns the check of exactly that revision; the check serves from the host root", async () => {
  const root = project({});
  mkdirSync(path.join(root, "pages"));
  writeFileSync(path.join(root, "data.json"), "{}");
  const file = path.join(root, "pages", "p.html");
  writeFileSync(file, "<p>v1</p>");
  const s = shim(), t = tool(root);
  try {
    const opened = await withCheck("off", () => t.run({ action: "open", page: "pages/p.html" }));
    assert.doesNotMatch(opened.content[0].text, /Page check/, "ATELIER_PAGE_CHECK=off skips it");
    const stream = await fetch(new URL("/.atelier/stream?page=pages/p.html", opened.details.url));
    const reader = stream.body.getReader();
    await reader.read(); // hello
    writeFileSync(file, "<p>v2</p>");
    s.use({ SHIM_MUTATE: file });
    const updated = await withCheck(undefined, () => t.run({ action: "update", page: "pages/p.html", text: "v2" }));
    let events = "";
    while (!events.includes("event: update")) events += new TextDecoder().decode((await reader.read()).value);
    reader.cancel();
    assert.match(updated.content[0].text, /^Update sent to 1 connected tab\(s\); the owner sees this revision now\.\n\nPage check \(revision /);
    assert.equal(updated.details.check.revision, sha("<p>v2</p>"));
    const served = s.calls().find((c) => c.url);
    assert.equal(served.page, "<p>v2</p>", "the copy holds the revision update showed, not the later file");
    assert.equal(served.data, 200, "../data.json resolves under the project root as on the live host");
    assert.match(served.url, /\/pages\/p\.atelier-check-[0-9a-f]{8}\.html$/);
    assert(updated.details.check.unchecked.some((u) => u.startsWith("revision: the Page file changed")));
  } finally { t.stop(); s.restore(); rmSync(root, { recursive: true, force: true }); }
});

test("the Page check flags each real defect by its measured check and passes the good Pages", { skip: noBrowser, timeout: 600_000 }, async () => {
  const root = project();
  try {
    const results = {};
    for (const name of Object.keys(FIXTURES)) results[name] = await checkPage(path.join(root, `${name}.html`));
    for (const [name, r] of Object.entries(results)) assert.deepEqual(r.unchecked.filter((u) => u.startsWith("browser")), [], `${name}: ${formatCheck(r)}`);
    const why = (name) => formatCheck(results[name]);
    assert.equal(results.good.status, "pass", why("good"));
    assert.deepEqual(results.good.views.map((v) => v.label), ["initial view", "Two"], "tab One shows at load");
    assert(results.good.views.every((v) => !v.screenshot || existsSync(v.screenshot)), "screenshots exist");
    assert.match(results.good.checks.find((c) => c.name === "Kernel version").detail, /^page (\S+), host \1; Event Log loaded, 1 Decision/);
    assert.deepEqual(failing(results["broken-grid"]), ["Kernel layout"], why("broken-grid"));
    assert.match(results["broken-grid"].checks.find((c) => c.name === "Kernel layout").detail, /move Page content: aside/);
    assert.deepEqual(failing(results["broken-tabs"]), ["Kernel controls"], why("broken-tabs"));
    assert.match(results["broken-tabs"].checks.find((c) => c.name === "Kernel controls").detail, /via `aside button`.*Page onclick on Kernel control/);
    assert.deepEqual(failing(results.unbalanced), ["HTML balance"], why("unbalanced"));
    assert.deepEqual(failing(results.overlap), ["view Two"], why("overlap"));
    assert.match(why("overlap"), /1 text overlap\(s\): span\.text × span\.badge/);
    // Finding 4
    assert.equal(results["hidden-panel"].status, "pass", why("hidden-panel"));
    assert.equal(results["hidden-panel"].views.length, 2);
    assert.deepEqual(failing(results.sized), ["Kernel controls"], why("sized"));
    assert.match(results.sized.checks.find((c) => c.name === "Kernel controls").detail, /\(width\).*via `button`/);
    // Finding 5
    assert.equal(results.rotated.status, "pass", why("rotated"));
    assert.equal(results["sticky-opaque"].status, "pass", why("sticky-opaque"));
    assert.deepEqual(failing(results.crossing), ["view initial view"], why("crossing"));
    assert.match(why("sticky-clear"), /1 text overlap\(s\): header × h2/);
    assert.match(why("inline"), /1 text overlap\(s\): p × span/);
    // Finding 7
    assert.deepEqual(results.nested.views.map((v) => `${v.label}:${v.ok}`), ["initial view:true", "Outer:true", "Outer › Inner:false", "Outer › Away:true", "Outer › Again:true"], why("nested"));
    assert.deepEqual(results.nested.unchecked, ["view Dead: clicking it did not show #nowhere"]);
    assert.match(why("nested"), /: FAIL, 1 view\(s\) not reached\n/);
    // Finding 9
    const bloat = results.bloat;
    assert.equal(bloat.views[0].errorCount, 1);
    assert(why("bloat").length < 3_000 && JSON.stringify(bloat).length < 5_000, `${why("bloat").length} / ${JSON.stringify(bloat).length} chars`);
    if (bloat.report) assert(JSON.parse(readFileSync(bloat.report, "utf8")).views[0].errors[0].length > 200_000, "the full report keeps the whole error");
    // Finding 1: concurrent checks of one Page do not disturb each other.
    const both = await Promise.all([checkPage(path.join(root, "good.html")), checkPage(path.join(root, "good.html"))]);
    assert.deepEqual(both.map((r) => r.status), ["pass", "pass"], both.map(formatCheck).join("\n"));
    assert.deepEqual(leftovers(root), [], "test copies and their logs are gone");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("open, update and check on the atelier tool append the Page check, served from the project root", { skip: noBrowser, timeout: 180_000 }, async () => {
  const root = project({ "broken-grid": FIXTURES["broken-grid"], good: FIXTURES.good });
  mkdirSync(path.join(root, "pages"));
  writeFileSync(path.join(root, "data.json"), '{"title":"Project data"}');
  writeFileSync(path.join(root, "pages", "data.html"), bare("<h1>Loading</h1>", "", "fetch('../data.json').then((r)=>{if(!r.ok)throw Error('data '+r.status);return r.json()}).then((d)=>{document.querySelector('h1').textContent=d.title}).catch((e)=>console.error(e.message))"));
  const t = tool(root);
  try {
    await withCheck(undefined, async () => {
      const opened = await t.run({ action: "open", page: "broken-grid.html" });
      assert.match(opened.content[0].text, /^Page open: .*\n[\s\S]*\n\nPage check \(revision [0-9a-f]{12}, test copy at 1512×900\): FAIL\n[\s\S]*- FAIL {2}Kernel layout: /);
      assert.equal(opened.details.check.status, "fail");
      assert.equal(existsSync(path.join(root, "broken-grid.html.events.jsonl")), false, "the Page's own Event Log is untouched");
      const updated = await t.run({ action: "update", page: "broken-grid.html", text: "x" });
      assert.match(updated.content[0].text, /Page check \(revision [0-9a-f]{12}, test copy at 1512×900\): FAIL/);
      assert.equal(updated.details.check.revision, sha(readFileSync(path.join(root, "broken-grid.html"))));
      assert.match((await t.run({ action: "check", page: "good.html" })).content[0].text, new RegExp(`${HEAD.source}pass`));
      const data = await t.run({ action: "check", page: "pages/data.html" });
      assert.equal(data.details.check.status, "pass", data.content[0].text);
    });
  } finally { t.stop(); rmSync(root, { recursive: true, force: true }); }
});
