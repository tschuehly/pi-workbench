// The Page check (check-page.mjs) on small synthetic Pages, one per defect it must catch (FAIL when measured, WARN when
// heuristic) and per false alarm it must not raise. The browser cases need agent-browser and skip without it; the rest run a stand-in agent-browser (a script that
// records what it is asked) or none at all, so cleanup, cancel, root, revision and the missing browser are always tested.
// The defect fixtures run in page-check-defects.test.mjs, the view cases in page-check-views.test.mjs.

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
import { CHECK, PI_TMP_ROOT, noBrowser, sha, HEAD, page, bare, show, absTwice, sticky, FIXTURES, THIRD, cards, NARROW, project, marked, failing, leftovers, shim, alive, tool, withCheck, warned } from "./page-check-fixtures.mjs";

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

test("second review, finding 6: a cancelled check returns before parsing; HTML balance stays linear and time-bounded", async () => {
  const deep = "<div>".repeat(10_000) + "</span>".repeat(10_000); // 120 KB: 10,000 open tags, 10,000 stray end tags
  const root = project({ large: deep });
  try {
    const cancel = new AbortController();
    cancel.abort();
    let t = Date.now();
    const r = await checkPage(path.join(root, "large.html"), { signal: cancel.signal, deadlineMs: 1, browser: "agent-browser-missing" });
    assert(Date.now() - t < 200, `aborted check took ${Date.now() - t} ms`);
    assert.equal(r.status, "unchecked");
    assert.deepEqual(r.checks, []);
    t = Date.now();
    const bal = tagBalance(deep);
    assert(Date.now() - t < 1_500, `parse took ${Date.now() - t} ms`);
    assert.deepEqual([bal.unclosed.length, bal.stray.length, bal.partial], [10_000, 10_000, undefined]);
    for (const hostile of ['<a "'.repeat(100_000), "<div".repeat(100_000), '<a b="'.repeat(100_000)]) { // tags that never end
      t = Date.now();
      tagBalance(hostile);
      assert(Date.now() - t < 1_500, `hostile parse took ${Date.now() - t} ms`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("third review, finding 2: a cancel during parsing is honoured at once", async () => {
  const root = project({ hostile: "<div".repeat(10_000) }); // 40 KB, one tag that never ends
  try {
    const cancel = new AbortController(), t = Date.now();
    setTimeout(() => cancel.abort(), 10);
    const r = await checkPage(path.join(root, "hostile.html"), { signal: cancel.signal, browser: "agent-browser-missing" });
    assert(Date.now() - t < 1_500, `cancelled check took ${Date.now() - t} ms`);
    assert.equal(r.status, "unchecked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("formatCheck stays bounded however long the measured text is", () => {
  const long = "y".repeat(50_000);
  const r = { status: "fail", viewport: "1512×900", revision: "abc", report: "/x/report.json", unchecked: [long],
    checks: [{ name: "Kernel controls", status: "warn", detail: long, screenshots: [long] }],
    views: Array.from({ length: 40 }, (_, i) => ({ label: `${i} ${long.slice(0, 50)}`, controls: long, status: "fail", errorCount: 9, errors: [long, long], overflow: null, overlaps: 0, overlapExamples: [] })) };
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

test("agent-browser sockets live in an owner-only folder under ~/.pi-workbench/run, never /tmp, short enough for macOS, removed after", async () => {
  const root = project({ page: FIXTURES.good });
  const run = path.join(homedir(), ".pi-workbench", "run");
  // macOS caps a Unix socket path at 104 bytes with its NUL; agent-browser binds <socket dir>/<session>.sock, the folder
  // is mkdtemp's atl-XXXXXX and the session atl-<8 hex>.
  const worst = Buffer.byteLength(path.join(run, "atl-XXXXXX", "atl-12345678.sock"));
  assert(worst < 104, `worst-case socket path is ${worst} bytes`);
  const long = path.join(root, "x".repeat(80)), saved = process.env.TMPDIR;
  mkdirSync(long);
  const s = shim();
  try {
    process.env.TMPDIR = long; // a session TMPDIR too long for a socket: the check must not fall back to /tmp
    s.use();
    assert.equal((await checkPage(path.join(root, "page.html"))).status, "unchecked");
    const seen = s.calls().filter((c) => c.sockets);
    assert(seen.length, JSON.stringify(s.calls()));
    const dir = seen[0].sockets;
    assert.equal(path.dirname(dir), run);
    assert.match(path.basename(dir), /^atl-/);
    assert(seen.every((c) => c.sockets === dir && c.mode === 0o700), JSON.stringify(seen));
    assert.equal(existsSync(dir), false, "the socket folder is removed");
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    s.restore(); rmSync(root, { recursive: true, force: true });
  }
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
    // Third review, finding 5: cancelled while a command hangs in the launcher's child, and close hangs too; the check
    // still ends that child, the daemon and its browser.
    s.use({ SHIM_SLOW: "close" });
    const hanging = () => s.calls().filter((c) => c.child).length, hung = hanging(), stuck = new AbortController();
    const watch = setInterval(() => { if (hanging() > hung) stuck.abort(); }, 50);
    const stuckStart = Date.now(), stopped = await checkPage(path.join(root, "page.html"), { signal: stuck.signal });
    clearInterval(watch);
    assert(Date.now() - stuckStart < 20_000, `took ${Date.now() - stuckStart} ms`);
    assert.deepEqual(stopped.unchecked.filter((u) => u.startsWith("browser")), ["browser checks: cancelled"]);
    s.use({ SHIM_SLOW: "1" });
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
    const spawned = s.calls().flatMap((c) => [c.child, c.daemon, c.browser].filter(Boolean));
    assert(s.calls().some((c) => c.child) && s.calls().some((c) => c.daemon), JSON.stringify(s.calls()));
    assert.deepEqual(spawned.filter(alive), [], "no process agent-browser started is left running");
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

test("the tool check writes screenshots and the full report to the calling session's PI_TMP folder, without setting PI_TMP", async () => {
  // An attended process (PI WEB daemon) hosts several sessions and has no process-wide PI_TMP.
  const saved = { PI_TMP: process.env.PI_TMP, PI_WORKBENCH_EXECUTION_KIND: process.env.PI_WORKBENCH_EXECUTION_KIND };
  const root = project({ page: FIXTURES.good });
  delete process.env.PI_TMP; delete process.env.PI_WORKBENCH_EXECUTION_KIND;
  const s = shim(), runs = [];
  try {
    s.use();
    for (const id of ["session-a", "session-b"]) {
      const tools = new Map(), handlers = {};
      atelierExtension({ registerTool: (t) => tools.set(t.name, t), on: (n, fn) => { handlers[n] = fn; }, sendMessage: () => {} });
      const ctx = { cwd: root, isIdle: () => true, sessionManager: { getSessionId: () => id } };
      handlers.session_start({}, ctx);
      try { runs.push([id, await withCheck(undefined, () => tools.get("atelier").execute("id", { action: "check", page: "page.html" }, undefined, undefined, ctx))]); }
      finally { handlers.session_shutdown(); }
    }
    for (const [id, res] of runs) {
      const report = res.details.check.report;
      assert(report, res.content[0].text);
      assert.equal(path.dirname(path.dirname(report)), path.join(PI_TMP_ROOT, path.basename(root), id), "in the session's own folder");
      assert(existsSync(report));
      assert.doesNotMatch(res.content[0].text, /PI_TMP is not set/);
    }
    assert.equal(process.env.PI_TMP, undefined, "no process-wide PI_TMP");
  } finally {
    s.restore();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(root, { recursive: true, force: true });
  }
});

test("third review, finding 5: a check stopped while its browser blocks leaves no browser process behind", { skip: noBrowser, timeout: 120_000 }, async () => {
  mkdirSync(path.join(homedir(), ".pi-workbench", "run"), { recursive: true, mode: 0o700 });
  const tmp = mkdtempSync(path.join(homedir(), ".pi-workbench", "run", "t-"));
  const root = project({ blocked: bare("<h1>Blocked</h1>", "", "setTimeout(() => { const end = Date.now() + 60000; while (Date.now() < end); }, 100)") });
  const ours = () => spawnSync("ps", ["eww", "-A", "-o", "pid=,command="], { encoding: "utf8", env: { PATH: process.env.PATH } }).stdout.split("\n")
    .filter((l) => l.includes(tmp) || l.includes(`atelier-check-${process.pid}-`));
  try {
    // the check puts its agent-browser sockets here; its daemon and browser carry the path
    const t = Date.now(), r = await checkPage(path.join(root, "blocked.html"), { deadlineMs: 2_500, socketRoot: tmp });
    assert.deepEqual(r.unchecked.filter((u) => u.startsWith("browser")), ["browser checks: stopped at the 2.5 s deadline"], formatCheck(r));
    assert(Date.now() - t < 30_000, `took ${Date.now() - t} ms`);
    await new Promise((res) => setTimeout(res, 1_000));
    assert.deepEqual(ours(), [], "no agent-browser or browser process of the check is left");
  } finally {
    for (const l of ours()) try { process.kill(Number(l.trim().split(" ")[0]), "SIGKILL"); } catch { /* gone */ }
    rmSync(tmp, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
  }
});

test("open, update and check on the atelier tool append the Page check, served from the project root", { skip: noBrowser, timeout: 600_000 }, async () => {
  const root = project({ "broken-grid": FIXTURES["broken-grid"], good: FIXTURES.good });
  mkdirSync(path.join(root, "pages"));
  writeFileSync(path.join(root, "data.json"), '{"title":"Project data"}');
  writeFileSync(path.join(root, "pages", "data.html"), bare("<h1>Loading</h1>", "", "fetch('../data.json').then((r)=>{if(!r.ok)throw Error('data '+r.status);return r.json()}).then((d)=>{document.querySelector('h1').textContent=d.title}).catch((e)=>console.error(e.message))"));
  const t = tool(root);
  try {
    await withCheck(undefined, async () => {
      const opened = await t.run({ action: "open", page: "broken-grid.html" });
      assert.match(opened.content[0].text, /^Page open: .*\n[\s\S]*\n\nPage check \(revision [0-9a-f]{12}, test copy at 1512×900 and 900×900\): FAIL\n[\s\S]*- FAIL {2}Kernel layout: /);
      assert.equal(opened.details.check.status, "fail");
      const shots = opened.details.check.views.map((v) => v.screenshot);
      assert(shots.length && shots.every((s) => s?.startsWith(path.join(PI_TMP_ROOT, path.basename(root)) + path.sep) && existsSync(s)), "screenshots in the session's PI_TMP folder");
      assert(existsSync(opened.details.check.report));
      assert.equal(existsSync(path.join(root, "broken-grid.html.events.jsonl")), false, "the Page's own Event Log is untouched");
      const updated = await t.run({ action: "update", page: "broken-grid.html", text: "x" });
      assert.match(updated.content[0].text, /Page check \(revision [0-9a-f]{12}, test copy at 1512×900 and 900×900\): FAIL/);
      assert.equal(updated.details.check.revision, sha(readFileSync(path.join(root, "broken-grid.html"))));
      assert.match((await t.run({ action: "check", page: "good.html" })).content[0].text, new RegExp(`${HEAD.source}pass`));
      const data = await t.run({ action: "check", page: "pages/data.html" });
      assert.equal(data.details.check.status, "pass", data.content[0].text);
    });
  } finally { t.stop(); rmSync(root, { recursive: true, force: true }); }
});
