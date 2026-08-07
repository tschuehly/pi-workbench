const RECORDED_WORKSTREAMS_URL = new URL("./fixtures/recorded-workstreams.json", import.meta.url);

export function parseRecordedWorkstreams(value) {
  if (!isRecord(value) || value.version !== 1 || !isNonNegativeInteger(value.sequence) || !Array.isArray(value.snapshots)) return undefined;
  if (!value.snapshots.every(isWorkstreamSnapshot)) return undefined;
  return structuredClone(value);
}

export class DeterministicFakeWorkstreamClient {
  constructor(projection) {
    const parsed = parseRecordedWorkstreams(projection);
    if (parsed === undefined) throw new Error("Recorded Workstream projection does not match version 1.");
    this.projection = parsed;
    this.receipts = new Map();
    this.events = [];
  }

  async create(request) {
    return this.mutate(request, () => {
      if (this.projection.snapshots.some((snapshot) => snapshot.id === request.workstreamId)) throw new Error(`Workstream ${request.workstreamId} already exists.`);
      const timestamp = fakeTimestamp(this.projection.sequence + 1);
      this.projection.snapshots.push({ id: request.workstreamId, title: request.title, revision: 1, createdAt: timestamp, updatedAt: timestamp, sessions: [], humanTasks: [], links: [], closed: false, closedAt: null });
      return { workstreamId: request.workstreamId, revision: 1, records: [{ type: "workstream.created" }] };
    });
  }

  async append(request) {
    return this.mutate(request, () => {
      const snapshot = this.mutableSnapshot(request.workstreamId, request.expectedRevision);
      const metadata = { revision: snapshot.revision + 1, recordedAt: fakeTimestamp(this.projection.sequence + 1) };
      for (const record of request.records) validateFakeRecord(record);
      for (const record of request.records) applyFakeRecord(snapshot, record, metadata);
      snapshot.revision += 1;
      snapshot.updatedAt = metadata.recordedAt;
      return { workstreamId: snapshot.id, revision: snapshot.revision, records: structuredClone(request.records) };
    });
  }

  async close(request) {
    return this.mutate(request, () => {
      const snapshot = this.mutableSnapshot(request.workstreamId, request.expectedRevision);
      snapshot.revision += 1;
      snapshot.closed = true;
      snapshot.closedAt = fakeTimestamp(this.projection.sequence + 1);
      snapshot.updatedAt = snapshot.closedAt;
      return { workstreamId: snapshot.id, revision: snapshot.revision, records: [{ type: "workstream.closed" }] };
    });
  }

  async list(query = {}) {
    const includeClosed = query.includeClosed === true;
    return this.projection.snapshots
      .filter((snapshot) => includeClosed || !snapshot.closed)
      .map((snapshot) => ({
        id: snapshot.id,
        title: snapshot.title,
        revision: snapshot.revision,
        updatedAt: snapshot.updatedAt,
        activeSessionCount: snapshot.sessions.filter((session) => session.status === "active").length,
        pendingSessionCount: snapshot.sessions.filter((session) => session.status === "pending").length,
        failedSessionCount: snapshot.sessions.filter((session) => session.status === "failed").length,
        unresolvedHumanTaskCount: snapshot.humanTasks.filter((task) => task.status === "pending").length,
        closed: snapshot.closed,
      }));
  }

  async inspect(workstreamId) {
    const snapshot = this.projection.snapshots.find((candidate) => candidate.id === workstreamId);
    if (snapshot === undefined) throw new Error(`Workstream ${workstreamId} was not found.`);
    return structuredClone(snapshot);
  }

  async watch({ afterSequence = 0 } = {}) {
    return afterSequence < this.projection.sequence
      ? { mode: "snapshot", snapshots: structuredClone(this.projection.snapshots), nextSequence: this.projection.sequence }
      : { mode: "replay", events: structuredClone(this.events.filter((event) => event.sequence > afterSequence)), nextSequence: this.projection.sequence };
  }

  mutableSnapshot(workstreamId, expectedRevision) {
    const snapshot = this.projection.snapshots.find((candidate) => candidate.id === workstreamId);
    if (snapshot === undefined) throw new Error(`Workstream ${workstreamId} was not found.`);
    if (snapshot.closed) throw new Error(`Workstream ${workstreamId} is closed.`);
    if (snapshot.revision !== expectedRevision) throw new Error(`Expected revision ${String(expectedRevision)} but found ${String(snapshot.revision)}.`);
    return snapshot;
  }

  mutate(request, change) {
    const fingerprint = JSON.stringify(request);
    const previous = this.receipts.get(request.idempotencyKey);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) throw new Error(`Idempotency key ${request.idempotencyKey} was reused with different input.`);
      return structuredClone(previous.receipt);
    }
    const result = change();
    this.projection.sequence += 1;
    const recordedAt = fakeTimestamp(this.projection.sequence);
    const receipt = { workstreamId: result.workstreamId, acceptedRevision: result.revision, snapshotReference: { workstreamId: result.workstreamId, revision: result.revision }, sequence: this.projection.sequence, idempotencyKey: request.idempotencyKey, recordedAt };
    this.events.push({ sequence: this.projection.sequence, workstreamId: result.workstreamId, revision: result.revision, records: result.records, recordedAt });
    this.receipts.set(request.idempotencyKey, { fingerprint, receipt });
    return structuredClone(receipt);
  }
}

export async function loadDeterministicFakeWorkstreamClient(fetcher = fetch) {
  const response = await fetcher(RECORDED_WORKSTREAMS_URL);
  if (!response.ok) throw new Error(`Recorded Workstream fixture failed to load (${String(response.status)}).`);
  return new DeterministicFakeWorkstreamClient(await response.json());
}

function validateFakeRecord(record) {
  if (!isRecord(record) || !isRecord(record.payload)) throw new Error("Fake Workstream records require an object payload.");
  if (record.type === "session.confirmed" && !completeLocation(record.payload)) {
    throw new Error("session.confirmed requires complete machineId, projectId, and workspaceId values.");
  }
  if (record.type === "session.anchor.repaired") {
    if (!completeLocation(record.payload)) throw new Error("session.anchor.repaired requires complete machineId, projectId, and workspaceId values.");
    const resolution = record.payload.resolution;
    if (!isRecord(resolution)
        || resolution.method !== "complete-machine-scan"
        || !isString(resolution.evidenceId)
        || !isString(resolution.matchedCwd)
        || !Number.isSafeInteger(resolution.scannedScopeCount)
        || resolution.scannedScopeCount < 1
        || !isString(resolution.verifiedAt)) {
      throw new Error("session.anchor.repaired requires complete-machine-scan resolution evidence.");
    }
  }
}

function completeLocation(value) {
  return [value.machineId, value.projectId, value.workspaceId].every(isString);
}

function applyFakeRecord(snapshot, record, metadata) {
  switch (record.type) {
    case "link.upsert": upsert(snapshot.links, record.payload.link); break;
    case "link.removed": snapshot.links = snapshot.links.filter((link) => link.id !== record.payload.linkId); break;
    case "human-task.upsert": upsert(snapshot.humanTasks, projectHumanTask(record.payload.task, record)); break;
    case "human-task.answered": {
      const task = humanTask(snapshot, record.payload.taskId);
      Object.assign(task, {
        status: "answered",
        answer: structuredClone(record.payload.answer),
        answerReceipt: {
          answerId: record.payload.answerId,
          taskId: record.payload.taskId,
          acceptedRevision: metadata.revision,
          recordedAt: metadata.recordedAt,
          producer: record.producer,
          sourceSessionId: record.sourceSessionId ?? null,
        },
      });
      break;
    }
    case "human-task.resolved": {
      const task = humanTask(snapshot, record.payload.taskId);
      if (task.answerKind === null) snapshot.humanTasks = snapshot.humanTasks.filter((candidate) => candidate.id !== task.id);
      else task.status = "resolved";
      break;
    }
    case "session.pending": snapshot.sessions.push({
      id: record.payload.sessionId ?? `pending:${record.payload.associationKey}`,
      status: "pending",
      associationKey: record.payload.associationKey,
      machineId: record.payload.machineId,
      projectId: record.payload.projectId,
      workspaceId: record.payload.workspaceId,
      latestCheckpoint: null,
      checkpointFailure: null,
      checkpointStaleness: null,
      launchFailure: null,
    }); break;
    case "session.confirmed": {
      const pending = snapshot.sessions.find((candidate) => candidate.id === record.payload.sessionId || (record.payload.associationKey !== undefined && candidate.associationKey === record.payload.associationKey));
      if (pending === undefined) throw new Error(`Pending association for session ${record.payload.sessionId} was not found.`);
      Object.assign(pending, {
        id: record.payload.sessionId,
        status: "active",
        associationKey: record.payload.associationKey ?? pending.associationKey,
        machineId: record.payload.machineId ?? pending.machineId,
        projectId: record.payload.projectId ?? pending.projectId,
        workspaceId: record.payload.workspaceId ?? pending.workspaceId,
        launchFailure: null,
      });
      break;
    }
    case "session.anchor.repaired": {
      const active = session(snapshot, record.payload.sessionId);
      if (active.status !== "active") throw new Error(`Session ${record.payload.sessionId} is not active.`);
      if ([active.machineId, active.projectId, active.workspaceId].every((value) => typeof value === "string" && value.length > 0)) throw new Error(`Session ${record.payload.sessionId} already has a complete anchor.`);
      Object.assign(active, {
        machineId: record.payload.machineId,
        projectId: record.payload.projectId,
        workspaceId: record.payload.workspaceId,
      });
      break;
    }
    case "session.failed": {
      const pending = snapshot.sessions.find((candidate) => candidate.id === record.payload.sessionId || (record.payload.associationKey !== undefined && candidate.associationKey === record.payload.associationKey));
      if (pending === undefined) throw new Error("Pending session association was not found.");
      Object.assign(pending, {
        id: record.payload.sessionId ?? pending.id,
        status: "failed",
        associationKey: record.payload.associationKey ?? pending.associationKey,
        launchFailure: {
          reason: record.payload.reason,
          recordedAt: metadata.recordedAt,
          revision: metadata.revision,
          producer: record.producer,
          sourceSessionId: record.sourceSessionId ?? null,
        },
      });
      break;
    }
    case "checkpoint.replaced": {
      if (!isReplacementCheckpoint(record.payload.checkpoint)) throw new Error("Replacement checkpoint requires a next-session prompt of at most 2,000 characters.");
      Object.assign(session(snapshot, record.payload.sessionId), { latestCheckpoint: structuredClone(record.payload.checkpoint), checkpointFailure: null, checkpointStaleness: null });
      break;
    }
    case "checkpoint.failed": session(snapshot, record.payload.sessionId).checkpointFailure = record.payload.reason; break;
    case "checkpoint.stale": session(snapshot, record.payload.sessionId).checkpointStaleness = {
      checkpointId: record.payload.checkpointId,
      reason: record.payload.reason,
      recordedAt: metadata.recordedAt,
      revision: metadata.revision,
      producer: record.producer,
      sourceSessionId: record.sourceSessionId ?? null,
    }; break;
    default: throw new Error(`Unsupported fake Workstream record: ${String(record.type)}`);
  }
}

function projectHumanTask(task, record) {
  return {
    ...structuredClone(task),
    answerKind: task.answerKind ?? null,
    options: structuredClone(task.options ?? []),
    materiality: task.materiality ?? null,
    sourceSessionId: record.sourceSessionId ?? null,
    status: "pending",
    answer: null,
    answerReceipt: null,
  };
}

function upsert(items, value) {
  const index = items.findIndex((item) => item.id === value.id);
  if (index === -1) items.push(structuredClone(value));
  else items[index] = structuredClone(value);
}

function session(snapshot, id) {
  const value = snapshot.sessions.find((candidate) => candidate.id === id);
  if (value === undefined) throw new Error(`Session ${id} was not found.`);
  return value;
}

function humanTask(snapshot, id) {
  const value = snapshot.humanTasks.find((candidate) => candidate.id === id);
  if (value === undefined) throw new Error(`Human task ${id} was not found.`);
  return value;
}

function fakeTimestamp(sequence) {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();
}

function isWorkstreamSnapshot(value) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.title)
    && isNonNegativeInteger(value.revision)
    && isString(value.createdAt)
    && isString(value.updatedAt)
    && Array.isArray(value.sessions)
    && value.sessions.every(isSession)
    && Array.isArray(value.humanTasks)
    && value.humanTasks.every(isHumanTask)
    && Array.isArray(value.links)
    && value.links.every((link) => isRecord(link) && isString(link.id) && isString(link.kind) && isString(link.reference))
    && typeof value.closed === "boolean"
    && (value.closedAt === null || isString(value.closedAt));
}

function isSession(value) {
  if (!isRecord(value)
      || !isString(value.id)
      || !["active", "pending", "failed"].includes(value.status)
      || ![value.machineId, value.projectId, value.workspaceId].every((part) => part === undefined || isString(part))
      || !(value.latestCheckpoint === null || isCheckpoint(value.latestCheckpoint))
      || !(value.checkpointFailure === null || isString(value.checkpointFailure))
      || !(value.checkpointStaleness === null || isCheckpointStaleness(value.checkpointStaleness))
      || !(value.launchFailure === null || isProvenance(value.launchFailure) && isString(value.launchFailure.reason))) return false;
  if (value.status === "failed" && value.launchFailure === null) return false;
  if (value.status !== "failed" && value.launchFailure !== null) return false;
  return value.checkpointStaleness === null
    || value.latestCheckpoint !== null && value.checkpointStaleness.checkpointId === value.latestCheckpoint.id;
}

function isCheckpoint(value) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.whatChanged)
    && isString(value.remains)
    && isString(value.next)
    && (value.nextSessionPrompt === null || isString(value.nextSessionPrompt) && value.nextSessionPrompt.length <= 2_000)
    && (value.references === undefined || (Array.isArray(value.references) && value.references.every(isString)));
}

function isReplacementCheckpoint(value) {
  return isCheckpoint(value) && typeof value.nextSessionPrompt === "string";
}

function isCheckpointStaleness(value) {
  return isProvenance(value) && isString(value.checkpointId) && isString(value.reason);
}

function isProvenance(value) {
  return isRecord(value)
    && isString(value.recordedAt)
    && Number.isInteger(value.revision)
    && value.revision > 0
    && isString(value.producer)
    && (value.sourceSessionId === null || isString(value.sourceSessionId));
}

function isHumanTask(value) {
  if (!isRecord(value)
      || !isString(value.id)
      || !isString(value.title)
      || !(value.detail === undefined || isString(value.detail))
      || !Array.isArray(value.options)
      || !(value.sourceSessionId === null || isString(value.sourceSessionId))
      || !["pending", "answered", "resolved"].includes(value.status)) return false;
  const legacy = value.answerKind === null && value.materiality === null && value.options.length === 0;
  const typed = ["yes-no", "choice", "free-text"].includes(value.answerKind)
    && ["material", "non-material"].includes(value.materiality)
    && validOptions(value.answerKind, value.options);
  if (!legacy && !typed) return false;
  if (value.status === "pending") return value.answer === null && value.answerReceipt === null;
  if (value.answer === null || value.answerReceipt === null) return value.status === "resolved" && value.answer === null && value.answerReceipt === null;
  return isAnswer(value.answer, value.answerKind, value.options) && isAnswerReceipt(value.answerReceipt, value.id);
}

function validOptions(kind, options) {
  if (!options.every((option) => isRecord(option) && isString(option.id) && isString(option.label))) return false;
  const ids = new Set(options.map((option) => option.id));
  if (ids.size !== options.length) return false;
  if (kind === "free-text") return options.length === 0;
  if (kind === "yes-no") return options.length >= 2 && options.length <= 3 && ids.has("yes") && ids.has("no") && [...ids].every((id) => ["yes", "no", "change"].includes(id));
  return options.length > 0;
}

function isAnswer(value, kind, options) {
  if (!isRecord(value) || value.kind !== kind) return false;
  return kind === "free-text" ? isString(value.text) : isString(value.optionId) && options.some((option) => option.id === value.optionId);
}

function isAnswerReceipt(value, taskId) {
  return isRecord(value)
    && isString(value.answerId)
    && value.taskId === taskId
    && Number.isInteger(value.acceptedRevision)
    && value.acceptedRevision > 0
    && isString(value.recordedAt)
    && isString(value.producer)
    && (value.sourceSessionId === null || isString(value.sourceSessionId));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}
