import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkbenchProjection } from "../pi-web-plugin.js";

const fixtureUrl = new URL("../fixtures/recorded-projection.json", import.meta.url);

test("accepts the deterministic recorded projection", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const projection = parseWorkbenchProjection(fixture);

  assert.equal(projection?.run.id, "run-compact-probe-001");
  assert.equal(projection?.run.revision, 7);
  assert.equal(projection?.attention.length, 1);
  assert.equal(projection?.evidence[0]?.path, "docs/pi-web-customization-plan.md");
});

test("rejects unknown versions and incomplete canonical fields", () => {
  assert.equal(parseWorkbenchProjection({ version: 2, run: {} }), undefined);
  assert.equal(parseWorkbenchProjection({
    version: 1,
    run: { id: "run-1", outcome: "Outcome", status: "active", revision: 1, authority: {} },
    attention: [],
    activity: [],
    evidence: [],
  }), undefined);
});
