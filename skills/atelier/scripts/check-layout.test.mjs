// Runs check-layout.mjs on a clean and a broken page (needs agent-browser). node --test skills/atelier/scripts/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const base = process.env.PI_TMP ?? path.join(homedir(), ".pi-workbench", "tmp");
mkdirSync(base, { recursive: true });
const dir = mkdtempSync(path.join(base, "check-layout-"));
const page = (name, body) => { const f = path.join(dir, name); writeFileSync(f, `<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0">${body}`); return f; };
const run = (file) => spawnSync("node", [path.join(import.meta.dirname, "check-layout.mjs"), file, "--out", dir], { encoding: "utf8" });

test("clean page passes, clipped and overflowing page fails", (t) => {
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clean = run(page("clean.html", `<main style="max-width:600px;padding:16px"><h1>Hello</h1><p>Short text that wraps fine.</p><button>OK</button></main>`));
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /phone 390x844: .*\.png/);

  const broken = run(page("broken.html", `<button id="cut" style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">A much too long button label</button><div id="wide" style="width:1000px">wide</div>`));
  assert.equal(broken.status, 1, broken.stdout + broken.stderr);
  assert.match(broken.stdout, /text truncated \(ellipsis\) by \d+px: body > button#cut/);
  assert.match(broken.stdout, /phone[^]*extends past viewport \(horizontal scroll\) by 610px: body > div#wide/);
  assert.doesNotMatch(broken.stdout.split("desktop")[1], /div#wide/);
});
