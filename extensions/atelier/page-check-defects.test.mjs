// The Page check (check-page.mjs) on small synthetic Pages, one per defect it must catch (FAIL when measured, WARN when
// heuristic) and per false alarm it must not raise. The browser cases need agent-browser and skip without it; the rest run a stand-in agent-browser (a script that
// records what it is asked) or none at all, so cleanup, cancel, root, revision and the missing browser are always tested.
// The defect fixtures, split from page-check.test.mjs so the slowest browser test runs beside the others.

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

test("the Page check flags each real defect by its measured check and passes the good Pages", { skip: noBrowser, timeout: 1_200_000 }, async () => {
  const root = project();
  try {
    const results = {};
    // A few browsers at a time: one by one took ~3 minutes; checks of different Pages share nothing.
    const queue = Object.keys(FIXTURES);
    await Promise.all(Array.from({ length: 6 }, async () => { for (let name; (name = queue.shift());) results[name] = await checkPage(path.join(root, `${name}.html`)); }));
    for (const [name, r] of Object.entries(results)) assert.deepEqual(r.unchecked.filter((u) => u.startsWith("browser")), [], `${name}: ${formatCheck(r)}`);
    const why = (name) => formatCheck(results[name]);
    assert.equal(results.good.status, "pass", why("good"));
    assert.deepEqual(results.good.views.map((v) => v.label), ["initial view", "Two"], "tab One shows at load");
    assert(results.good.views.every((v) => !v.screenshot || existsSync(v.screenshot)), "screenshots exist");
    assert.match(results.good.checks.find((c) => c.name === "Kernel version").detail, /^page (\S+), host \1$/);
    assert.match(results.good.checks.find((c) => c.name === "Page state").detail, /read its Event Log; 1 Decision/);
    // Measured defects FAIL.
    assert.deepEqual(failing(results["broken-grid"]), ["Kernel layout"], why("broken-grid"));
    assert.match(results["broken-grid"].checks.find((c) => c.name === "Kernel layout").detail, /move Page content: aside/);
    // Heuristic ones WARN, name what they saw and the screenshot to inspect, and never fail.
    const tabs = results["broken-tabs"];
    assert.deepEqual([tabs.status, failing(tabs), warned(tabs)], ["warn", [], ["Kernel controls"]], why("broken-tabs"));
    assert.match(why("broken-tabs"), /- WARN {2}Kernel controls: .*via `div button`.*Page onclick on Kernel control.* Inspect: \S+view-00\.png[\s\S]*WARN is a heuristic/);
    assert.deepEqual([results.unbalanced.status, warned(results.unbalanced)], ["warn", ["HTML balance"]], why("unbalanced"));
    assert.match(why("unbalanced"), /- WARN {2}HTML balance: 1 unclosed.* Inspect: \S+view-00\.png/);
    assert.deepEqual([failing(results.overlap), warned(results.overlap)], [[], ["view Two"]], why("overlap"));
    assert.match(why("overlap"), /- WARN {2}Two \(#p2\): .*WARN 1 possible text overlap\(s\): span\.text × span\.badge.* — \S+view-01\.png/);
    // Finding 4
    assert.equal(results["hidden-panel"].status, "pass", why("hidden-panel"));
    assert.equal(results["hidden-panel"].views.length, 2);
    assert.deepEqual(warned(results.sized), ["Kernel controls"], why("sized"));
    assert.match(results.sized.checks.find((c) => c.name === "Kernel controls").detail, /\(width\).*via `button`/);
    // Finding 5
    assert.equal(results.rotated.status, "pass", why("rotated"));
    assert.equal(results["sticky-opaque"].status, "pass", why("sticky-opaque"));
    assert.deepEqual(warned(results.crossing), ["view initial view"], why("crossing"));
    assert.match(why("sticky-clear"), /1 possible text overlap\(s\): header × h2/);
    // 2.15.0: a sticky header at top 0 sits under the Kernel's top bar; top: var(--atl-top, 0) clears it (sticky-opaque).
    assert.deepEqual([failing(results["sticky-under-bar"]), warned(results["sticky-under-bar"])], [[], ["Top bar"]], why("sticky-under-bar"));
    assert.match(why("sticky-under-bar"), /- WARN {2}Top bar: 1 fixed or sticky Page element\(s\) sit under the Kernel top bar: header\. .* Inspect: \S+view-00\.png/);
    assert.match(why("good"), /- pass {2}Kernel layout: Kernel elements in <body> take no layout space; the top bar reserves 36px/);
    assert.deepEqual(failing(results["bar-height-shift"]), ["Kernel layout"], why("bar-height-shift"));
    assert.match(why("bar-height-shift"), /move Page content: main 0,0 \d+×36 → 0,36 /);
    assert.deepEqual(failing(results["app-full-height"]), [], why("app-full-height"));
    assert.match(why("inline"), /1 possible text overlap\(s\): p × span/);
    // Finding 7
    assert.deepEqual(results.nested.views.map((v) => `${v.label}:${v.status}`), ["initial view:pass", "Outer:pass", "Outer › Inner:warn", "Outer › Away:pass", "Outer › Again:pass"], why("nested"));
    assert.deepEqual(results.nested.unchecked, ["view Dead: clicking it did not show #nowhere"]);
    assert.match(why("nested"), /: WARN, 1 view\(s\) not reached\n[\s\S]*\nCoverage: 5 view\(s\): the initial one, then each \[aria-controls\] control's view once/);
    // Second review, finding 4: a view is its control, not its target id.
    assert.deepEqual(results["reuse-target"].views.map((v) => `${v.label}:${v.status}`), ["initial view:pass", "Good:pass", "Broken:fail"], why("reuse-target"));
    assert.match(why("reuse-target"), /- FAIL {2}Broken \(#view\): no errors; overflow 2\d{3}px > 1512px/);
    // Second review, finding 7: the returned result is capped; report.json keeps the full value.
    const long = results["long-controls"];
    assert.equal(long.views.length, 2, why("long-controls"));
    assert(JSON.stringify(long).length < 6_000, `${JSON.stringify(long).length} chars`);
    if (long.report) assert.equal(JSON.parse(readFileSync(long.report, "utf8")).views[1].controls.length, 120_000);
    // Finding 9
    const bloat = results.bloat;
    assert.equal(bloat.views[0].errorCount, 1);
    assert(why("bloat").length < 3_000 && JSON.stringify(bloat).length < 5_000, `${why("bloat").length} / ${JSON.stringify(bloat).length} chars`);
    if (bloat.report) assert(JSON.parse(readFileSync(bloat.report, "utf8")).views[0].errors[0].length > 200_000, "the full report keeps the whole error");
    // Finding 1: concurrent checks of one Page do not disturb each other.
    const both = await Promise.all([checkPage(path.join(root, "good.html")), checkPage(path.join(root, "good.html"))]);
    assert.deepEqual(both.map((r) => r.status), ["pass", "pass"], both.map(formatCheck).join("\n"));
    // Exit codes: FAIL 1; WARN only 0, warnings printed.
    const cli = (name) => spawnSync(process.execPath, ["--no-warnings", CHECK, `${name}.html`], { cwd: root, encoding: "utf8" });
    const fail = cli("broken-grid"), warn = cli("unbalanced");
    assert.equal(fail.status, 1, fail.stdout);
    assert.match(fail.stdout, /: FAIL\n/);
    assert.equal(warn.status, 0, warn.stdout);
    assert.match(warn.stdout, /: WARN\n[\s\S]*- WARN {2}HTML balance/);
    assert.deepEqual(leftovers(root), [], "test copies and their logs are gone");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
