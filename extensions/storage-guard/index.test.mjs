import assert from "node:assert/strict";
import test from "node:test";
import storageGuard, { freeGb } from "./index.ts";

delete process.env.PI_WORKBENCH_EXECUTION_KIND; // hermetic when run inside a child Pi

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
});

test("below 50 GB: one run-start line per session, again only after 5 GB less, never a forced cleanup turn", () => {
  const h = load(49);
  assert.equal(h.agent_before_settle, undefined);
  assert.match(h.before_agent_start().message.content, /Disk low: 49 GB free/);
  assert.equal(h.before_agent_start(), undefined);
  process.env.PI_STORAGE_GUARD_FREE_GB = "45.5";
  assert.equal(h.before_agent_start(), undefined);
  process.env.PI_STORAGE_GUARD_FREE_GB = "44";
  assert.match(h.before_agent_start().message.content, /Disk low: 44 GB free/);
  assert.equal(h.before_agent_start(), undefined);
});

test("child processes are never nudged", () => {
  process.env.PI_WORKBENCH_EXECUTION_KIND = "subagent";
  try { assert.deepEqual(load(1), {}); } finally { delete process.env.PI_WORKBENCH_EXECUTION_KIND; }
});
