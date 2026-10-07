// Real-browser check of the Kernel's human controls (decision 155). Needs agent-browser and PI_TMP:
//   node extensions/atelier/kernel-check.mjs [screenshot.png]
// Serves a light Page through the real host and drives it with real pointer and keyboard input.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createHost, readLog } from "./index.ts";

const run = promisify(execFile), session = `atelier-kernel-${process.pid}`;
assert(process.env.PI_TMP, "Set PI_TMP to a disposable directory.");
const dir = await realpath(await mkdtemp(path.join(process.env.PI_TMP, "atelier-kernel-")));
const page = path.join(dir, "page.html");
await writeFile(page, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Kernel check</title>
<style>body{font:15px/1.5 system-ui;max-width:700px;margin:24px auto;background:#fff;color:#111}section,div[atl-key],p[atl-key]{border:1px solid #ccc;padding:8px;margin:8px 0}</style>
<body><p id="intro">Select this sentence to comment on the text itself.</p>
<p atl-key="plain" id="plain">A plain keyed paragraph.</p>
<section atl-key="run" atl-ver="v1" id="run"><h2>Run</h2>
<div atl-key="turn-1" id="t1" atl-decide="1|2|3|4|5">Turn one answer text.</div>
<div atl-key="turn-2" id="t2" atl-decide="Confirm|Redo" atl-rec="Confirm" atl-note="Redo">Turn two answer.</div></section>
<table><tr atl-key="row-a" id="ra" atl-decide="Keep|Drop"><td>Row A</td><td atl-slot id="slot"></td></tr></table>
<script type="module" src="atelier.js"></script></body></html>`);
const sent = [];
const host = createHost({ root: dir, undoMs: 3000, send: (m, done) => { sent.push(m.content); done(true); } });
const b = async (...args) => { const { stdout } = await run("agent-browser", ["--session", session, "--json", ...args], { timeout: 60_000 }); const r = JSON.parse(stdout); assert(r.success, JSON.stringify(r)); return r.data; };
const js = async (code) => (await b("eval", code)).result;
const until = (code) => b("wait", "--fn", code);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decides = () => readLog(page).filter((e) => e.type === "decide");
const box = async (sel) => js(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right}})()`);
const opacity = (key) => js(`getComputedStyle(document.querySelector('[atl-ui=pin][data-key="${key}"] .atl-add')).opacity`);
const at = (x, y) => b("mouse", "move", String(Math.round(x)), String(Math.round(y)));
const click = async (sel) => { const r = await box(sel); await at(r.x + r.w / 2, r.y + r.h / 2); await b("mouse", "down"); await b("mouse", "up"); };

try {
  const { url } = await host.open(page);
  await b("set", "media", "dark"); // the OS is dark; the Page is light, so the Kernel must stay light
  await b("open", url);
  await until("document.querySelector('.atl-conn')?.textContent==='live'");

  // Palette follows the Page, not the OS.
  assert.equal(await js("getComputedStyle(document.querySelector('[atl-ui=panel]')).backgroundColor"), "rgb(255, 255, 255)", "light panel on a light Page under a dark OS");
  // Comment button: no layout space, hidden until hover, innermost Key only, at the top-right corner.
  const withUi = (await box("#plain")).h;
  const without = await js("(()=>{const n=[...document.querySelectorAll('#plain>[atl-ui]')];n.forEach(x=>x.remove());const h=document.querySelector('#plain').getBoundingClientRect().height;n.forEach(x=>document.querySelector('#plain').append(x));return h})()");
  assert.equal(withUi, without, "Kernel UI on a Key without threads takes no layout space");
  assert.equal(await opacity("plain"), "0");
  await b("hover", "#t1"); await sleep(300);
  assert.deepEqual([await opacity("run/turn-1"), await opacity("run"), await opacity("plain")], ["1", "0", "0"], "only the innermost hovered Key shows its button");
  const [t1, pin] = [await box("#t1"), await box('[atl-ui=pin][data-key="run/turn-1"] .atl-add')];
  assert(Math.abs(t1.right - pin.right) <= 8 && Math.abs(t1.y - pin.y) <= 8, `at the top-right corner: ${JSON.stringify({ t1, pin })}`);
  assert.deepEqual(await js("[...document.querySelectorAll('[atl-ui=pin]')].map(p=>p.dataset.key).sort()"), ["plain", "row-a", "run", "run/turn-1", "run/turn-2"], "one button per Key, none for a Decision slot");
  assert.equal(await js("document.querySelector('#slot [atl-ui=decide]')!==null"), true, "row options render in its atl-slot cell");
  assert.match(await js("document.querySelector('.atl-bar').textContent"), /3 to answer/, "Page-declared Decisions count");

  // Comment through the hover button; the composer is styled from the palette.
  await b("hover", "#plain"); await sleep(300);
  await click('[atl-ui=pin][data-key="plain"] .atl-add');
  await until("document.querySelector('[atl-ui=composer] textarea')===document.activeElement");
  const look = await js(`(()=>{const s=(q)=>getComputedStyle(document.querySelector(q));const t=s('[atl-ui=composer] textarea'),v=s('[atl-ui=composer] [type=submit]'),c=s('[atl-ui=composer] [data-atl=dismiss]'),l=s('[atl-ui=composer] .atl-label');return [t.backgroundColor,t.borderTopWidth,t.borderTopColor,t.borderTopLeftRadius,t.resize,parseFloat(t.minHeight)>=60,v.backgroundColor,v.color,c.backgroundColor,c.borderTopLeftRadius===v.borderTopLeftRadius&&c.height===v.height,l.color]})()`);
  assert.deepEqual(look, ["rgb(255, 255, 255)", "1px", "rgb(9, 105, 218)", "8px", "vertical", true, "rgb(9, 105, 218)", "rgb(255, 255, 255)", "rgb(255, 255, 255)", true, "rgb(89, 99, 110)"], "composer: page background, accent focus border, 8px radius, accent Save, quiet Cancel, muted label");
  await b("keyboard", "type", "Needs a source.");
  await click("[atl-ui=composer] [type=submit]");
  await until("document.querySelector('[atl-ui=key][data-key=plain] .atl-msg')!==null");
  const root = readLog(page).find((e) => e.type === "comment");
  host.agent(page, { type: "answer", target: root.seq, text: "Added the source." });
  await until("document.querySelectorAll('[atl-ui=key][data-key=plain] .atl-msg').length===2");
  assert.deepEqual(await js("[...document.querySelectorAll('[atl-ui=key][data-key=plain] .atl-msg')].map(m=>[m.className,m.querySelector('b').textContent])"), [["atl-msg atl-you", "You"], ["atl-msg atl-agent", "Agent"]], "whole thread in order, You and Agent distinct");
  await b("mouse", "move", "1", "1"); await sleep(300);
  assert.equal(await opacity("plain"), "1", "a Key with threads keeps its count badge");
  assert.equal(await js("document.querySelector('[atl-ui=pin][data-key=plain] .atl-add').textContent"), "1");

  // Selection: a real drag shows the floating Comment button beside it.
  const intro = await box("#intro");
  await at(intro.x + 2, intro.y + intro.h / 2); await b("mouse", "down");
  await at(intro.x + 120, intro.y + intro.h / 2); await b("mouse", "up");
  await until("!document.querySelector('[atl-ui=sel]').hidden");
  await click("[atl-ui=sel]");
  await until("document.querySelector('[atl-ui=composer] .atl-label')?.textContent.startsWith('Comment on “Select')");
  await click("[atl-ui=composer] [data-atl=dismiss]");

  // A Page-declared Decision: the first answer is delivered; a change inside the next undo window replaces the
  // unsent one, so the agent gets one "3 → 5" (156).
  const choose = async (v) => { await click(`[data-atl=decide][data-id="run/turn-1"][data-label="${v}"]`); await until(`document.querySelector('[data-id="run/turn-1"][data-label="${v}"]').classList.contains('atl-chosen')`); };
  await choose("3"); await sleep(3100); host.deliverDue(page);
  await choose("4"); await choose("5");
  assert.deepEqual(decides().map((e) => [e.decision, e.option, e.previous, e.options, e.ver]), [["run/turn-1", "3", undefined, "1|2|3|4|5", "v1"], ["run/turn-1", "4", "3", "1|2|3|4|5", "v1"], ["run/turn-1", "5", "3", "1|2|3|4|5", "v1"]]);
  assert.deepEqual(readLog(page).filter((e) => e.type === "undo").map((e) => e.target), [decides()[1].seq], "the unsent 4 is undone");
  assert.match(await js("document.querySelector('[atl-ui=decide] .atl-dstate').textContent"), /Your answer: 5 · changed from 3/);
  assert.match(await js("document.querySelector('.atl-bar').textContent"), /2 to answer/);

  // atl-note: Redo needs a note; nothing posts without it, Enter posts it with the note.
  await click('[data-atl=decide][data-id="run/turn-2"][data-label="Redo"]');
  await sleep(300);
  assert.equal(decides().length, 3, "no event without the note");
  assert.equal(await js("document.activeElement.matches('[atl-ui=decide] .atl-note')"), true, "the note field opens and takes focus");
  await b("keyboard", "type", "blurry"); await b("press", "Enter");
  await until("document.querySelector('[data-id=\"run/turn-2\"][data-label=Redo]').classList.contains('atl-chosen')");
  assert.deepEqual(decides().at(-1), { ...decides().at(-1), option: "Redo", note: "blurry", rec: "Confirm" });

  // Keyboard: Tab reaches a Key's Comment button, which then shows at its corner.
  await b("mouse", "move", "1", "1");
  await js("document.querySelector('[data-id=\"row-a\"][data-label=Drop]').focus(); true");
  await b("press", "Tab"); await sleep(300);
  assert.equal(await js("document.activeElement.closest('[atl-ui=pin]')?.dataset.key"), "row-a");
  assert.equal(await opacity("row-a"), "1", "focus shows the button");
  const [row, rowPin] = [await box("#ra"), await box('[atl-ui=pin][data-key="row-a"] .atl-add')];
  assert(Math.abs(row.right - rowPin.right) <= 8 && Math.abs(row.y - rowPin.y) <= 8, "at the row's corner");

  await sleep(3200); host.deliverDue(page);
  assert.match(sent.join("\n"), /Decision run\/turn-1 \(version v1\): 3 → 5\n/, `delivery: ${sent.join("\n")}`);
  if (process.argv[2]) await b("screenshot", process.argv[2]);
  assert.deepEqual((await b("errors")).errors ?? [], [], "no browser errors");
  console.log("PASS Kernel browser check: palette, hover button, badge, composer, thread, selection, keyboard, Decision replaced inside its undo window, required note.");
} finally {
  await b("close").catch(() => {}); host.stop(); await rm(dir, { recursive: true, force: true });
}
