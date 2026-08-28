import { appendFileSync, chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const EXECUTION_CHANNEL = "pi-workbench:telemetry:execution";
export const DEFAULT_EVENTS_DIRECTORY = join(homedir(), ".pi", "agent", "telemetry", "events");

export function createRecorder(options = {}) {
  const directory = options.directory ?? process.env.PI_TELEMETRY_DIR ?? DEFAULT_EVENTS_DIRECTORY;
  const processId = options.processId ?? process.pid;
  const fileId = options.fileId ?? randomUUID();
  const clock = options.clock ?? (() => new Date());
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const file = join(directory, `${processId}-${fileId}.jsonl`);
  const descriptor = openSync(file, "a", 0o600);
  chmodSync(file, 0o600);
  let closed = false;

  return {
    file,
    record(type, data = {}) {
      if (closed) return false;
      appendFileSync(descriptor, `${JSON.stringify({ version: 1, type, at: clock().toISOString(), processId, ...data })}\n`);
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      closeSync(descriptor);
    },
  };
}

export function buildReport(events, options = {}) {
  const selectedSessions = selectSessions(events, options.rootSessionId);
  const selected = events.filter((event) => selectedSessions.has(event.sessionId) || (options.rootSessionId == null && event.sessionId == null));
  const usageEvents = dedupe(selected.filter((event) => event.type === "usage"), (event) => event.usageKey ?? `${event.sessionId}:${event.at}:${JSON.stringify(event.usage)}`);
  const executions = executionTimeline(selected);
  const { intervals, incomplete } = agentIntervals(selected, executions);
  const studio = studioReport(selected, intervals, executions, options.concept);
  return {
    rootSessionId: options.rootSessionId ?? null,
    sessionIds: [...selectedSessions].sort(),
    activeMs: unionDuration(intervals.map((interval) => [interval.start, interval.end])),
    incompleteActiveIntervals: incomplete,
    usage: usageSummary(usageEvents),
    usageByAttribution: usageAttribution(selected, usageEvents, executions),
    executions,
    failures: executions.filter((execution) => execution.outcome != null && execution.outcome !== "success").length,
    retrySignals: selected.filter((event) => event.type === "session.compact" && event.willRetry === true).length,
    studio,
  };
}

export async function readEvents(directory = process.env.PI_TELEMETRY_DIR ?? DEFAULT_EVENTS_DIRECTORY) {
  let files;
  try { files = (await readdir(directory)).filter((file) => file.endsWith(".jsonl")).sort(); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const events = [];
  for (const file of files) {
    const lines = (await readFile(join(directory, file), "utf8")).split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (lines[index] === "") continue;
      try { events.push(JSON.parse(lines[index])); }
      catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
    }
  }
  return events.sort((left, right) => String(left.at).localeCompare(String(right.at)));
}

function selectSessions(events, rootSessionId) {
  const starts = events.filter((event) => event.type === "session.start" && typeof event.sessionId === "string");
  if (rootSessionId == null) return new Set(starts.map((event) => event.sessionId));
  const selected = new Set([rootSessionId]);
  for (let previous = -1; previous !== selected.size;) {
    previous = selected.size;
    for (const event of starts) if (selected.has(event.parentSessionId)) selected.add(event.sessionId);
  }
  return selected;
}

function usageSummary(events) {
  const knownCosts = events.map((event) => event.usage?.cost?.total).filter(Number.isFinite);
  const unknownCostEvents = events.length - knownCosts.length;
  const total = (field) => events.length > 0 && events.every((event) => Number.isFinite(event.usage?.[field]))
    ? events.reduce((sum, event) => sum + event.usage[field], 0)
    : null;
  return {
    eventCount: events.length,
    inputTokens: total("input"),
    outputTokens: total("output"),
    knownCost: knownCosts.length === 0 ? null : knownCosts.reduce((sum, value) => sum + value, 0),
    totalCost: events.length > 0 && unknownCostEvents === 0 ? knownCosts.reduce((sum, value) => sum + value, 0) : null,
    unknownCostEvents,
  };
}

function usageAttribution(events, usageEvents, executions) {
  const groups = new Map();
  for (const event of usageEvents) {
    const at = Date.parse(event.at);
    const execution = executions
      .filter((candidate) => candidate.childSessionId === event.sessionId && Date.parse(candidate.acceptedAt) <= at && (candidate.endedAt === null || at <= Date.parse(candidate.endedAt)))
      .sort((left, right) => Date.parse(right.acceptedAt) - Date.parse(left.acceptedAt))[0];
    const binding = bindingAt(events, event.sessionId, at);
    const attribution = {
      role: execution?.cognitiveRole ?? "shared_lead",
      concept: execution?.concept ?? null,
      provider: event.provider ?? binding.provider,
      model: event.model ?? binding.model,
    };
    const key = JSON.stringify(attribution);
    if (!groups.has(key)) groups.set(key, { ...attribution, events: [] });
    groups.get(key).events.push(event);
  }
  return [...groups.values()]
    .map(({ events: grouped, ...attribution }) => ({ ...attribution, ...usageSummary(grouped) }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function bindingAt(events, sessionId, at) {
  const event = events
    .filter((candidate) => candidate.sessionId === sessionId && (candidate.type === "session.start" || candidate.type === "model.select") && Date.parse(candidate.at) <= at)
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))[0];
  return { provider: event?.provider ?? null, model: event?.model ?? null };
}

function agentIntervals(events, executions) {
  const open = new Map();
  const intervals = [];
  let incomplete = 0;
  for (const event of events) {
    const key = `${event.sessionId ?? "?"}:${event.processId ?? "?"}`;
    if (event.type === "agent.start") open.set(key, { start: Date.parse(event.at), sessionId: event.sessionId ?? null });
    if (event.type === "agent.settled") {
      const value = open.get(key);
      if (Number.isFinite(value?.start)) intervals.push({ ...value, end: Date.parse(event.at) });
      else incomplete++;
      open.delete(key);
    }
  }
  for (const value of open.values()) {
    const execution = executions
      .filter((candidate) => candidate.childSessionId === value.sessionId && candidate.endedAt !== null && Date.parse(candidate.endedAt) >= value.start)
      .sort((left, right) => Date.parse(left.endedAt) - Date.parse(right.endedAt))[0];
    if (execution === undefined) incomplete++;
    else intervals.push({ ...value, end: Date.parse(execution.endedAt) });
  }
  return { intervals, incomplete };
}

function unionDuration(intervals) {
  const sorted = intervals.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start).sort((left, right) => left[0] - right[0]);
  let total = 0;
  let current;
  for (const interval of sorted) {
    if (current === undefined || interval[0] > current[1]) {
      if (current !== undefined) total += current[1] - current[0];
      current = [...interval];
    } else current[1] = Math.max(current[1], interval[1]);
  }
  return total + (current === undefined ? 0 : current[1] - current[0]);
}

function studioReport(events, agentActiveIntervals, executions, concept) {
  const correctionKinds = new Set(["sent", "rejected", "bad", "comment-state", "decision"]);
  const builds = buildTimeline(events).filter((build) => concept == null || build.concept === concept);
  const ready = events
    .filter((event) => event.type === "studio.draft_ready" && event.watchable !== false && (concept == null || event.concept === concept))
    .sort((left, right) => String(left.at).localeCompare(String(right.at)));
  const deliveries = dedupe(
    events
      .filter((event) => event.type === "studio.comment_delivered" && correctionKinds.has(event.kind) && typeof event.concept === "string" && (concept == null || event.concept === concept))
      .sort((left, right) => String(left.at).localeCompare(String(right.at))),
    (event) => `${event.concept}:${event.kind}:${event.id ?? ""}:${event.seq}`,
  );
  const correctionCycles = deliveries.map((delivery) => {
    const start = Date.parse(delivery.at);
    const draft = ready.find((event) => event.concept === delivery.concept && Date.parse(event.at) >= start);
    if (draft === undefined) return {
      kind: delivery.kind, id: delivery.id ?? null, seq: delivery.seq, concept: delivery.concept,
      eventTime: delivery.eventTime ?? null, deliveredAt: delivery.at, draftReadyAt: null,
      cycleMs: null, activeMs: null, idleMs: null, attributedAgentIntervals: 0,
      buildId: null, gitHead: null, sha256: null, reviewAccepted: null,
    };
    const end = Date.parse(draft.at);
    const executionWindows = executions.filter((execution) => execution.concept === delivery.concept && execution.childSessionId !== null);
    const buildIntervals = builds
      .filter((build) => build.concept === delivery.concept)
      .map((build) => [Date.parse(build.startedAt), Date.parse(build.endedAt)])
      .filter(([intervalStart, intervalEnd]) => Number.isFinite(intervalStart) && Number.isFinite(intervalEnd));
    const attributedAgentIntervals = agentActiveIntervals.flatMap((interval) => executionWindows
      .filter((execution) => execution.childSessionId === interval.sessionId)
      .map((execution) => [
        Math.max(start, interval.start, Date.parse(execution.acceptedAt)),
        Math.min(end, interval.end, execution.endedAt === null ? end : Date.parse(execution.endedAt)),
      ])
      .filter(([intervalStart, intervalEnd]) => Number.isFinite(intervalStart) && Number.isFinite(intervalEnd) && intervalEnd >= intervalStart));
    const activeIntervals = [...attributedAgentIntervals, ...buildIntervals]
      .map(([intervalStart, intervalEnd]) => [Math.max(start, intervalStart), Math.min(end, intervalEnd)])
      .filter(([intervalStart, intervalEnd]) => Number.isFinite(intervalStart) && Number.isFinite(intervalEnd) && intervalEnd >= intervalStart);
    const cycleMs = end - start;
    const activeMs = activeIntervals.length === 0 ? null : unionDuration(activeIntervals);
    return {
      kind: delivery.kind, id: delivery.id ?? null, seq: delivery.seq, concept: delivery.concept,
      eventTime: delivery.eventTime ?? null, deliveredAt: delivery.at, draftReadyAt: draft.at,
      cycleMs, activeMs, idleMs: activeMs === null ? null : Math.max(0, cycleMs - activeMs),
      attributedAgentIntervals: attributedAgentIntervals.length,
      buildId: draft.buildId ?? null, gitHead: draft.gitHead ?? null, sha256: draft.sha256 ?? null,
      reviewAccepted: typeof draft.reviewAccepted === "boolean" ? draft.reviewAccepted : null,
    };
  });
  return {
    concept: concept ?? null,
    builds,
    correctionCycles,
    completedCorrectionRounds: correctionCycles.filter((cycle) => cycle.draftReadyAt !== null).length,
  };
}

function buildTimeline(events) {
  const builds = new Map();
  const get = (event) => {
    if (!builds.has(event.buildId)) builds.set(event.buildId, {
      buildId: event.buildId, concept: event.concept ?? null, lane: event.lane ?? null,
      sessionId: event.sessionId ?? null, gitHead: event.gitHead ?? null,
      startedAt: null, endedAt: null, status: null, reason: null,
      draftReadyAt: null, sha256: null, reviewAccepted: null,
    });
    return builds.get(event.buildId);
  };
  for (const event of events) {
    if (typeof event.buildId !== "string" || typeof event.type !== "string" || !event.type.startsWith("studio.")) continue;
    const build = get(event);
    if (event.type === "studio.build_start") build.startedAt = event.at;
    if (event.type === "studio.build_settled") {
      build.endedAt = event.at;
      build.status = event.status ?? null;
      build.reason = event.reason ?? null;
    }
    if (event.type === "studio.draft_ready") {
      build.draftReadyAt = event.at;
      build.sha256 = event.sha256 ?? null;
      build.reviewAccepted = typeof event.reviewAccepted === "boolean" ? event.reviewAccepted : null;
    }
  }
  return [...builds.values()].sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)));
}

function executionTimeline(events) {
  const executions = new Map();
  for (const event of events) {
    if (event.type === "execution.launched") executions.set(event.executionId, {
      executionId: event.executionId,
      kind: event.kind,
      workerId: event.workerId ?? null,
      task: event.task,
      cognitiveRole: event.cognitiveRole ?? null,
      concept: event.concept ?? null,
      provider: event.provider,
      model: event.model,
      effort: event.effort,
      acceptedAt: event.at,
      endedAt: null,
      childSessionId: null,
      outcome: null,
    });
    if (event.type === "execution.settled") {
      const execution = executions.get(event.executionId);
      if (execution !== undefined) Object.assign(execution, {
        endedAt: event.at,
        childSessionId: event.childSessionId ?? execution.childSessionId,
        outcome: event.outcome ?? null,
      });
    }
  }
  for (const event of events) {
    if (event.type !== "session.start" || typeof event.executionId !== "string" || typeof event.sessionId !== "string") continue;
    const execution = executions.get(event.executionId);
    if (execution !== undefined && execution.childSessionId === null) execution.childSessionId = event.sessionId;
  }
  return [...executions.values()].sort((left, right) => String(left.acceptedAt).localeCompare(String(right.acceptedAt)));
}

function dedupe(values, key) {
  const seen = new Set();
  return values.filter((value) => { const id = key(value); if (seen.has(id)) return false; seen.add(id); return true; });
}
