import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildReport, createRecorder, readEvents } from "./telemetry.mjs";

test("records durable private JSONL events without sharing a writer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telemetry-"));
  const recorder = createRecorder({
    directory,
    processId: 42,
    fileId: "test",
    clock: () => new Date("2026-08-28T12:00:00.000Z"),
  });

  recorder.record("session.start", { sessionId: "session-1", cost: null });
  recorder.close();

  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(recorder.file)).mode & 0o777, 0o600);
  assert.deepEqual(await readEvents(directory), [{
    version: 1,
    type: "session.start",
    at: "2026-08-28T12:00:00.000Z",
    processId: 42,
    sessionId: "session-1",
    cost: null,
  }]);
  assert.equal((await readFile(recorder.file, "utf8")).endsWith("\n"), true);
});

test("concurrent processes use independent event files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telemetry-concurrent-"));
  const first = createRecorder({ directory, processId: 1, fileId: "first" });
  const second = createRecorder({ directory, processId: 2, fileId: "second" });

  first.record("session.start", { sessionId: "first" });
  second.record("session.start", { sessionId: "second" });
  first.close();
  second.close();

  assert.notEqual(first.file, second.file);
  assert.deepEqual((await readEvents(directory)).map(({ sessionId }) => sessionId).sort(), ["first", "second"]);
});

test("reports descendant usage once and unions parallel active intervals", () => {
  const events = [
    event("session.start", "12:00:00", { sessionId: "root" }),
    event("session.start", "12:00:01", { sessionId: "child", parentSessionId: "root", executionId: "exec-1" }),
    event("agent.start", "12:00:00", { sessionId: "root" }),
    event("agent.start", "12:00:05", { sessionId: "child" }),
    event("usage", "12:00:06", { sessionId: "root", usageKey: "root:u1", usage: usage(10, 2) }),
    event("usage", "12:00:07", { sessionId: "root", usageKey: "root:u1", usage: usage(10, 2) }),
    event("usage", "12:00:08", { sessionId: "child", usageKey: "child:u1", usage: usage(5, null) }),
    event("agent.settled", "12:00:10", { sessionId: "root" }),
    event("agent.settled", "12:00:15", { sessionId: "child" }),
    event("execution.launched", "12:00:01", { sessionId: "root", executionId: "exec-1", kind: "subagent", task: "Review it", provider: "anthropic", model: "claude", effort: "high" }),
    event("execution.settled", "12:00:15", { sessionId: "root", executionId: "exec-1", childSessionId: "child", outcome: "success" }),
  ];

  assert.deepEqual(buildReport(events, { rootSessionId: "root" }), {
    rootSessionId: "root",
    sessionIds: ["child", "root"],
    activeMs: 15_000,
    incompleteActiveIntervals: 0,
    usage: { eventCount: 2, inputTokens: 15, outputTokens: 4, knownCost: 2, totalCost: null, unknownCostEvents: 1 },
    executions: [{ executionId: "exec-1", kind: "subagent", task: "Review it", provider: "anthropic", model: "claude", effort: "high", acceptedAt: "2026-08-28T12:00:01.000Z", endedAt: "2026-08-28T12:00:15.000Z", childSessionId: "child", outcome: "success" }],
    failures: 0,
    retrySignals: 0,
  });
});

test("CLI prints the report for a selected root session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telemetry-cli-"));
  await writeFile(join(directory, "fixture.jsonl"), `${JSON.stringify(event("session.start", "12:00:00", { sessionId: "root" }))}\n`);
  const script = fileURLToPath(new URL("../../scripts/pi-telemetry", import.meta.url));

  const result = spawnSync(process.execPath, [script, "report", "--events-dir", directory, "--root-session", "root"], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.rootSessionId, "root");
  assert.equal(report.usage.totalCost, null);
  assert.equal(report.usage.inputTokens, null);
});

function event(type, time, data) {
  return { version: 1, type, at: `2026-08-28T${time}.000Z`, processId: 1, ...data };
}

function usage(input, totalCost) {
  return { input, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: input + 2, cost: { input: totalCost, output: 0, cacheRead: 0, cacheWrite: 0, total: totalCost } };
}
