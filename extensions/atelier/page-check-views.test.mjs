// The Page check (check-page.mjs) on small synthetic Pages, one per defect it must catch (FAIL when measured, WARN when
// heuristic) and per false alarm it must not raise. The browser cases need agent-browser and skip without it; the rest run a stand-in agent-browser (a script that
// records what it is asked) or none at all, so cleanup, cancel, root, revision and the missing browser are always tested.
// Narrow-window and third-review view cases, split from page-check.test.mjs to run beside the others.

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

test("a narrow window: a fixed bar over content WARNs until its height is reserved; narrow overflow FAILs; Kernel controls over each other WARN", { skip: noBrowser, timeout: 300_000 }, async () => {
  const root = project(NARROW);
  try {
    const r = {};
    for (const name of Object.keys(NARROW)) r[name] = await checkPage(path.join(root, `${name}.html`));
    const why = (name) => formatCheck(r[name]);
    assert.match(why("bar-covers"), HEAD);
    assert.deepEqual(warned(r["bar-covers"]), ["view initial view"], why("bar-covers"));
    assert.match(why("bar-covers"), /possible text overlap\(s\): \w+ under div\.bar.*; at 900px wide: WARN \d possible text overlap\(s\): \w+ under div\.bar/);
    assert.equal(r["bar-reserved"].status, "pass", why("bar-reserved"));
    assert.deepEqual(failing(r["narrow-overflow"]), ["view initial view"], why("narrow-overflow"));
    assert.match(why("narrow-overflow"), /no overflow; no text overlap; at 900px wide: overflow 11\d\dpx > 900px/);
    assert.match(why("kernel-squashed"), /possible text overlap\(s\): Kernel button\S* \u00d7 button/);
    assert.deepEqual(leftovers(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const checkThird = async (name) => {
  const root = project({ [name]: THIRD[name] });
  try {
    const r = await checkPage(path.join(root, `${name}.html`));
    assert.deepEqual(r.unchecked.filter((u) => u.startsWith("browser")), [], formatCheck(r));
    assert.deepEqual(leftovers(root), []);
    return r;
  } finally { rmSync(root, { recursive: true, force: true }); }
};

test("third review, finding 1: the Kernel controls probe never changes what the next view measures", { skip: noBrowser, timeout: 120_000 }, async () => {
  const r = await checkThird("transition-leak");
  assert.deepEqual(r.views.map((v) => `${v.label}:${v.status}`), ["initial view:pass", "Show:pass"], formatCheck(r));
  assert.deepEqual(failing(r), [], formatCheck(r));
});

test("third review, finding 3: errors of a click that shows no view FAIL, and the view stays a gap", { skip: noBrowser, timeout: 120_000 }, async () => {
  const r = await checkThird("throws-on-click");
  assert.equal(r.status, "fail", formatCheck(r));
  assert.match(formatCheck(r), /- FAIL {2}Errors without a view: Broken: page: .*render failed/);
  assert.deepEqual(r.unchecked, ["view Broken: clicking it did not show #panel"]);
});

test("third review, finding 4: a Kernel layout shift behind a display:contents wrapper FAILs", { skip: noBrowser, timeout: 120_000 }, async () => {
  const r = await checkThird("contents-grid");
  assert.deepEqual(failing(r), ["Kernel layout"], formatCheck(r));
  assert.match(r.checks.find((c) => c.name === "Kernel layout").detail, /move Page content: aside/);
});
