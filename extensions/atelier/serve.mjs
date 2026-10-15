#!/usr/bin/env node
// Runs the real Atelier host (host.ts, the code behind the `atelier` tool) for one Page without a Pi session, so a
// builder without the tool can test persistence, Delivery and Updates before the Page reaches the human:
//   cd <project> && node <pi-workbench>/extensions/atelier/serve.mjs <page.html>
// It serves a test copy beside the Page (<name>.atelier-test.html, so the Page's relative files still load) with its
// own empty Event Log: the Page's real Event Log and the human input waiting in it are never read or touched. The
// Kernel shows "Test host, no Pi session". It prints every Delivery to stdout exactly as the agent would receive it,
// and copies the Page and sends an Update to open tabs whenever the Page file changes. Ctrl-C stops it and deletes
// the copy, its log and its images.
import { readFileSync, realpathSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import path from "node:path";

const arg = process.argv[2];
if (!arg || arg.startsWith("-")) { console.error("Usage: node serve.mjs <page.html>  (run from the project directory)"); process.exit(2); }
let page;
try { page = realpathSync(path.resolve(arg)); if (!statSync(page).isFile()) throw new Error(); } catch { console.error(`No Page file at ${arg}.`); process.exit(2); }

process.removeAllListeners("warning"); // Node's notice that host.ts is TypeScript in a typeless package
const { createHost, imagesDir, logPath } = await import("./host.ts");
const copy = page.replace(/(\.html?)?$/i, ".atelier-test$1");
// ponytail: two serve.mjs on one Page share and clobber this copy; run one per Page.
const clean = () => { for (const file of [copy, logPath(copy), `${logPath(copy)}.lock`, imagesDir(copy)]) rmSync(file, { force: true, recursive: true }); };
let text = readFileSync(page, "utf8"), timer;
clean();
writeFileSync(copy, text);
const host = createHost({
  root: process.cwd(),
  sessionId: `serve-${process.pid}`,
  test: true,
  // No session to confirm receipt: printing it is the receipt.
  send: (message, done) => { console.log(`${message.content}\n`); done(true); host.receipt(message.details); },
});
const stop = () => { host.stop(); clean(); process.exit(0); };
process.on("SIGINT", stop).on("SIGTERM", stop);

let opened;
try { opened = await host.open(copy); } catch (error) { console.error(String(error.message ?? error)); host.stop(); clean(); process.exit(1); }
console.log(`Page open: ${opened.url}`);
console.log(`Test copy: ${path.basename(copy)}, Event Log ${path.basename(logPath(copy))}; the Page's own Event Log is untouched.`);
console.log(`Kernel: ${opened.kernel.map(({ file, outcome }) => `${file} ${outcome}`).join(", ")}`);

// Watch the directory, not the file: editors and agents replace the file, which ends a file watch.
watch(path.dirname(page), (_event, name) => {
  if (name !== path.basename(page)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    let next;
    try { next = readFileSync(page, "utf8"); } catch { return; } // mid-replace
    if (next === text) return;
    text = next;
    writeFileSync(copy, text);
    console.log(`Update sent to ${host.update(copy)} tab(s).`);
  }, 150);
});
