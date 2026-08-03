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
      for (const record of request.records) applyFakeRecord(snapshot, record);
      snapshot.revision += 1;
      snapshot.updatedAt = fakeTimestamp(this.projection.sequence + 1);
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
        unresolvedHumanTaskCount: snapshot.humanTasks.length,
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

function applyFakeRecord(snapshot, record) {
  switch (record.type) {
    case "link.upsert": upsert(snapshot.links, record.payload.link); break;
    case "link.removed": snapshot.links = snapshot.links.filter((link) => link.id !== record.payload.linkId); break;
    case "human-task.upsert": upsert(snapshot.humanTasks, record.payload.task); break;
    case "human-task.resolved": snapshot.humanTasks = snapshot.humanTasks.filter((task) => task.id !== record.payload.taskId); break;
    case "session.pending": snapshot.sessions.push({ id: record.payload.sessionId, status: "pending", associationKey: record.payload.associationKey, latestCheckpoint: null, checkpointFailure: null }); break;
    case "session.confirmed": session(snapshot, record.payload.sessionId).status = "active"; break;
    case "session.failed": snapshot.sessions = snapshot.sessions.filter((candidate) => candidate.id !== record.payload.sessionId); break;
    case "checkpoint.replaced": Object.assign(session(snapshot, record.payload.sessionId), { latestCheckpoint: structuredClone(record.payload.checkpoint), checkpointFailure: null }); break;
    case "checkpoint.failed": session(snapshot, record.payload.sessionId).checkpointFailure = record.payload.reason; break;
    default: throw new Error(`Unsupported fake Workstream record: ${String(record.type)}`);
  }
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
    && value.humanTasks.every((task) => isRecord(task) && isString(task.id) && isString(task.title))
    && Array.isArray(value.links)
    && value.links.every((link) => isRecord(link) && isString(link.id) && isString(link.kind) && isString(link.reference))
    && typeof value.closed === "boolean"
    && (value.closedAt === null || isString(value.closedAt));
}

function isSession(value) {
  return isRecord(value)
    && isString(value.id)
    && (value.status === "active" || value.status === "pending")
    && (value.latestCheckpoint === null || isCheckpoint(value.latestCheckpoint))
    && (value.checkpointFailure === null || isString(value.checkpointFailure));
}

function isCheckpoint(value) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.whatChanged)
    && isString(value.remains)
    && isString(value.next)
    && (value.references === undefined || (Array.isArray(value.references) && value.references.every(isString)));
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
