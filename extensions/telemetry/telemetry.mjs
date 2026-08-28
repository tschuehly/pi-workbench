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
  const selected = events.filter((event) => event.sessionId == null || selectedSessions.has(event.sessionId));
  const usageEvents = dedupe(selected.filter((event) => event.type === "usage"), (event) => event.usageKey ?? `${event.sessionId}:${event.at}:${JSON.stringify(event.usage)}`);
  const knownCosts = usageEvents.map((event) => event.usage?.cost?.total).filter(Number.isFinite);
  const unknownCostEvents = usageEvents.length - knownCosts.length;
  const { intervals, incomplete } = agentIntervals(selected);
  const executions = executionTimeline(selected);
  return {
    rootSessionId: options.rootSessionId ?? null,
    sessionIds: [...selectedSessions].sort(),
    activeMs: unionDuration(intervals),
    incompleteActiveIntervals: incomplete,
    usage: {
      eventCount: usageEvents.length,
      inputTokens: usageEvents.length === 0 ? null : sum(usageEvents, (event) => event.usage?.input),
      outputTokens: usageEvents.length === 0 ? null : sum(usageEvents, (event) => event.usage?.output),
      knownCost: knownCosts.length === 0 ? null : knownCosts.reduce((total, value) => total + value, 0),
      totalCost: usageEvents.length > 0 && unknownCostEvents === 0 ? knownCosts.reduce((total, value) => total + value, 0) : null,
      unknownCostEvents,
    },
    executions,
    failures: executions.filter((execution) => execution.outcome != null && execution.outcome !== "success").length,
    retrySignals: selected.filter((event) => event.type === "session.compact" && event.willRetry === true).length,
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

function agentIntervals(events) {
  const open = new Map();
  const intervals = [];
  let incomplete = 0;
  for (const event of events) {
    const key = `${event.sessionId ?? "?"}:${event.processId ?? "?"}`;
    if (event.type === "agent.start") open.set(key, Date.parse(event.at));
    if (event.type === "agent.settled") {
      const start = open.get(key);
      if (Number.isFinite(start)) intervals.push([start, Date.parse(event.at)]);
      else incomplete++;
      open.delete(key);
    }
  }
  return { intervals, incomplete: incomplete + open.size };
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

function executionTimeline(events) {
  const executions = new Map();
  for (const event of events) {
    if (event.type === "execution.launched") executions.set(event.executionId, {
      executionId: event.executionId,
      kind: event.kind,
      task: event.task,
      provider: event.provider,
      model: event.model,
      effort: event.effort,
      acceptedAt: event.at,
      endedAt: null,
      childSessionId: null,
      outcome: null,
    });
    if (event.type === "execution.settled") Object.assign(executions.get(event.executionId) ?? {}, {
      endedAt: event.at,
      childSessionId: event.childSessionId ?? null,
      outcome: event.outcome ?? null,
    });
  }
  return [...executions.values()].sort((left, right) => left.acceptedAt.localeCompare(right.acceptedAt));
}

function dedupe(values, key) {
  const seen = new Set();
  return values.filter((value) => { const id = key(value); if (seen.has(id)) return false; seen.add(id); return true; });
}

function sum(events, read) {
  return events.reduce((total, event) => total + (Number.isFinite(read(event)) ? read(event) : 0), 0);
}
