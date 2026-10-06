import assert from "node:assert/strict";
import test from "node:test";
import storageGuard, { freeGb } from "./index.ts";

function load(gb) {
  process.env.PI_STORAGE_GUARD_FREE_GB = String(gb);
  const handlers = {};
  storageGuard({ on: (name, fn) => { handlers[name] = fn; } });
  return handlers;
}

test("reads real free space without the override", () => {
  delete process.env.PI_STORAGE_GUARD_FREE_GB;
  assert.ok(freeGb() > 0);
});

test("quiet above 50 GB", () => {
  const h = load(80);
  assert.equal(h.before_agent_start(), undefined);
  assert.equal(h.agent_before_settle({ outcome: "completed" }), undefined);
});

test("below 50 GB: run-start line and exactly one continuation per run end", () => {
  const h = load(30);
  assert.match(h.before_agent_start().message.content, /Disk low: 30 GB free/);
  const first = h.agent_before_settle({ outcome: "completed" });
  assert.equal(first.continue, true);
  assert.match(first.entries[0].content, /cleanup Subagent/);
  assert.equal(h.agent_before_settle({ outcome: "completed" }), undefined); // the continuation's own end
  assert.equal(h.agent_before_settle({ outcome: "completed" }).continue, true); // next run end asks again
  assert.equal(load(30).agent_before_settle({ outcome: "aborted" }), undefined);
});

test("child processes are never nudged", () => {
  process.env.PI_WORKBENCH_EXECUTION_KIND = "subagent";
  try { assert.deepEqual(load(1), {}); } finally { delete process.env.PI_WORKBENCH_EXECUTION_KIND; }
});
