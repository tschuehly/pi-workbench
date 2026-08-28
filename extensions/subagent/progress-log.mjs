const DEFAULT_MAX_ENTRIES = 10;

export function recordProgress(entries, observation, maxEntries = DEFAULT_MAX_ENTRIES) {
  const entry = {
    at: observation.at,
    key: progressKey(observation),
    text: progressText(observation),
  };
  const previous = entries.at(-1);
  if (previous?.key === entry.key) previous.at = entry.at;
  else entries.push(entry);
  while (entries.length > maxEntries) entries.shift();
}

export function renderProgressLog({ entries, startedAt, now, profile, cognitiveRole }) {
  const elapsedMs = Math.max(0, now - startedAt);
  const lines = [`Subagent ${profile} · ${cognitiveRole} · running ${formatDuration(elapsedMs)}`];
  for (const entry of entries) {
    const at = Date.parse(entry.at);
    const relative = Number.isFinite(at) ? Math.max(0, at - startedAt) : 0;
    lines.push(`${formatDuration(relative).padStart(6)}  ${entry.text}`);
  }
  const lastAt = Date.parse(entries.at(-1)?.at ?? "");
  const idleMs = Number.isFinite(lastAt) ? Math.max(0, now - lastAt) : elapsedMs;
  lines.push(`Still running · last activity ${formatDuration(idleMs)} ago`);
  return lines.join("\n");
}

export function progressText(observation) {
  if (observation.type.startsWith("tool_")) {
    return `${observation.type.replaceAll("_", " ")}: ${String(observation.detail?.toolName ?? "tool")}`;
  }
  if (observation.type === "thinking_progress") return "Child Pi is thinking…";
  if (observation.type === "assistant_progress") return "Child Pi is responding…";
  if (observation.type === "quota_degraded") return `Quota telemetry ${String(observation.detail?.telemetryStatus ?? "unavailable")}; attempting verified model launch.`;
  if (observation.type === "startup_timeout") return `Pi RPC startup timed out after ${formatDuration(Number(observation.detail?.timeoutMs ?? 0))} before prompt submission.`;
  if (observation.type === "binding_verified") return `Binding verified: ${String(observation.detail?.provider)}/${String(observation.detail?.model)}:${String(observation.detail?.effort)}`;
  if (observation.type === "terminal") return `Child ${String(observation.detail?.outcome ?? "finished")}.`;
  if (observation.type === "settlement_reconciled") return "Terminal output reconciled from idle RPC state.";
  return observation.type.replaceAll("_", " ");
}

export function activityText(observation) {
  if (observation.type.startsWith("tool_")) return String(observation.detail?.toolName ?? "tool");
  if (observation.type === "thinking_progress") return "thinking";
  if (observation.type === "assistant_progress") return "responding";
  if (observation.type === "terminal") return String(observation.detail?.outcome ?? "finished").replaceAll("_", " ");
  if (observation.type === "settlement_reconciled") return "finishing";
  if (["launch", "binding_verified", "quota_degraded"].includes(observation.type)) return "starting";
  return observation.type.replaceAll("_", " ");
}

function progressKey(observation) {
  if (observation.type === "thinking_progress" || observation.type === "assistant_progress") return observation.type;
  if (observation.type === "tool_progress") return `${observation.type}:${String(observation.detail?.toolCallId ?? observation.detail?.toolName ?? "tool")}`;
  return `${observation.type}:${String(observation.detail?.toolCallId ?? "")}`;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
