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
    event("usage", "12:00:06", { sessionId: "root", usageKey: "root:u1", provider: "openai", model: "lead", usage: usage(10, 2) }),
    event("usage", "12:00:07", { sessionId: "root", usageKey: "root:u1", provider: "openai", model: "lead", usage: usage(10, 2) }),
    event("usage", "12:00:08", { sessionId: "child", usageKey: "child:u1", provider: "anthropic", model: "claude", usage: usage(5, null) }),
    event("agent.settled", "12:00:10", { sessionId: "root" }),
    event("execution.launched", "12:00:01", { sessionId: "root", executionId: "exec-1", kind: "subagent", task: "Review it", cognitiveRole: "independent-review", concept: "alpha", provider: "anthropic", model: "claude", effort: "high" }),
    event("execution.settled", "12:00:15", { sessionId: "root", executionId: "exec-1", childSessionId: null, outcome: "cancelled" }),
  ];

  assert.deepEqual(buildReport(events, { rootSessionId: "root" }), {
    rootSessionId: "root",
    sessionIds: ["child", "root"],
    activeMs: 15_000,
    incompleteActiveIntervals: 0,
    usage: { eventCount: 2, inputTokens: 15, outputTokens: 4, knownCost: 2, totalCost: null, unknownCostEvents: 1 },
    usageByAttribution: [
      { role: "independent-review", concept: "alpha", provider: "anthropic", model: "claude", eventCount: 1, inputTokens: 5, outputTokens: 2, knownCost: null, totalCost: null, unknownCostEvents: 1 },
      { role: "shared_lead", concept: null, provider: "openai", model: "lead", eventCount: 1, inputTokens: 10, outputTokens: 2, knownCost: 2, totalCost: 2, unknownCostEvents: 0 },
    ],
    executions: [{ executionId: "exec-1", kind: "subagent", workerId: null, task: "Review it", cognitiveRole: "independent-review", concept: "alpha", provider: "anthropic", model: "claude", effort: "high", acceptedAt: "2026-08-28T12:00:01.000Z", endedAt: "2026-08-28T12:00:15.000Z", childSessionId: "child", outcome: "cancelled" }],
    failures: 1,
    retrySignals: 0,
    studio: { concept: null, builds: [], correctionCycles: [], completedCorrectionRounds: 0 },
  });
});

test("resumed sessions count old usage identities once and new turns once", () => {
  const events = [
    event("session.start", "12:00:00", { sessionId: "worker", reason: "startup" }),
    event("usage", "12:00:01", { sessionId: "worker", usageKey: "worker:old", usage: usage(2, 1) }),
    event("session.start", "12:01:00", { sessionId: "worker", reason: "resume" }),
    event("usage", "12:01:01", { sessionId: "worker", usageKey: "worker:old", usage: usage(2, 1) }),
    event("usage", "12:01:02", { sessionId: "worker", usageKey: "worker:new", usage: usage(3, 2) }),
  ];

  const report = buildReport(events, { rootSessionId: "worker" });
  assert.equal(report.usage.eventCount, 2);
  assert.equal(report.usage.inputTokens, 5);
  assert.equal(report.usage.totalCost, 3);
});

test("joins the first delivered correction marker to the next changed draft", () => {
  const events = [
    event("session.start", "12:00:00", { sessionId: "root" }),
    event("session.start", "12:00:01", { sessionId: "creator", parentSessionId: "root", executionId: "exec-alpha" }),
    event("session.start", "12:00:01", { sessionId: "unrelated", parentSessionId: "root", executionId: "exec-beta" }),
    event("execution.launched", "12:00:01", { sessionId: "root", executionId: "exec-alpha", kind: "worker", cognitiveRole: "implementation", concept: "alpha", provider: "openai", model: "creator", effort: "high" }),
    event("execution.launched", "12:00:01", { sessionId: "root", executionId: "exec-beta", kind: "worker", cognitiveRole: "implementation", concept: "beta", provider: "openai", model: "creator", effort: "high" }),
    event("studio.comment_delivered", "12:00:00", { sessionId: "root", kind: "sent", concept: "alpha", id: "c1", seq: 7, eventTime: "2026-08-28T11:59:00.000Z" }),
    event("studio.comment_delivered", "12:00:01", { sessionId: "root", kind: "sent", concept: "alpha", id: "c1", seq: 7, eventTime: "2026-08-28T11:59:00.000Z" }),
    event("agent.start", "12:00:00", { sessionId: "root" }),
    event("agent.start", "12:00:01", { sessionId: "creator" }),
    event("agent.start", "12:00:01", { sessionId: "unrelated" }),
    event("studio.build_start", "12:00:02", { sessionId: "root", concept: "alpha", buildId: "failed", lane: "draft", gitHead: "abc" }),
    event("studio.build_settled", "12:00:03", { sessionId: "root", concept: "alpha", buildId: "failed", lane: "draft", gitHead: "abc", status: "failed", reason: "render" }),
    event("agent.settled", "12:00:04", { sessionId: "root" }),
    event("studio.build_start", "12:00:04", { sessionId: "root", concept: "alpha", buildId: "fresh", lane: "draft", gitHead: "abc" }),
    event("studio.build_settled", "12:00:05", { sessionId: "root", concept: "alpha", buildId: "fresh", lane: "draft", gitHead: "abc", status: "skipped-fresh" }),
    event("agent.start", "12:00:06", { sessionId: "root" }),
    event("studio.build_start", "12:00:07", { sessionId: "root", concept: "alpha", buildId: "changed", lane: "draft", gitHead: "def" }),
    event("studio.draft_ready", "12:00:09", { sessionId: "root", concept: "alpha", buildId: "changed", lane: "draft", gitHead: "def", sha256: "a".repeat(64), reviewAccepted: false }),
    event("studio.build_settled", "12:00:09", { sessionId: "root", concept: "alpha", buildId: "changed", lane: "draft", gitHead: "def", status: "built" }),
    event("agent.settled", "12:00:08", { sessionId: "creator" }),
    event("agent.settled", "12:00:09", { sessionId: "unrelated" }),
    event("execution.settled", "12:00:08", { sessionId: "root", executionId: "exec-alpha", childSessionId: "creator", outcome: "success" }),
    event("execution.settled", "12:00:09", { sessionId: "root", executionId: "exec-beta", childSessionId: "unrelated", outcome: "success" }),
    event("agent.settled", "12:00:10", { sessionId: "root" }),
    event("studio.comment_delivered", "12:00:00", { sessionId: "root", kind: "sent", concept: "beta", id: "c2", seq: 8 }),
  ];

  assert.deepEqual(buildReport(events, { rootSessionId: "root", concept: "alpha" }).studio, {
    concept: "alpha",
    builds: [
      { buildId: "failed", concept: "alpha", lane: "draft", sessionId: "root", gitHead: "abc", startedAt: "2026-08-28T12:00:02.000Z", endedAt: "2026-08-28T12:00:03.000Z", status: "failed", reason: "render", draftReadyAt: null, sha256: null, reviewAccepted: null },
      { buildId: "fresh", concept: "alpha", lane: "draft", sessionId: "root", gitHead: "abc", startedAt: "2026-08-28T12:00:04.000Z", endedAt: "2026-08-28T12:00:05.000Z", status: "skipped-fresh", reason: null, draftReadyAt: null, sha256: null, reviewAccepted: null },
      { buildId: "changed", concept: "alpha", lane: "draft", sessionId: "root", gitHead: "def", startedAt: "2026-08-28T12:00:07.000Z", endedAt: "2026-08-28T12:00:09.000Z", status: "built", reason: null, draftReadyAt: "2026-08-28T12:00:09.000Z", sha256: "a".repeat(64), reviewAccepted: false },
    ],
    correctionCycles: [{
      kind: "sent", id: "c1", seq: 7, concept: "alpha", eventTime: "2026-08-28T11:59:00.000Z",
      deliveredAt: "2026-08-28T12:00:00.000Z", draftReadyAt: "2026-08-28T12:00:09.000Z",
      cycleMs: 9_000, activeMs: 8_000, idleMs: 1_000, attributedAgentIntervals: 1, buildId: "changed", gitHead: "def",
      sha256: "a".repeat(64), reviewAccepted: false,
    }],
    completedCorrectionRounds: 1,
  });
});

test("root reports keep same-sequence deliveries for different concepts", () => {
  const events = [
    event("session.start", "12:00:00", { sessionId: "root" }),
    event("studio.comment_delivered", "12:00:00", { sessionId: "root", kind: "decision", concept: "alpha", id: null, seq: 1 }),
    event("studio.comment_delivered", "12:00:00", { sessionId: "root", kind: "decision", concept: "beta", id: null, seq: 1 }),
    event("studio.draft_ready", "12:00:10", { sessionId: "root", concept: "alpha", buildId: "alpha", watchable: true, sha256: "a".repeat(64) }),
    event("studio.draft_ready", "12:00:20", { sessionId: "root", concept: "beta", buildId: "beta", watchable: true, sha256: "b".repeat(64) }),
  ];

  assert.deepEqual(buildReport(events, { rootSessionId: "root" }).studio.correctionCycles.map((cycle) => cycle.concept), ["alpha", "beta"]);
});

test("correction cycles ignore other concepts' build intervals", () => {
  const events = [
    event("session.start", "12:00:00", { sessionId: "root" }),
    event("studio.comment_delivered", "12:00:00", { sessionId: "root", kind: "sent", concept: "alpha", id: "c1", seq: 1 }),
    event("studio.build_start", "12:00:01", { sessionId: "root", concept: "beta", buildId: "beta", lane: "draft" }),
    event("studio.build_settled", "12:00:09", { sessionId: "root", concept: "beta", buildId: "beta", lane: "draft", status: "built" }),
    event("studio.draft_ready", "12:00:10", { sessionId: "root", concept: "alpha", buildId: "alpha", watchable: true, sha256: "a".repeat(64) }),
  ];

  const cycle = buildReport(events, { rootSessionId: "root" }).studio.correctionCycles[0];
  assert.equal(cycle.activeMs, null);
  assert.equal(cycle.idleMs, null);
});

test("unwatchable changed drafts do not close correction cycles", () => {
  const events = [
    event("session.start", "12:00:00", { sessionId: "root" }),
    event("studio.comment_delivered", "12:00:00", { sessionId: "root", kind: "sent", concept: "alpha", id: "c1", seq: 1 }),
    event("studio.draft_ready", "12:00:05", { sessionId: "root", concept: "alpha", buildId: "hidden", watchable: false, sha256: "b".repeat(64) }),
  ];

  assert.equal(buildReport(events, { rootSessionId: "root" }).studio.correctionCycles[0].draftReadyAt, null);
});

test("root reports exclude session-less events and keep unknown token fields null", () => {
  const events = [
    event("session.start", "12:00:00", { sessionId: "root-a" }),
    event("session.start", "12:00:00", { sessionId: "root-b" }),
    event("usage", "12:00:01", { sessionId: "root-a", usageKey: "partial", provider: "openai", model: "test", usage: { input: 3, cost: {} } }),
    event("studio.build_start", "12:00:02", { sessionId: null, concept: "leak", buildId: "leak", lane: "draft" }),
  ];

  const report = buildReport(events, { rootSessionId: "root-a" });
  assert.deepEqual(report.usage, { eventCount: 1, inputTokens: 3, outputTokens: null, knownCost: null, totalCost: null, unknownCostEvents: 1 });
  assert.deepEqual(report.studio.builds, []);
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
