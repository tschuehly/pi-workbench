import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import backgroundBashExtension from "./index.ts";
import { registerMonitorPolicy } from "./monitor-policy.mjs";

process.env.PI_BACKGROUND_BASH_ROOT = mkdtempSync(join(tmpdir(), "pi-background-bash-safety-"));
process.env.PI_TMP_ROOT = mkdtempSync(join(tmpdir(), "pi-safety-tmp-"));
process.env.CC_SAFETY_NET_LEVEL = "strict";
const INCIDENT = "touch launched; rm -rf $PI_SAFETY_NET_UNSET/*";

test("background bash refuses the 23 Nov command before it starts, in attended and one-shot modes", async () => {
  const tools = new Map();
  const prior = process.env.PI_WORKBENCH_EXECUTION_KIND;
  delete process.env.PI_WORKBENCH_EXECUTION_KIND;
  try { backgroundBashExtension({ registerTool: (t) => tools.set(t.name, t), on() {}, events: { on() {} } }); }
  finally { if (prior !== undefined) process.env.PI_WORKBENCH_EXECUTION_KIND = prior; }
  const cwd = mkdtempSync(join(tmpdir(), "pi-safety-cwd-"));
  for (const mode of ["rpc", "print"]) {
    const ctx = { mode, cwd, sessionManager: { getSessionId: () => "s", getSessionFile: () => undefined } };
    await assert.rejects(tools.get("bash").execute("c", { description: "Incident", command: INCIDENT }, undefined, undefined, ctx),
      /Blocked by cc-safety-net \(rm\.recursive-force-dynamic-target\)/);
  }
  assert.equal(existsSync(join(cwd, "launched")), false, "never started");
});

test("a Monitor launch of the 23 Nov command is refused; an allowed one reaches the fence", async () => {
  let policy;
  registerMonitorPolicy({ on: (_name, handler) => handler({ bind: (p) => { policy = p; }, sessionId: "s", cwd: process.cwd() }) });
  await assert.rejects(policy(INCIDENT), /Blocked by cc-safety-net/);
  const launch = await policy("rm -rf ./build");
  assert.ok(launch.file, "an allowed command gets its launch");
});
