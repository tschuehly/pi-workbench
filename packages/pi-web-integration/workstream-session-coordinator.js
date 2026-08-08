import { WorkstreamSessionCoordination } from "../workstream-session-coordination/src/index.js";

const PRODUCER = "pi-web";

/**
 * PI WEB adapter around host-neutral attended-session coordination. Existing-session
 * navigation and anchor repair remain PI WEB-specific.
 */
export class WorkstreamSessionCoordinator {
  constructor(client, host) {
    if (client === undefined || host === undefined) throw new TypeError("client and host are required");
    this.client = client;
    this.host = host;
    this.coordination = new WorkstreamSessionCoordination({
      withWorkstreamClient: (callback) => callback(this.client),
      attendedSession: piWebAttendedSessionAdapter(this.host),
      producer: "pi-web",
      ownsAssociationKey: (associationKey) => associationKey.startsWith("pi-web:") || associationKey.startsWith("launch-"),
    });
  }

  async inspectContinuation(workstreamId) {
    return this.coordination.inspectContinuation(workstreamId);
  }

  async launch(snapshot) {
    const location = this.host.currentLocation();
    if (!completeLocation(location)) throw new Error("Select a complete machine, project, and workspace location before starting a Workstream session.");
    const outcome = await this.coordination.launch({
      kind: "blank",
      workstreamId: snapshot.id,
      operationId: newId("launch"),
      location,
    });
    if (outcome.type === "confirmed") return outcome.session;
    if (outcome.type === "unconfirmed" || (outcome.type === "conflict" && outcome.session !== undefined)) {
      return {
        ...outcome.session,
        workstreamAssociation: outcome.type === "unconfirmed" ? "pending" : "conflict",
        workstreamAssociationReason: outcome.reason,
      };
    }
    throw outcomeError(outcome);
  }

  async continueCheckpoint(workstreamId, operationId, selection, acceptStaleCheckpointId) {
    return this.coordination.launch({
      kind: "checkpoint",
      workstreamId,
      operationId,
      selection,
      ...(acceptStaleCheckpointId === undefined ? {} : { acceptStaleCheckpointId }),
    });
  }

  async resume(session) {
    if (session.status !== "active") throw new Error("Only confirmed sessions can be resumed.");
    if (!completeLocation(session)) throw new SessionAnchorMissingError(session.id);
    await this.host.open({ sessionId: session.id, machineId: session.machineId, projectId: session.projectId, workspaceId: session.workspaceId });
  }

  async resolveSessionAnchor(session, machineId) {
    repairableSession(session);
    if (typeof machineId !== "string" || machineId.trim() === "") throw new TypeError("An explicit machineId is required to resolve a session location.");
    if (typeof this.host.resolveSessionLocation !== "function") {
      throw new SessionLocationResolutionError("SESSION_LOCATION_RESOLVER_UNAVAILABLE", "This PI WEB version cannot resolve session locations.");
    }
    const result = await this.host.resolveSessionLocation({ machineId, sessionId: session.id });
    return validateResolution(result, machineId);
  }

  async repairSessionAnchor(snapshot, session, selected) {
    repairableWorkstream(snapshot, session);
    const selection = validateMatch(selected, selected?.location?.machineId, "selected session location");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.client.inspect(snapshot.id);
      const currentSession = current.sessions.find((candidate) => candidate.id === session.id);
      repairableWorkstream(current, currentSession);
      const resolution = await this.resolveSessionAnchor(currentSession, selection.location.machineId);
      const rechecked = matchingResolution(resolution, selection);
      if (rechecked === undefined) throw recheckFailure(resolution);
      const records = [{
        type: "session.anchor.repaired",
        producer: PRODUCER,
        sourceSessionId: currentSession.id,
        payload: {
          sessionId: currentSession.id,
          ...rechecked.location,
          resolution: { method: "complete-machine-scan", ...rechecked.evidence },
        },
      }];
      try {
        return await this.client.append({
          workstreamId: current.id,
          expectedRevision: current.revision,
          idempotencyKey: newId("anchor-repair"),
          records,
        });
      } catch (error) {
        if (error?.code !== "STALE_REVISION" || attempt === 2) throw error;
      }
    }
    throw new Error("Unreachable anchor repair retry state.");
  }

  async reconcile(snapshot) {
    return this.coordination.reconcile(snapshot.id, snapshot);
  }
}

export class SessionAnchorMissingError extends Error {
  constructor(sessionId) {
    super(`Session ${sessionId} is not available in the selected workspace.`);
    this.name = "SessionAnchorMissingError";
    this.code = "SESSION_ANCHOR_MISSING";
  }
}

export class SessionLocationResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SessionLocationResolutionError";
    this.code = code;
  }
}

function repairableWorkstream(snapshot, session) {
  if (snapshot?.closed === true) throw new Error("Closed Workstreams cannot repair session locations.");
  repairableSession(session);
}

function repairableSession(session) {
  if (session?.status !== "active") throw new Error("Only active sessions can repair a location.");
  if (completeLocation(session)) throw new Error(`Session ${session.id} already has a complete anchor.`);
}

function validateResolution(value, machineId) {
  const status = value?.type;
  if (status === "found") return { status: "found", ...validateMatch(value, machineId, "found session location") };
  if (status === "ambiguous") {
    if (!Array.isArray(value.locations) || value.locations.length < 2) invalidResolution("ambiguous.locations must contain at least two matches");
    return { status: "ambiguous", locations: value.locations.map((match) => validateMatch(match, machineId, "ambiguous session location")) };
  }
  if (status === "missing") return { status: "missing" };
  if (status === "unavailable" && Array.isArray(value.failedScopes) && value.failedScopes.length > 0) {
    return { status: "unavailable", failedScopes: structuredClone(value.failedScopes) };
  }
  invalidResolution("result must be found, ambiguous, missing, or unavailable with failedScopes");
}

function validateMatch(value, machineId, field) {
  const location = value?.location;
  const evidence = value?.evidence;
  if (!completeLocation(location) || location.machineId !== machineId) invalidResolution(`${field} must have a complete location on the requested machine`);
  if (!nonEmpty(evidence?.evidenceId) || !nonEmpty(evidence?.matchedCwd) || !Number.isSafeInteger(evidence?.scannedScopeCount) || evidence.scannedScopeCount < 1 || !nonEmpty(evidence?.verifiedAt)) {
    invalidResolution(`${field} must have bounded complete-scan evidence`);
  }
  return {
    location: { machineId: location.machineId, projectId: location.projectId, workspaceId: location.workspaceId },
    evidence: {
      evidenceId: evidence.evidenceId,
      matchedCwd: evidence.matchedCwd,
      scannedScopeCount: evidence.scannedScopeCount,
      verifiedAt: evidence.verifiedAt,
    },
  };
}

function recheckFailure(resolution) {
  if (resolution.status === "missing") {
    return new SessionLocationResolutionError("SESSION_LOCATION_MISSING", "The session is no longer present in the completed machine scan. Verify its machine or workspace, then scan again.");
  }
  if (resolution.status === "unavailable") {
    return new SessionLocationResolutionError("SESSION_LOCATION_UNAVAILABLE", "The session location could not be rechecked across every registered scope. Restore access, then scan again.");
  }
  return new SessionLocationResolutionError("SESSION_LOCATION_CHANGED", "The selected session-location evidence changed before confirmation. Scan again before repairing.");
}

function matchingResolution(resolution, selected) {
  const matches = resolution.status === "found" ? [resolution] : resolution.status === "ambiguous" ? resolution.locations : [];
  return matches.find((match) => sameLocation(match.location, selected.location) && match.evidence.evidenceId === selected.evidence.evidenceId);
}

function sameLocation(left, right) {
  return left.machineId === right.machineId && left.projectId === right.projectId && left.workspaceId === right.workspaceId;
}

function invalidResolution(message) {
  throw new SessionLocationResolutionError("INVALID_SESSION_LOCATION_RESOLUTION", `PI WEB returned an invalid session-location resolution: ${message}.`);
}

function completeLocation(value) {
  return value !== undefined && [value.machineId, value.projectId, value.workspaceId].every(nonEmpty);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function piWebAttendedSessionAdapter(host) {
  return {
    async checkLocation({ location }) {
      let current;
      try {
        current = host.currentLocation();
      } catch (error) {
        return { type: "blocked", cause: "HOST_LOCATION_UNAVAILABLE", reason: errorMessage(error) };
      }
      if (!completeLocation(current)) {
        return { type: "blocked", cause: "HOST_LOCATION_UNAVAILABLE", reason: "Select a complete machine, project, and workspace location before starting a Workstream session." };
      }
      if (!sameLocation(current, location)) {
        return { type: "blocked", cause: "HOST_LOCATION_MISMATCH", reason: "Select the checkpoint's recorded machine, project, and workspace before continuing." };
      }
      return { type: "ready" };
    },

    async launch(request, hooks) {
      let session;
      try {
        const current = host.currentLocation();
        if (!completeLocation(current) || !sameLocation(current, request.location)) {
          return { type: "failed", reason: "The selected host location changed before session creation." };
        }
        session = await host.start({ startupToken: request.associationKey, initialPrompt: request.initialPrompt, location: structuredClone(request.location) });
      } catch (error) {
        return knownNonCreation(error)
          ? { type: "failed", reason: errorMessage(error) }
          : { type: "unknown", reason: errorMessage(error) };
      }
      try {
        await hooks.created(session);
      } catch (error) {
        return { type: "unknown", reason: errorMessage(error) };
      }
      return { type: "completed" };
    },

    async lookup({ associationKey, location }) {
      if (!(associationKey.startsWith("pi-web:") || associationKey.startsWith("launch-"))) return { type: "unknown" };
      try {
        const found = await host.findByStartupToken(associationKey, location);
        return found === undefined ? { type: "unknown" } : { type: "found", session: found };
      } catch {
        return { type: "unknown" };
      }
    },
  };
}

function knownNonCreation(error) {
  return error?.nonCreationProven === true || error?.code === "SESSION_START_REJECTED";
}

function outcomeError(outcome) {
  const error = new Error(outcome.reason);
  error.code = outcome.cause ?? `SESSION_LAUNCH_${outcome.type.toUpperCase()}`;
  if (outcome.operationToken !== undefined) error.operationToken = outcome.operationToken;
  return error;
}

function newId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
