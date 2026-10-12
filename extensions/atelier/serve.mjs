#!/usr/bin/env node
// Runs the real Atelier host (host.ts, the code behind the `atelier` tool) for one Page without a Pi session, so a
// builder without the tool can test persistence, Delivery and Updates before the Page reaches the human:
//   cd <project> && node <pi-workbench>/extensions/atelier/serve.mjs <page.html>
// It copies the Kernel beside the Page, serves it like `open`, appends human events to <page>.events.jsonl, prints
// every Delivery to stdout exactly as the agent would receive it, and sends an Update to open tabs whenever the Page
// file changes. Ctrl-C stops it and releases the Page. Point it at a copy if the real Event Log must stay untouched.
import { readFileSync, realpathSync, statSync, watch } from "node:fs";
import path from "node:path";

const arg = process.argv[2];
if (!arg || arg.startsWith("-")) { console.error("Usage: node serve.mjs <page.html>  (run from the project directory)"); process.exit(2); }
let page;
try { page = realpathSync(path.resolve(arg)); if (!statSync(page).isFile()) throw new Error(); } catch { console.error(`No Page file at ${arg}.`); process.exit(2); }

process.removeAllListeners("warning"); // Node's notice that host.ts is TypeScript in a typeless package
const { createHost } = await import("./host.ts");
const host = createHost({
  root: process.cwd(),
  sessionId: `serve-${process.pid}`,
  // No session to confirm receipt: printing it is the receipt.
  send: (message, done) => { console.log(`${message.content}\n`); done(true); host.receipt(message.details); },
});
const stop = () => { host.stop(); process.exit(0); };
process.on("SIGINT", stop).on("SIGTERM", stop);

let opened;
try { opened = await host.open(page); } catch (error) { console.error(String(error.message ?? error)); host.stop(); process.exit(1); }
console.log(`Page open: ${opened.url}`);
console.log(`Kernel: ${opened.kernel.map(({ file, outcome }) => `${file} ${outcome}`).join(", ")}`);

// Watch the directory, not the file: editors and agents replace the file, which ends a file watch.
let text = readFileSync(page, "utf8"), timer;
watch(path.dirname(page), (_event, name) => {
  if (name !== path.basename(page)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    let next;
    try { next = readFileSync(page, "utf8"); } catch { return; } // mid-replace
    if (next === text) return;
    text = next;
    console.log(`Update sent to ${host.update(page)} tab(s).`);
  }, 150);
});
