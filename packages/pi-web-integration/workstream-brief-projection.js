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

export function projectWorkstreamBrief(workstream, rememberedSessionKey) {
  const sessions = workstream?.sessions ?? [];
  const humanTasks = workstream?.humanTasks ?? [];
  const projectedSessions = sessions.map(projectSession);

  return {
    id: workstream?.id,
    title: workstream?.title,
    revision: workstream?.revision,
    closed: workstream?.closed === true,
    closedAt: workstream?.closedAt ?? null,
    checkpointHealth: projectedSessions.map(({ id, checkpointStatus }) => ({ sessionId: id, status: checkpointStatus })),
    continuation: projectContinuation(workstream, rememberedSessionKey),
    unresolvedHumanTasks: humanTasks.filter(isUnresolvedTask).map((task) => ({ ...task })),
    sessions: projectedSessions,
    links: (workstream?.links ?? []).map((link) => ({ ...link })),
  };
}

export function projectSessionContext(workstream, sessionId) {
  const session = (workstream?.sessions ?? []).find((candidate) => candidate.id === sessionId);
  if (session === undefined) return undefined;
  return {
    workstreamId: workstream?.id,
    revision: workstream?.revision,
    closed: workstream?.closed === true,
    session: projectSession(session),
    humanTasks: (workstream?.humanTasks ?? [])
      .filter((task) => isUnresolvedTask(task) && (task.sourceSessionId == null || task.sourceSessionId === session.id))
      .map((task) => ({ ...task })),
    links: (workstream?.links ?? []).map((link) => ({ ...link })),
  };
}

export function checkpointHealth(session) {
  if (session.checkpointFailure !== null && session.checkpointFailure !== undefined) return "failed";
  if (session.checkpointStaleness !== null && session.checkpointStaleness !== undefined) return "stale";
  if (session.latestCheckpoint === null || session.latestCheckpoint === undefined) return "missing";
  return "current";
}

function projectContinuation(workstream, rememberedSessionKey) {
  const sessions = workstream?.sessions ?? [];
  if (workstream?.closed === true) return unavailableContinuation("missing", undefined, "This Workstream is closed.");
  const resumable = sessions.filter((session) => session.status === "active" && workstreamSessionKey(session) !== undefined);
  const session = resumable.find((candidate) => workstreamSessionKey(candidate) === rememberedSessionKey) ?? resumable[0];
  if (session !== undefined) {
    const status = checkpointHealth(session);
    return {
      resumable: true,
      status,
      sessionStatus: session.status,
      sessionId: session.id,
      next: session.latestCheckpoint?.next,
      reason: status === "failed" ? failureReason(session)
        : status === "stale" ? session.checkpointStaleness?.reason
          : status === "missing" ? "No confirmed checkpoint is available for this active session." : undefined,
    };
  }
  const missingAnchor = sessions.find((candidate) => candidate.status === "active");
  if (missingAnchor !== undefined) return unavailableContinuation("missing-anchor", missingAnchor, "An active session exists, but its complete machine, project, and workspace anchor is missing.");
  const pending = sessions.find((candidate) => candidate.status === "pending");
  if (pending !== undefined) return unavailableContinuation("pending", pending, "Session launch is pending confirmation; it is not resumable yet.");
  const failed = sessions.find((candidate) => candidate.status === "failed");
  if (failed !== undefined) return unavailableContinuation(checkpointHealth(failed), failed, launchFailureReason(failed));
  return unavailableContinuation("missing", undefined, "No Workstream session is available.");
}

function unavailableContinuation(status, session, reason) {
  return {
    resumable: false,
    status,
    sessionStatus: session?.status,
    sessionId: session?.id,
    next: undefined,
    reason,
  };
}

function projectSession(session) {
  return {
    id: session.id,
    status: session.status,
    purpose: session.purpose,
    anchor: {
      machineId: session.machineId,
      projectId: session.projectId,
      workspaceId: session.workspaceId,
      complete: [session.machineId, session.projectId, session.workspaceId].every(nonEmpty),
    },
    checkpointStatus: checkpointHealth(session),
    confirmedCheckpointAvailable: session.latestCheckpoint !== null && session.latestCheckpoint !== undefined,
    priorCheckpointAvailable: session.latestCheckpoint !== null && session.latestCheckpoint !== undefined && session.checkpointFailure !== null && session.checkpointFailure !== undefined,
    checkpointId: session.latestCheckpoint?.id,
    whatChanged: session.latestCheckpoint?.whatChanged,
    remains: session.latestCheckpoint?.remains,
    next: session.latestCheckpoint?.next,
    nextSessionPrompt: session.latestCheckpoint?.nextSessionPrompt,
    references: [...(session.latestCheckpoint?.references ?? [])],
    checkpointFailure: session.checkpointFailure,
    checkpointStaleness: session.checkpointStaleness,
    launchFailure: session.launchFailure,
  };
}

function failureReason(session) {
  return typeof session.checkpointFailure === "string" ? session.checkpointFailure
    : session.checkpointFailure?.reason ?? "The checkpoint failed.";
}

function launchFailureReason(session) {
  const reason = typeof session.launchFailure === "string" ? session.launchFailure : session.launchFailure?.reason;
  return reason === undefined ? "The session failed to launch and is not resumable." : `Session launch failed: ${reason}`;
}

function isUnresolvedTask(task) {
  return task.status === "pending" || task.status === "answered";
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
