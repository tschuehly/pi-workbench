import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createRecorder, EXECUTION_CHANNEL } from "./telemetry.mjs";

export default function telemetryExtension(pi: ExtensionAPI) {
  registerTelemetry(pi, createRecorder());
}

export function registerTelemetry(
  pi: ExtensionAPI,
  recorder: { record(type: string, data?: Record<string, unknown>): unknown; close(): void },
  runtime: { argv?: string[]; env?: NodeJS.ProcessEnv } = {},
) {
  const argv = runtime.argv ?? process.argv;
  const env = runtime.env ?? process.env;
  let currentSessionId: string | null = null;
  const deliveredStudioMarkers = new Set<string>();
  const deliveredStudioLifecycle = new Set<string>();

  pi.on("session_start", async (event, ctx) => {
    const session = sessionData(ctx);
    currentSessionId = session.sessionId;
    recorder.record("session.start", {
      ...session,
      cwd: ctx.cwd,
      mode: ctx.mode,
      reason: event.reason,
      provider: ctx.model?.provider ?? null,
      model: ctx.model?.id ?? null,
      effort: ctx.thinkingLevel ?? null,
      argv: session.sessionFile === null ? redactArgv(argv) : null,
      parentSessionId: env.PI_TELEMETRY_PARENT_SESSION_ID ?? null,
      executionId: env.PI_TELEMETRY_EXECUTION_ID ?? null,
    });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const session = sessionData(ctx);
    recorder.record("prompt", {
      sessionId: session.sessionId,
      entryId: ctx.sessionManager.getLeafId() ?? null,
      prompt: session.sessionFile === null ? event.prompt : null,
    });
  });

  pi.on("message_start", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const text = messageText(event.message);
    for (const marker of studioWakeMarkers(text)) {
      const key = `${sessionId}:${marker.concept ?? ""}:${marker.kind}:${marker.id ?? ""}:${marker.seq}`;
      if (deliveredStudioMarkers.has(key)) continue;
      deliveredStudioMarkers.add(key);
      recorder.record("studio.comment_delivered", { sessionId, ...marker });
    }
    for (const state of studioLifecycleMarkers(text)) {
      const key = `${sessionId}:${state.concept}:${state.id}:${state.state}:${state.source}`;
      if (deliveredStudioLifecycle.has(key)) continue;
      deliveredStudioLifecycle.add(key);
      recorder.record("studio.comment_state", { sessionId, ...state });
    }
  });

  pi.on("agent_start", async (_event, ctx) => recorder.record("agent.start", sessionData(ctx)));
  pi.on("agent_settled", async (_event, ctx) => recorder.record("agent.settled", sessionData(ctx)));

  pi.on("turn_end", async (event, ctx) => {
    const message = event.message;
    if (message?.role !== "assistant" || message.usage === undefined) return;
    const sessionId = ctx.sessionManager.getSessionId();
    recordUsage(recorder, sessionId, `assistant:${message.responseId ?? `${message.timestamp}:${message.provider}:${message.model}`}`, message.usage, {
      turnIndex: event.turnIndex,
      provider: message.provider ?? null,
      model: message.model ?? null,
      stopReason: message.stopReason ?? null,
    });
    for (const result of event.toolResults ?? []) {
      if (result.usage !== undefined) recordUsage(recorder, sessionId, `tool:${result.toolCallId}:${result.timestamp}`, result.usage, { toolName: result.toolName ?? null });
    }
  });

  pi.on("session_compact", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const entry = event.compactionEntry;
    recorder.record("session.compact", { sessionId, entryId: entry?.id ?? null, reason: event.reason, willRetry: event.willRetry === true });
    if (entry?.usage !== undefined) recordUsage(recorder, sessionId, `compaction:${entry.id}`, entry.usage);
  });

  pi.on("session_tree", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const entry = event.summaryEntry;
    recorder.record("session.tree", { sessionId, entryId: entry?.id ?? null, newLeafId: event.newLeafId ?? null, oldLeafId: event.oldLeafId ?? null });
    if (entry?.usage !== undefined) recordUsage(recorder, sessionId, `branch-summary:${entry.id}`, entry.usage);
  });

  pi.on("model_select", async (event, ctx) => recorder.record("model.select", {
    sessionId: ctx.sessionManager.getSessionId(),
    provider: event.model?.provider ?? null,
    model: event.model?.id ?? null,
    effort: ctx.thinkingLevel ?? null,
    source: event.source,
  }));
  pi.on("thinking_level_select", async (event, ctx) => recorder.record("thinking.select", {
    sessionId: ctx.sessionManager.getSessionId(), effort: event.level, previousEffort: event.previousLevel ?? null,
  }));

  pi.events.on(EXECUTION_CHANNEL, (event: Record<string, unknown>) => {
    const { type, ...data } = event;
    if (typeof type === "string") recorder.record(type, { ...data, sessionId: data.sessionId ?? currentSessionId });
  });

  const orchestrationTools = new Set(["subagent_collect", "subagent_status", "subagent_cancel", "worker_create", "worker_status", "worker_retire"]);
  pi.on("tool_execution_start", async (event, ctx) => {
    if (!orchestrationTools.has(event.toolName)) return;
    recorder.record("orchestration.start", {
      sessionId: ctx.sessionManager.getSessionId(), toolCallId: event.toolCallId,
      operation: event.toolName, args: event.args,
    });
  });
  pi.on("tool_execution_end", async (event, ctx) => {
    if (!orchestrationTools.has(event.toolName)) return;
    const details = (event.result as { details?: Record<string, unknown> } | undefined)?.details ?? {};
    recorder.record("orchestration.end", {
      sessionId: ctx.sessionManager.getSessionId(), toolCallId: event.toolCallId,
      operation: event.toolName, isError: event.isError === true,
      executionId: details.executionId ?? null, workerId: details.workerId ?? null, outcome: details.outcome ?? null,
    });
  });

  pi.on("session_shutdown", async (event, ctx) => {
    recorder.record("session.shutdown", { ...sessionData(ctx), reason: event.reason });
    recorder.close();
  });
}

function sessionData(ctx: ExtensionContext) {
  return {
    sessionId: ctx.sessionManager.getSessionId(),
    sessionFile: ctx.sessionManager.getSessionFile() ?? null,
  };
}

function studioWakeMarkers(prompt: string) {
  const prefix = "PI_TELEMETRY_STUDIO_V1 ";
  const markers = [];
  for (const line of prompt.split(/\r?\n/)) {
    const offset = line.indexOf(prefix);
    if (offset < 0) continue;
    try {
      const value = JSON.parse(line.slice(offset + prefix.length));
      if (value?.version !== 1 || value.type !== "studio.review_wake" || typeof value.kind !== "string" || !Number.isInteger(value.seq)) continue;
      if (value.concept !== null && typeof value.concept !== "string") continue;
      if (value.id !== null && typeof value.id !== "string") continue;
      if (value.eventTime !== null && typeof value.eventTime !== "string") continue;
      markers.push({ kind: value.kind, concept: value.concept, id: value.id, seq: value.seq, eventTime: value.eventTime });
    } catch {}
  }
  return markers;
}

function studioLifecycleMarkers(prompt: string) {
  const prefix = "PI_TELEMETRY_STUDIO_LIFECYCLE_V1 ";
  const markers = [];
  for (const line of prompt.split(/\r?\n/)) {
    const offset = line.indexOf(prefix);
    if (offset < 0) continue;
    try {
      const value = JSON.parse(line.slice(offset + prefix.length));
      if (value?.version !== 1 || value.type !== "studio.comment_state" || value.state !== "accepted" || value.source !== "human") continue;
      if (typeof value.concept !== "string" || typeof value.id !== "string") continue;
      markers.push({ concept: value.concept, id: value.id, state: value.state, source: value.source });
    } catch {}
  }
  return markers;
}

function messageText(message: { content?: unknown }) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n");
}

function recordUsage(recorder: { record(type: string, data?: Record<string, unknown>): unknown }, sessionId: string, identity: string, usage: unknown, extra = {}) {
  recorder.record("usage", { sessionId, usageKey: `${sessionId}:${identity}`, usage, ...extra });
}

function redactArgv(argv: string[]) {
  const sensitive = /(?:api[-_]?key|auth|password|secret|token)/i;
  let redactNext = false;
  return argv.map((argument) => {
    if (redactNext) { redactNext = false; return "[REDACTED]"; }
    const equals = argument.indexOf("=");
    const name = equals < 0 ? argument : argument.slice(0, equals);
    if (!sensitive.test(name)) return argument;
    if (equals >= 0) return `${name}=[REDACTED]`;
    redactNext = true;
    return argument;
  });
}
