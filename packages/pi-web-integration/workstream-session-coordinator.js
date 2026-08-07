const PRODUCER = "pi-web";

/**
 * Coordinates the non-atomic Workstream/PI WEB session launch handshake.
 * The Workstream Store remains authoritative for the association; the host only
 * owns session creation and navigation.
 */
export class WorkstreamSessionCoordinator {
  constructor(client, host) {
    if (client === undefined || host === undefined) throw new TypeError("client and host are required");
    this.client = client;
    this.host = host;
  }

  async launch(snapshot) {
    if (snapshot.closed) throw new Error("Closed Workstreams cannot start sessions.");
    const location = this.host.currentLocation();
    if (!completeLocation(location)) throw new Error("Select a complete machine, project, and workspace location before starting a Workstream session.");
    const associationKey = newId("launch");
    await this.#appendFresh(snapshot.id, associationKey, [{
      type: "session.pending",
      producer: PRODUCER,
      payload: { associationKey, ...location },
    }]);

    let session;
    try {
      session = await this.host.start({
        startupToken: associationKey,
        initialPrompt: workstreamPrompt(snapshot, associationKey),
      });
    } catch (error) {
      await this.#failPending(snapshot.id, associationKey, error);
      throw error;
    }

    try {
      if (!completeLocation(session.location)) throw new Error("PI WEB returned a session without a complete machine, project, and workspace location.");
      await this.#appendFresh(snapshot.id, `${associationKey}:confirmed`, [{
        type: "session.confirmed",
        producer: PRODUCER,
        sourceSessionId: session.id,
        payload: { sessionId: session.id, associationKey, ...session.location },
      }]);
      return session;
    } catch (error) {
      const current = await this.client.inspect(snapshot.id);
      if (current.sessions.some((candidate) => candidate.status === "active" && candidate.id === session.id && candidate.associationKey === associationKey)) return session;
      // The runtime session exists. Keep the durable association pending so reconnect
      // can confirm this same startup token instead of launching a duplicate child.
      throw error;
    }
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
    const pending = snapshot.sessions.filter((session) => session.status === "pending");
    const results = [];
    for (const association of pending) {
      const found = await this.host.findByStartupToken(association.associationKey, {
        machineId: association.machineId,
        projectId: association.projectId,
        workspaceId: association.workspaceId,
      });
      if (found === undefined) {
        results.push({ associationKey: association.associationKey, status: "pending" });
        continue;
      }
      if (!completeLocation(found.location)) throw new Error(`PI WEB found session ${found.id} without a complete machine, project, and workspace location.`);
      const current = await this.client.inspect(snapshot.id);
      if (!current.sessions.some((candidate) => candidate.status === "active" && candidate.id === found.id && candidate.associationKey === association.associationKey)) {
        try {
          await this.#appendFresh(snapshot.id, `${association.associationKey}:reconciled`, [{
            type: "session.confirmed",
            producer: PRODUCER,
            sourceSessionId: found.id,
            payload: { sessionId: found.id, associationKey: association.associationKey, ...found.location },
          }]);
        } catch (error) {
          const reconciled = await this.client.inspect(snapshot.id);
          if (!reconciled.sessions.some((candidate) => candidate.status === "active" && candidate.id === found.id && candidate.associationKey === association.associationKey)) throw error;
        }
      }
      results.push({ associationKey: association.associationKey, status: "confirmed", sessionId: found.id });
    }
    return results;
  }

  async #failPending(workstreamId, associationKey, error) {
    try {
      await this.#appendFresh(workstreamId, `${associationKey}:failed`, [{
        type: "session.failed",
        producer: PRODUCER,
        payload: { associationKey, reason: errorMessage(error) },
      }]);
    } catch (recordError) {
      throw new AggregateError([error, recordError], "Session launch failed and its pending association could not be reconciled.");
    }
  }

  async #appendFresh(workstreamId, idempotencyKey, records) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await this.client.inspect(workstreamId);
      try {
        return await this.client.append({ workstreamId, expectedRevision: snapshot.revision, idempotencyKey, records });
      } catch (error) {
        if (error?.code !== "STALE_REVISION" || attempt === 2) throw error;
      }
    }
    throw new Error("Unreachable append retry state.");
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

export function workstreamPrompt(snapshot, associationKey) {
  return [
    `You are pairing in Pi Workbench Workstream “${snapshot.title}” (${snapshot.id}).`,
    `The attended session association key is ${associationKey}.`,
    "Remain in Level 1 Pair posture: work with the attending user, reconcile any bounded child work yourself, and do not claim background execution or managed Run authority.",
    "When asked for a checkpoint, propose concise values for: what changed, what remains, the next useful action, an exact paste-ready prompt for a fresh attended session, and only the concrete references needed to resume. The user must review and confirm every field before persistence.",
  ].join("\n\n");
}

function newId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
