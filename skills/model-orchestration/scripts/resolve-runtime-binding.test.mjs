#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const resolver = path.join(here, "resolve-runtime-binding.mjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-routing-test-"));
const quotaPath = path.join(temp, "quota.json");
const catalogPath = path.join(temp, "catalog.txt");

const quota = {
  generatedAt: "2026-07-30T00:00:00Z",
  providers: [
    {
      provider: "claude",
      windows: [
        { id: "five_hour", kind: "session", percentRemaining: 70, resetsAt: "later" },
        { id: "model:fable", kind: "model", percentRemaining: 80, resetsAt: "later" },
      ],
      state: { status: "fresh", stale: false, refreshedAt: "now" },
    },
    {
      provider: "codex",
      windows: [{ id: "seven_day", kind: "weekly", percentRemaining: 90, resetsAt: "later" }],
      state: { status: "fresh", stale: false, refreshedAt: "now" },
    },
  ],
};
const catalog = [
  "anthropic claude-fable-5 1M 128K yes yes",
  "anthropic claude-opus-4-8 1M 128K yes yes",
  "openai-codex gpt-5.6-sol 272K 128K yes yes",
].join("\n");

try {
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  fs.writeFileSync(catalogPath, catalog);

  const pass = JSON.parse(execFileSync(process.execPath, [resolver, "bounded-advice", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(pass.status, "pass");
  assert.equal(pass.modelBinding.provider, "anthropic");
  assert.equal(pass.modelBinding.quotaSnapshot.relevantWindows.length, 2);

  quota.providers[0].windows[0].percentRemaining = 0;
  quota.providers[0].state = {
    status: "stale",
    stale: true,
    refreshedAt: "earlier",
    error: "Claude sign-in required",
  };
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  const stale = JSON.parse(execFileSync(process.execPath, [resolver, "bounded-advice", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(stale.status, "pass");
  assert.equal(stale.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(stale.modelBinding.quotaSnapshot.telemetryStatus, "stale");
  assert.equal(stale.modelBinding.quotaSnapshot.error, "Claude sign-in required");
  assert.equal(stale.modelBinding.quotaSnapshot.relevantWindows.length, 2);

  quota.providers = quota.providers.filter((provider) => provider.provider !== "claude");
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  const unavailable = JSON.parse(execFileSync(process.execPath, [resolver, "bounded-advice", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(unavailable.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(unavailable.modelBinding.quotaSnapshot.telemetryStatus, "unavailable");
  assert.match(unavailable.modelBinding.quotaSnapshot.error, /absent/);

  fs.writeFileSync(quotaPath, "not-json");
  const unreadable = JSON.parse(execFileSync(process.execPath, [resolver, "bounded-advice", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(unreadable.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(unreadable.modelBinding.quotaSnapshot.telemetryStatus, "unavailable");
  assert.match(unreadable.modelBinding.quotaSnapshot.error, /invalid quota JSON/);

  const missing = JSON.parse(execFileSync(process.execPath, [resolver, "bounded-advice", "--quota", path.join(temp, "missing.json"), "--catalog", catalogPath], { encoding: "utf8" }));
  assert.equal(missing.modelBinding.admission, "degraded-quota-telemetry");
  assert.match(missing.modelBinding.quotaSnapshot.error, /quota snapshot unavailable/);

  const fakeBin = path.join(temp, "bin");
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, "quota-axi"), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(quota))});\nprocess.exit(1);\n`, { mode: 0o755 });
  const salvaged = JSON.parse(execFileSync(process.execPath, [resolver, "bounded-advice", "--catalog", catalogPath], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
  }));
  assert.equal(salvaged.modelBinding.admission, "degraded-quota-telemetry");
  assert.equal(salvaged.modelBinding.quotaSnapshot.telemetryStatus, "unavailable");

  quota.providers.unshift({
    provider: "claude",
    windows: [{ id: "five_hour", kind: "session", percentRemaining: 0, resetsAt: "later" }],
    state: { status: "fresh", stale: false, refreshedAt: "now" },
  });
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  const exhausted = spawnSync(process.execPath, [resolver, "bounded-advice", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(exhausted.status, 3);
  assert.match(exhausted.stderr, /quota exhausted/);

  quota.providers[0].windows[0].percentRemaining = 70;
  fs.writeFileSync(quotaPath, JSON.stringify(quota));
  fs.writeFileSync(catalogPath, "openai-codex gpt-5.6-sol");
  const absent = spawnSync(process.execPath, [resolver, "bounded-advice", "--quota", quotaPath, "--catalog", catalogPath], { encoding: "utf8" });
  assert.equal(absent.status, 3);
  assert.match(absent.stderr, /Pi model .* unavailable/);

  console.log("resolve-runtime-binding: PASS");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
