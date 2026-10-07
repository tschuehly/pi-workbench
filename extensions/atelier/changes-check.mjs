// Real-browser check of the change indicators (decision 156). Needs agent-browser and PI_TMP:
//   node extensions/atelier/changes-check.mjs [screenshot.png]
// Rewrites a Page through the real host and checks colour by kind on the spot, in the table of contents and on the
// rail, the accumulated word diff, the removed placeholder, the hidden-tab mark, and clearing after 5 s in view.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createHost } from "./index.ts";

const run = promisify(execFile), session = `atelier-changes-${process.pid}`;
assert(process.env.PI_TMP, "Set PI_TMP to a disposable directory.");
const dir = await realpath(await mkdtemp(path.join(process.env.PI_TMP, "atelier-changes-")));
const page = path.join(dir, "page.html");
const filler = "<p>Filler text so the sections need scrolling.</p>".repeat(14);
const write = ({ intro = "Comments wait for Send and go out together.", extra = "", table = true, tab = "Events are lines in a log file." } = {}) => writeFile(page, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Changes check</title>
<style>body{font:15px/1.5 system-ui;max-width:700px;margin:24px auto 24px 220px;background:#fff;color:#111}nav.toc{position:fixed;left:16px;top:24px;display:grid}[role=tabpanel][hidden]{display:none}</style>
<body><nav class="toc"><a href="#how">How it works</a><a href="#catalogue">Catalogue</a><a href="#proto">Protocol</a></nav>
<section id="how" atl-key="how"><h2>How it works</h2><p atl-key="intro" id="intro">${intro}</p>${extra}${filler}</section>
<section id="catalogue" atl-key="catalogue"><h2>Catalogue</h2>${table ? `<table atl-key="blocks" id="blocks"><tr><th>Block</th><th>Use</th></tr><tr><td>decision</td><td>ask a question</td></tr></table>` : ""}<p atl-key="after-table" id="after-table">After the table.</p>${filler}</section>
<section id="proto" atl-key="proto"><h2>Protocol</h2><button role="tab" id="tab-flow" aria-controls="p-flow">Flow</button><button role="tab" id="tab-log" aria-controls="p-log">Log</button>
<div role="tabpanel" id="p-flow"><p>The flow.</p></div><div role="tabpanel" id="p-log" hidden><p atl-key="log" id="log">${tab}</p></div>${filler}</section>
<script>document.addEventListener("click",(e)=>{const t=e.target.closest("[role=tab]");if(!t)return;for(const p of document.querySelectorAll("[role=tabpanel]"))p.hidden=p.id!==t.getAttribute("aria-controls")});</script>
<script type="module" src="atelier.js"></script></body></html>`);
await write();
const host = createHost({ root: dir, send: () => {} });
const b = async (...args) => { const { stdout } = await run("agent-browser", ["--session", session, "--json", ...args], { timeout: 60_000 }); const r = JSON.parse(stdout); assert(r.success, JSON.stringify(r)); return r.data; };
const js = async (code) => (await b("eval", code)).result;
const until = (code) => b("wait", "--fn", code);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const update = async (opts, note) => { await write(opts); host.update(page, note); await sleep(600); };
const marks = () => js(`JSON.stringify({
  spot: [...document.querySelectorAll("[atl-ui=mark]")].map((m) => [m.parentElement.closest("[id]")?.id, m.className.match(/atl-k-(\\w+)/)[1], m.classList.contains("atl-mark-bar") ? "bar" : "dot"]),
  toc: [...document.querySelectorAll("nav.toc a")].filter((a) => a.querySelector(".atl-dot")).map((a) => [a.textContent, a.querySelector(".atl-dot").className.match(/atl-k-(\\w+)/)[1]]),
  rail: [...document.querySelectorAll("[atl-ui=rail] button")].map((r) => [r.className.replace("atl-k-", ""), r.title.split("\\n")[0]]),
  gone: document.querySelectorAll("[atl-ui=gone]").length })`).then(JSON.parse);
const scrollTo = (id) => js(`document.getElementById("${id}").scrollIntoView({block:"start"}); true`);

try {
  const { url } = await host.open(page);
  await b("set", "viewport", "1280", "800");
  await b("open", url);
  await until("document.querySelector('.atl-conn')?.textContent==='live'");
  // Read the whole Page once (the Log tab too), then go to the bottom so nothing changed is in view.
  for (const id of ["intro", "blocks", "after-table"]) { await scrollTo(id); await sleep(200); }
  await js(`document.getElementById("tab-log").click(); document.getElementById("log").scrollIntoView(); true`); await sleep(300);
  await js(`document.getElementById("tab-flow").click(); scrollTo(0, document.body.scrollHeight); true`); await sleep(200);

  // Reworded twice before seeing it: one trace, diffed against the first text, both notes newest first.
  await update({ intro: "Comments go out when saved." }, "Comments send on save");
  await update({ intro: "Comments go out when you save them." }, "Reworded again");
  let m = await marks();
  assert.deepEqual(m.spot, [["intro", "reworded", "bar"]]);
  assert.deepEqual(m.toc, [["How it works", "reworded"]]);
  assert.deepEqual(m.rail, [["reworded", "Reworded: Comments go out when you save them."]]);
  const tip = await js(`document.querySelector("[atl-ui=rail] button").title`);
  assert.match(tip, /• Reworded again\n• Comments send on save/, "notes newest first");

  // Removed table: a thin line, its original table on show. Added paragraph: green. Hidden tab: the tab gets the dot.
  await update({ intro: "Comments go out when you save them.", table: false, extra: `<p atl-key="new-p" id="new-p">A new paragraph.</p>`, tab: "Events are JSON lines." }, "Removed the table, added a paragraph");
  m = await marks();
  assert.deepEqual(m.spot.sort(), [["intro", "reworded", "bar"], ["new-p", "added", "bar"], ["tab-log", "reworded", "dot"]].sort(), JSON.stringify(m));
  assert.deepEqual(m.toc.sort(), [["Catalogue", "removed"], ["How it works", "added"], ["Protocol", "reworded"]].sort(), "one nav dot per section, coloured by the strongest kind");
  assert.equal(m.gone, 1);
  assert.equal(m.rail.length, 4);
  // A new Decision needs the human: amber, and the Catalogue nav dot takes the strongest kind.
  host.agent(page, { type: "ask", decision: { id: "keep", question: "Keep the after-table note?", key: "catalogue/after-table", options: [{ label: "Keep", consequence: "stays" }, { label: "Drop", consequence: "goes" }] } });
  await until(`document.querySelector('[atl-ui=rail] button[data-addr="catalogue/after-table"]')?.className==="atl-k-needs"`);
  assert.deepEqual((await marks()).toc.find(([name]) => name === "Catalogue"), ["Catalogue", "needs"]);
  assert.match(await js(`document.querySelector('[atl-ui=rail] button[data-addr="catalogue/after-table"]').title`), /^Needs you: .*\n• New Decision: Keep the after-table note\?/);
  await js(`document.querySelector("[atl-ui=gone] button").click(); true`);
  assert.equal(await js(`document.querySelector("[atl-ui=gone] .atl-old table tr:nth-child(2) td").textContent`), "decision", "the removed block shows as itself");

  // Show changes: the word diff against what the human last saw; closing it clears every trace of that Key.
  await scrollTo("intro"); await sleep(200);
  await js(`document.querySelector("[atl-ui=mark] button[data-addr=\\"how/intro\\"]").click(); true`);
  assert.equal(await js(`[...document.querySelectorAll("[atl-ui=diff] del")].map((n) => n.textContent).join("|")`), "wait for Send and|together.");
  assert.equal(await js(`[...document.querySelectorAll("[atl-ui=diff] ins")].map((n) => n.textContent).join("|")`), "when you save them.");
  if (process.argv[2]) await b("screenshot", process.argv[2]);
  await js(`document.querySelector("[atl-ui=diff] button").click(); true`);
  await sleep(800);
  assert.equal(await js(`document.querySelectorAll('[data-addr="how/intro"]').length`), 0, "closing the changes clears them");

  // Seen: 5 s in view clears the added paragraph (not before), the hidden-tab change only once its tab is open.
  await b("mouse", "move", "1200", "10");
  await scrollTo("new-p"); await sleep(3000);
  assert.equal(await js(`document.querySelectorAll('[data-addr="how/new-p"]').length`), 2, "still marked after 3 s: bar and rail");
  await sleep(3000);
  assert.equal(await js(`document.querySelectorAll('[data-addr="how/new-p"]').length`), 0, "cleared after 5 s in view");
  await js(`document.querySelector('[atl-ui=rail] button[data-addr="proto/log"]').click(); true`); await sleep(6500);
  assert.equal(await js(`document.getElementById("p-log").hidden`), false, "the rail opens the tab");
  assert.equal(await js(`document.querySelectorAll('[data-addr="proto/log"]').length`), 0, "cleared once read in its tab");
  assert.deepEqual((await b("errors")).errors ?? [], [], "no browser errors");
  console.log("PASS change indicators: four kinds, accumulated diff, nav and rail, removed block, hidden tab, 5 s seen.");
} finally {
  await b("close").catch(() => {}); host.stop(); await rm(dir, { recursive: true, force: true });
}
