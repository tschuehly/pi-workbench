import { completeSessionKey } from "./unified-navigation-state.js";

export function workstreamSessionKey(session) {
  if (![session?.machineId, session?.projectId, session?.workspaceId, session?.id].every(nonEmpty)) return undefined;
  return completeSessionKey({ ...session, sessionId: session.id });
}

export function selectWorkstreamSession(workstream, rememberedSessionKey) {
  const sessions = workstream?.sessions ?? [];
  return sessions.find((session) => session.status === "active"
      && (workstreamSessionKey(session) === rememberedSessionKey || session.id === rememberedSessionKey))
    ?? sessions.find((session) => session.status === "active")
    ?? sessions[0];
}

export function projectWorkstreamBrief(workstream, rememberedSessionId) {
  const sessions = workstream?.sessions ?? [];
  const humanTasks = workstream?.humanTasks ?? [];
  const resumable = selectWorkstreamSession(workstream, rememberedSessionId);

  return {
    id: workstream?.id,
    title: workstream?.title,
    revision: workstream?.revision,
    closed: workstream?.closed === true,
    closedAt: workstream?.closedAt ?? null,
    continuation: resumable === undefined ? { status: "missing", sessionId: undefined, next: undefined }
      : { status: checkpointHealth(resumable), sessionId: resumable.id, next: resumable.latestCheckpoint?.next },
    unresolvedHumanTasks: humanTasks.filter((task) => task.status === "pending" || task.status === "answered").map((task) => ({ ...task })),
    sessions: sessions.map((session) => ({
      id: session.id,
      status: session.status,
      anchor: { machineId: session.machineId, projectId: session.projectId, workspaceId: session.workspaceId },
      checkpointStatus: checkpointHealth(session),
      priorCheckpointAvailable: session.latestCheckpoint !== null && session.latestCheckpoint !== undefined && session.checkpointFailure !== null && session.checkpointFailure !== undefined,
      whatChanged: session.latestCheckpoint?.whatChanged,
      remains: session.latestCheckpoint?.remains,
      next: session.latestCheckpoint?.next,
      nextSessionPrompt: session.latestCheckpoint?.nextSessionPrompt,
      references: [...(session.latestCheckpoint?.references ?? [])],
      checkpointFailure: session.checkpointFailure,
      checkpointStaleness: session.checkpointStaleness,
      launchFailure: session.launchFailure,
    })),
    links: (workstream?.links ?? []).map((link) => ({ ...link })),
  };
}

export function checkpointHealth(session) {
  if (session.status === "failed" || session.checkpointFailure !== null && session.checkpointFailure !== undefined) return "failed";
  if (session.checkpointStaleness !== null && session.checkpointStaleness !== undefined) return "stale";
  if (session.latestCheckpoint === null || session.latestCheckpoint === undefined) return "missing";
  return "current";
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
