const PRODUCERS = new Set(["pi-web", "pi-extension"]);
const MAX_OPERATION_ID_LENGTH = 80;
const SELECTION_PREFIX = "workstream-continuation:v1:";
const IN_FLIGHT_OPERATION_TOKENS = new Set();

/**
 * Coordinates attended Pi session creation with authoritative Workstream association.
 * Durable Workstream steps always reacquire a client through withWorkstreamClient.
 */
export class WorkstreamSessionCoordination {
  constructor({
    withWorkstreamClient,
    attendedSession,
    producer,
    sourceSessionId,
    maxRevisionRetries = 3,
    ownsAssociationKey,
  }) {
    if (typeof withWorkstreamClient !== "function") throw new TypeError("withWorkstreamClient is required");
    if (!attendedSession || typeof attendedSession.checkLocation !== "function" || typeof attendedSession.launch !== "function" || typeof attendedSession.lookup !== "function") {
      throw new TypeError("attendedSession must provide checkLocation, launch, and lookup");
    }
    if (!PRODUCERS.has(producer)) throw new TypeError("producer must be pi-web or pi-extension");
    if (sourceSessionId !== undefined) requireId(sourceSessionId, "sourceSessionId");
    if (!Number.isSafeInteger(maxRevisionRetries) || maxRevisionRetries < 1 || maxRevisionRetries > 10) {
      throw new TypeError("maxRevisionRetries must be an integer between 1 and 10");
    }
    if (ownsAssociationKey !== undefined && typeof ownsAssociationKey !== "function") throw new TypeError("ownsAssociationKey must be a function");

    this.withWorkstreamClient = withWorkstreamClient;
    this.attendedSession = attendedSession;
    this.producer = producer;
    this.sourceSessionId = sourceSessionId;
    this.maxRevisionRetries = maxRevisionRetries;
    this.ownsAssociationKey = ownsAssociationKey ?? ((value) => value.startsWith(`${producer}:`));
  }

  async inspectContinuation(workstreamId) {
    requireId(workstreamId, "workstreamId");
    const snapshot = await this.#inspect(workstreamId);
    return continuationView(snapshot);
  }

  async launch(request) {
    const normalized = normalizeLaunchRequest(request, this.producer);
    if (IN_FLIGHT_OPERATION_TOKENS.has(normalized.operationToken)) {
      return pending(normalized.operationToken, "This continuation operation is already in progress.");
    }
    IN_FLIGHT_OPERATION_TOKENS.add(normalized.operationToken);
    try {
      return await this.#launch(normalized);
    } finally {
      IN_FLIGHT_OPERATION_TOKENS.delete(normalized.operationToken);
    }
  }

  async #launch(normalized) {
    let snapshot;
    try {
      snapshot = await this.#inspect(normalized.workstreamId);
    } catch (error) {
      return unavailable(normalized.operationToken, error?.code ?? "WORKSTREAM_UNAVAILABLE", errorMessage(error));
    }

    let location;
    let initialPrompt;
    let derivationKind;
    if (normalized.kind === "blank") {
      if (snapshot.closed) return blocked("WORKSTREAM_CLOSED", `Workstream ${snapshot.id} is closed.`);
      location = normalized.location;
      initialPrompt = blankSessionPrompt(snapshot, normalized.operationToken);
    } else {
      const selected = validateSelection(snapshot, normalized.selection);
      if (selected.type === "blocked") return selected;
      if (selected.candidate.status === "blocked") {
        if (selected.candidate.cause !== "CHECKPOINT_STALE") return blocked(selected.candidate.cause, selected.candidate.reason);
        if (normalized.acceptStaleCheckpointId !== selected.candidate.checkpoint.id) {
          return blocked("CHECKPOINT_STALE", selected.candidate.reason, { checkpointId: selected.candidate.checkpoint.id });
        }
      }
      location = selected.candidate.location;
      derivationKind = "checkpoint";
      initialPrompt = checkpointSessionPrompt(snapshot, selected.candidate, normalized.operationToken);
    }

    let locationCheck;
    try {
      locationCheck = await this.attendedSession.checkLocation({ location: structuredClone(location) });
    } catch (error) {
      return blocked("HOST_LOCATION_UNAVAILABLE", errorMessage(error));
    }
    if (!locationCheck || locationCheck.type !== "ready") {
      if (locationCheck?.type === "blocked" && ["HOST_LOCATION_UNAVAILABLE", "HOST_LOCATION_MISMATCH"].includes(locationCheck.cause)) {
        return blocked(locationCheck.cause, reason(locationCheck.reason, "The attended-session host cannot use the selected location."));
      }
      return blocked("HOST_LOCATION_UNAVAILABLE", "The attended-session host returned an invalid location check.");
    }

    const pendingRecord = {
      type: "session.pending",
      producer: this.producer,
      ...(this.sourceSessionId === undefined ? {} : { sourceSessionId: this.sourceSessionId }),
      payload: {
        associationKey: normalized.operationToken,
        ...structuredClone(location),
        ...(derivationKind === undefined ? {} : { derivationKind }),
      },
    };

    let pendingState;
    try {
      pendingState = await this.#appendPending(normalized.workstreamId, `${normalized.operationToken}:pending`, pendingRecord, normalized.operationToken);
    } catch (error) {
      if (error?.code === "WORKSTREAM_CLOSED") return blocked("WORKSTREAM_CLOSED", errorMessage(error));
      return unavailable(normalized.operationToken, error?.code ?? "WORKSTREAM_UNAVAILABLE", errorMessage(error));
    }
    if (!pendingState.created) return this.#resumeOperation(normalized.workstreamId, normalized.operationToken, location, pendingState.association, pendingState.consumed === true);

    let createdSession;
    let confirmedSession;
    let confirmationError;
    let launchResult;
    try {
      launchResult = await this.attendedSession.launch({
        associationKey: normalized.operationToken,
        location: structuredClone(location),
        initialPrompt,
        operationMarker: normalized.operationToken,
      }, {
        created: async (created) => {
          const session = validateCreatedSession(created);
          createdSession = session;
          if (!sameLocation(session.location, location)) {
            confirmationError = new CoordinationError("HOST_LOCATION_MISMATCH", `Created session ${session.id} does not match the selected Workstream location.`);
            throw confirmationError;
          }
          try {
            await this.#confirm(normalized.workstreamId, normalized.operationToken, session);
            confirmedSession = session;
          } catch (error) {
            confirmationError = error;
            throw error;
          }
        },
      });
    } catch (error) {
      return createdSession === undefined
        ? pending(normalized.operationToken, errorMessage(error))
        : unconfirmedOutcome(normalized.operationToken, createdSession, confirmationError ?? error);
    }

    if (!launchResult || typeof launchResult.type !== "string") {
      return pending(normalized.operationToken, "The attended-session host returned an invalid launch outcome.");
    }
    if (launchResult.type === "completed") {
      if (confirmedSession !== undefined) return { type: "confirmed", operationToken: normalized.operationToken, session: structuredClone(confirmedSession) };
      return createdSession === undefined
        ? pending(normalized.operationToken, "The attended-session host completed without reporting a created session.")
        : unconfirmedOutcome(normalized.operationToken, createdSession, confirmationError ?? new Error("The created session could not be confirmed in its Workstream."));
    }
    if (launchResult.type === "cancelled") {
      const terminal = await this.#terminalize(normalized.workstreamId, normalized.operationToken, "session.cancelled", reason(launchResult.reason, "Session creation was cancelled."));
      return terminal
        ? { type: "cancelled", operationToken: normalized.operationToken, reason: reason(launchResult.reason, "Session creation was cancelled.") }
        : pending(normalized.operationToken, "Cancellation was proven, but the Workstream association remains pending for reconciliation.");
    }
    if (launchResult.type === "failed") {
      const terminal = await this.#terminalize(normalized.workstreamId, normalized.operationToken, "session.failed", reason(launchResult.reason, "Session creation failed before creating a session."));
      return terminal
        ? { type: "failed", operationToken: normalized.operationToken, reason: reason(launchResult.reason, "Session creation failed before creating a session.") }
        : pending(normalized.operationToken, "Non-creation was proven, but the Workstream association remains pending for reconciliation.");
    }
    if (launchResult.type === "unknown") {
      return createdSession === undefined
        ? pending(normalized.operationToken, reason(launchResult.reason, "The session creation outcome is unknown."))
        : unconfirmedOutcome(normalized.operationToken, createdSession, confirmationError ?? new Error(reason(launchResult.reason, "The created session could not be confirmed.")));
    }
    return pending(normalized.operationToken, "The attended-session host returned an unsupported launch outcome.");
  }

  async reconcile(workstreamId, knownSnapshot) {
    requireId(workstreamId, "workstreamId");
    let snapshot = knownSnapshot;
    if (snapshot === undefined) {
      try {
        snapshot = await this.#inspect(workstreamId);
      } catch (error) {
        return [{ status: "unavailable", cause: error?.code ?? "WORKSTREAM_UNAVAILABLE", reason: errorMessage(error) }];
      }
    }
    if (snapshot?.id !== workstreamId || !Array.isArray(snapshot.sessions)) throw new TypeError("knownSnapshot must be the requested Workstream snapshot");
    const associations = snapshot.sessions.filter((session) => session.status === "pending" && typeof session.associationKey === "string" && this.ownsAssociationKey(session.associationKey));
    if (snapshot.closed === true) {
      return associations.map((association) => ({
        associationKey: association.associationKey,
        status: "blocked",
        cause: "WORKSTREAM_CLOSED",
        reason: `Workstream ${workstreamId} is closed; its pending association cannot be reconciled.`,
      }));
    }
    const outcomes = [];

    for (const association of associations) {
      if (!completeLocation(association)) {
        outcomes.push({ associationKey: association.associationKey, status: "pending", reason: "Pending association has an incomplete location." });
        continue;
      }
      const location = pickLocation(association);
      let lookup;
      try {
        lookup = await this.attendedSession.lookup({ associationKey: association.associationKey, location });
      } catch (error) {
        outcomes.push({ associationKey: association.associationKey, status: "pending", reason: errorMessage(error) });
        continue;
      }

      if (lookup?.type === "found") {
        let session;
        try {
          session = validateCreatedSession(lookup.session);
          if (!sameLocation(session.location, location)) throw new CoordinationError("HOST_LOCATION_MISMATCH", `Located session ${session.id} does not match its pending Workstream location.`);
          await this.#confirm(workstreamId, association.associationKey, session);
          outcomes.push({ associationKey: association.associationKey, status: "confirmed", sessionId: session.id });
        } catch (error) {
          outcomes.push(confirmationConflict(error)
            ? { associationKey: association.associationKey, status: "conflict", cause: error.code, reason: errorMessage(error), ...(session === undefined ? {} : { sessionId: session.id }) }
            : { associationKey: association.associationKey, status: "pending", reason: errorMessage(error), ...(session === undefined ? {} : { session: structuredClone(session) }) });
        }
        continue;
      }
      if (lookup?.type === "cancelled" || lookup?.type === "failed") {
        const recordType = lookup.type === "cancelled" ? "session.cancelled" : "session.failed";
        const terminal = await this.#terminalize(workstreamId, association.associationKey, recordType, reason(lookup.reason, lookup.type === "cancelled" ? "Session creation was cancelled." : "Session creation failed before creating a session."));
        outcomes.push(terminal
          ? { associationKey: association.associationKey, status: lookup.type, reason: reason(lookup.reason, lookup.type) }
          : { associationKey: association.associationKey, status: "pending", reason: `Could not record ${lookup.type}.` });
        continue;
      }
      outcomes.push({ associationKey: association.associationKey, status: "pending" });
    }

    return outcomes;
  }

  #inspect(workstreamId) {
    return this.withWorkstreamClient(async (client) => {
      requireClient(client);
      return client.inspect(workstreamId);
    });
  }

  async #appendPending(workstreamId, idempotencyKey, record, associationKey) {
    const before = await this.#inspect(workstreamId);
    const existing = before.sessions.find((session) => session.associationKey === associationKey);
    if (existing !== undefined) return { created: false, association: existing };
    try {
      await this.#appendFresh(workstreamId, idempotencyKey, [record]);
      return { created: true };
    } catch (error) {
      const current = await this.#inspect(workstreamId);
      const projected = current.sessions.find((session) => session.associationKey === associationKey);
      if (projected !== undefined) return { created: false, association: projected };
      if (error?.code === "INVALID_TRANSITION" || error?.code === "IDEMPOTENCY_CONFLICT") return { created: false, consumed: true };
      throw error;
    }
  }

  async #resumeOperation(workstreamId, associationKey, location, association, consumed) {
    if (association !== undefined) {
      if (!completeLocation(association) || !sameLocation(association, location)) {
        return conflict(associationKey, "OPERATION_TOKEN_CONFLICT", `Operation token ${associationKey} is already associated with another location.`);
      }
      if (association.status === "active") {
        return { type: "confirmed", operationToken: associationKey, session: { id: association.id, location: pickLocation(association) } };
      }
      if (association.status === "failed") {
        return { type: "failed", operationToken: associationKey, reason: association.launchFailure?.reason ?? "Session creation previously failed." };
      }
    }

    let lookup;
    try {
      lookup = await this.attendedSession.lookup({ associationKey, location: structuredClone(location) });
    } catch (error) {
      return pending(associationKey, errorMessage(error));
    }
    if (lookup?.type === "found") {
      let session;
      try {
        session = validateCreatedSession(lookup.session);
        if (!sameLocation(session.location, location)) return conflict(associationKey, "HOST_LOCATION_MISMATCH", `Located session ${session.id} does not match the operation location.`, session);
        if (association?.status !== "pending") return conflict(associationKey, "OPERATION_TOKEN_CONFLICT", `Operation token ${associationKey} no longer has a pending Workstream association.`, session);
        await this.#confirm(workstreamId, associationKey, session);
        return { type: "confirmed", operationToken: associationKey, session };
      } catch (error) {
        return session === undefined ? pending(associationKey, errorMessage(error)) : unconfirmedOutcome(associationKey, session, error);
      }
    }
    if (lookup?.type === "cancelled") {
      if (association?.status === "pending" && !await this.#terminalize(workstreamId, associationKey, "session.cancelled", reason(lookup.reason, "Session creation was cancelled."))) {
        return pending(associationKey, "Cancellation was proven, but the Workstream association remains pending for reconciliation.");
      }
      return { type: "cancelled", operationToken: associationKey, reason: reason(lookup.reason, "Session creation was cancelled.") };
    }
    if (lookup?.type === "failed") {
      if (association?.status === "pending" && !await this.#terminalize(workstreamId, associationKey, "session.failed", reason(lookup.reason, "Session creation failed before creating a session."))) {
        return pending(associationKey, "Non-creation was proven, but the Workstream association remains pending for reconciliation.");
      }
      return { type: "failed", operationToken: associationKey, reason: reason(lookup.reason, "Session creation failed before creating a session.") };
    }
    return consumed
      ? conflict(associationKey, "OPERATION_TOKEN_CONSUMED", `Operation token ${associationKey} was already consumed, but its terminal host outcome is unavailable.`)
      : pending(associationKey, "The existing session creation outcome is still unknown; reconciliation will not relaunch it.");
  }

  async #confirm(workstreamId, associationKey, session) {
    const alreadyConfirmed = (snapshot) => snapshot.sessions.some((candidate) => candidate.status === "active" && candidate.id === session.id && candidate.associationKey === associationKey && completeLocation(candidate) && sameLocation(candidate, session.location));
    if (alreadyConfirmed(await this.#inspect(workstreamId))) return;
    const record = {
      type: "session.confirmed",
      producer: this.producer,
      sourceSessionId: session.id,
      payload: { sessionId: session.id, associationKey, ...structuredClone(session.location) },
    };
    try {
      await this.#appendFresh(workstreamId, `${associationKey}:confirmed`, [record]);
    } catch (error) {
      if (confirmationConflict(error)) throw error;
      if (alreadyConfirmed(await this.#inspect(workstreamId))) return;
      throw error;
    }
  }

  async #terminalize(workstreamId, associationKey, recordType, failureReason) {
    const record = {
      type: recordType,
      producer: this.producer,
      ...(this.sourceSessionId === undefined ? {} : { sourceSessionId: this.sourceSessionId }),
      payload: { associationKey, reason: failureReason },
    };
    try {
      await this.#appendFresh(workstreamId, `${associationKey}:${recordType === "session.cancelled" ? "cancelled" : "failed"}`, [record]);
      return true;
    } catch {
      try {
        const current = (await this.#inspect(workstreamId)).sessions.find((session) => session.associationKey === associationKey);
        if (recordType === "session.cancelled") return current === undefined;
        return current?.status === "failed";
      } catch {
        return false;
      }
    }
  }

  async #appendFresh(workstreamId, idempotencyKey, records) {
    let lastError;
    for (let attempt = 0; attempt < this.maxRevisionRetries; attempt += 1) {
      let request;
      try {
        return await this.withWorkstreamClient(async (client) => {
          requireClient(client);
          const snapshot = await client.inspect(workstreamId);
          request = { workstreamId, expectedRevision: snapshot.revision, idempotencyKey, records: structuredClone(records) };
          return client.append(request);
        });
      } catch (error) {
        lastError = error;
        if (error?.code === "STALE_REVISION") continue;
        if (error?.code !== undefined || request === undefined) throw error;
        try {
          return await this.withWorkstreamClient(async (client) => {
            requireClient(client);
            return client.append(structuredClone(request));
          });
        } catch (retryError) {
          if (retryError?.code === "STALE_REVISION") {
            lastError = retryError;
            continue;
          }
          throw retryError?.code === undefined ? error : retryError;
        }
      }
    }
    throw lastError ?? new CoordinationError("STALE_REVISION", `Could not append to Workstream ${workstreamId} after bounded retries.`);
  }
}

export class CoordinationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "CoordinationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function continuationView(snapshot) {
  const sessions = [...snapshot.sessions].sort((left, right) => left.id.localeCompare(right.id));
  return {
    workstreamId: snapshot.id,
    title: snapshot.title,
    revision: snapshot.revision,
    closed: snapshot.closed,
    candidates: sessions.map((session) => classifyCandidate(snapshot, session)),
  };
}

function classifyCandidate(snapshot, session) {
  const base = { sourceSessionId: session.id };
  if (snapshot.closed) return { ...base, status: "blocked", cause: "WORKSTREAM_CLOSED", reason: `Workstream ${snapshot.id} is closed.` };
  if (session.status !== "active") return { ...base, status: "blocked", cause: "SOURCE_SESSION_NOT_ACTIVE", reason: `Session ${session.id} is not active.` };
  if (!completeLocation(session)) return { ...base, status: "blocked", cause: "SOURCE_LOCATION_INCOMPLETE", reason: `Session ${session.id} does not have a complete location.` };
  if (session.latestCheckpoint === null || session.latestCheckpoint === undefined) return { ...base, status: "blocked", cause: "CHECKPOINT_MISSING", reason: `Session ${session.id} has no confirmed checkpoint.` };
  if (typeof session.latestCheckpoint.nextSessionPrompt !== "string" || session.latestCheckpoint.nextSessionPrompt.length === 0) {
    return { ...base, status: "blocked", cause: "NEXT_SESSION_PROMPT_MISSING", reason: `Checkpoint ${session.latestCheckpoint.id} has no next-session prompt.` };
  }

  const location = pickLocation(session);
  const checkpoint = structuredClone(session.latestCheckpoint);
  const selection = encodeSelection({
    workstreamId: snapshot.id,
    revision: snapshot.revision,
    sourceSessionId: session.id,
    location,
    checkpoint,
    staleness: session.checkpointStaleness === null ? null : structuredClone(session.checkpointStaleness),
  });
  const ready = { ...base, location, checkpoint, selection };
  if (session.checkpointStaleness !== null) {
    return {
      ...ready,
      status: "blocked",
      cause: "CHECKPOINT_STALE",
      reason: session.checkpointStaleness.reason,
      staleness: structuredClone(session.checkpointStaleness),
    };
  }
  return { ...ready, status: "ready" };
}

function validateSelection(snapshot, selection) {
  let guard;
  try {
    guard = decodeSelection(selection);
  } catch (error) {
    return blocked("SELECTION_INVALID", errorMessage(error));
  }
  if (guard.workstreamId !== snapshot.id) return blocked("SELECTION_INVALID", "The continuation selection belongs to another Workstream.");
  const session = snapshot.sessions.find((candidate) => candidate.id === guard.sourceSessionId);
  if (session === undefined) return blocked("SOURCE_SESSION_NOT_ACTIVE", `Session ${guard.sourceSessionId} is no longer active in this Workstream.`);
  const candidate = classifyCandidate(snapshot, session);
  if (!["ready", "blocked"].includes(candidate.status) || candidate.selection === undefined) return blocked(candidate.cause, candidate.reason);
  const currentGuard = decodeSelection(candidate.selection);
  if (canonical(selectionMeaning(currentGuard)) !== canonical(selectionMeaning(guard))) {
    return blocked("SELECTION_CHANGED", "The selected checkpoint, staleness state, or source location changed. Inspect the Workstream again.");
  }
  return { type: "selected", candidate };
}

function selectionMeaning(value) {
  return {
    workstreamId: value.workstreamId,
    sourceSessionId: value.sourceSessionId,
    location: value.location,
    checkpoint: value.checkpoint,
    staleness: value.staleness,
  };
}

function encodeSelection(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${SELECTION_PREFIX}${encoded}`;
}

function decodeSelection(value) {
  if (typeof value !== "string" || !value.startsWith(SELECTION_PREFIX) || value.length > 16_000) throw new CoordinationError("SELECTION_INVALID", "Continuation selection is invalid.");
  let parsed;
  try {
    const encoded = value.slice(SELECTION_PREFIX.length);
    if (!/^[A-Za-z0-9_-]*$/.test(encoded)) throw new Error("invalid base64url selection");
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CoordinationError("SELECTION_INVALID", "Continuation selection cannot be decoded.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CoordinationError("SELECTION_INVALID", "Continuation selection is malformed.");
  return parsed;
}

function normalizeLaunchRequest(request, producer) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new TypeError("launch request must be an object");
  if (request.kind !== "blank" && request.kind !== "checkpoint") throw new TypeError("launch kind must be blank or checkpoint");
  requireId(request.workstreamId, "workstreamId");
  requireId(request.operationId, "operationId", MAX_OPERATION_ID_LENGTH);
  const operationToken = `${producer}:${request.operationId}`;
  if (request.kind === "blank") {
    requireCompleteLocation(request.location, "location");
    return { kind: "blank", workstreamId: request.workstreamId, operationToken, location: pickLocation(request.location) };
  }
  if (typeof request.selection !== "string") throw new TypeError("checkpoint launch requires selection");
  if (request.acceptStaleCheckpointId !== undefined) requireId(request.acceptStaleCheckpointId, "acceptStaleCheckpointId");
  return { kind: "checkpoint", workstreamId: request.workstreamId, operationToken, selection: request.selection, acceptStaleCheckpointId: request.acceptStaleCheckpointId };
}

function blankSessionPrompt(snapshot, associationKey) {
  return [
    `You are pairing in Pi Workbench Workstream “${snapshot.title}” (${snapshot.id}).`,
    `The attended session association key is ${associationKey}.`,
    "Remain in Level 1 Pair posture: work with the attending user, reconcile any bounded child work yourself, and do not claim background execution or managed Run authority.",
    "When asked for a checkpoint, propose concise values for: what changed, what remains, the next useful action, an exact paste-ready prompt for a fresh attended session, and only the concrete references needed to resume. The user must review and confirm every field before persistence.",
  ].join("\n\n");
}

function checkpointSessionPrompt(snapshot, candidate, associationKey) {
  return [
    `You are continuing Pi Workbench Workstream “${snapshot.title}” (${snapshot.id}) in a fresh attended session.`,
    `The source is session ${candidate.sourceSessionId}, checkpoint ${candidate.checkpoint.id}.`,
    `The attended session association key is ${associationKey}.`,
    "Remain in Level 1 Pair posture. The owner-confirmed next-session prompt follows verbatim; follow it without reconstructing continuation state from another conversation.",
    "--- BEGIN OWNER-CONFIRMED NEXT-SESSION PROMPT ---",
    candidate.checkpoint.nextSessionPrompt,
    "--- END OWNER-CONFIRMED NEXT-SESSION PROMPT ---",
  ].join("\n\n");
}

function validateCreatedSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CoordinationError("INVALID_CREATED_SESSION", "Attended-session host returned an invalid created session.");
  requireId(value.id, "created session id");
  requireCompleteLocation(value.location, "created session location");
  return { id: value.id, location: pickLocation(value.location) };
}

function requireClient(client) {
  if (!client || typeof client.inspect !== "function" || typeof client.append !== "function") throw new TypeError("Workstream client must provide inspect and append");
}

function requireCompleteLocation(value, field) {
  if (!completeLocation(value)) throw new TypeError(`${field} requires machineId, projectId, and workspaceId`);
}

function completeLocation(value) {
  return value !== undefined && [value.machineId, value.projectId, value.workspaceId].every(nonEmpty);
}

function pickLocation(value) {
  return { machineId: value.machineId, projectId: value.projectId, workspaceId: value.workspaceId };
}

function sameLocation(left, right) {
  return left.machineId === right.machineId && left.projectId === right.projectId && left.workspaceId === right.workspaceId;
}

function requireId(value, field, maxLength = 128) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength || !/^[A-Za-z0-9][A-Za-z0-9._@/-]*$/.test(value)) {
    throw new TypeError(`${field} must be a valid identifier of at most ${maxLength} characters`);
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function blocked(cause, message, details) {
  return { type: "blocked", cause, reason: message, ...(details === undefined ? {} : { details }) };
}

function pending(operationToken, message) {
  return { type: "pending", operationToken, reason: message };
}

function unavailable(operationToken, cause, message) {
  return { type: "unavailable", operationToken, cause, reason: message };
}

function conflict(operationToken, cause, message, session) {
  return { type: "conflict", operationToken, cause, reason: message, ...(session === undefined ? {} : { session: structuredClone(session) }) };
}

function confirmationConflict(error) {
  return ["SESSION_ASSIGNED_ELSEWHERE", "WORKSTREAM_CLOSED", "HOST_LOCATION_MISMATCH", "OPERATION_TOKEN_CONFLICT", "INVALID_TRANSITION"].includes(error?.code);
}

function unconfirmedOutcome(operationToken, session, error) {
  return confirmationConflict(error)
    ? conflict(operationToken, error.code, errorMessage(error), session)
    : { type: "unconfirmed", operationToken, reason: errorMessage(error), session: structuredClone(session) };
}

function reason(value, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
