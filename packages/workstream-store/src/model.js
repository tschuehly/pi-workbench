import { fail } from "./errors.js";

export const DEFAULT_LIMITS = Object.freeze({
  maxMutationBytes: 32 * 1024,
  maxRecordBytes: 8 * 1024,
  maxRecordsPerAppend: 32,
  maxTitleLength: 200,
  maxTextLength: 4_000,
  maxIdLength: 128,
  maxWatchBatch: 200,
});

const RECORD_TYPES = new Set([
  "session.pending",
  "session.confirmed",
  "session.failed",
  "checkpoint.replaced",
  "checkpoint.failed",
  "human-task.upsert",
  "human-task.resolved",
  "link.upsert",
  "link.removed",
]);

export function clone(value) {
  return structuredClone(value);
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function byteSize(value) {
  return Buffer.byteLength(canonical(value), "utf8");
}

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_REQUEST", `${field} must be an object`);
  }
  return value;
}

function string(value, field, max, { optional = false } = {}) {
  if (optional && value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    fail("INVALID_REQUEST", `${field} must be a non-empty string of at most ${max} characters`);
  }
}

function id(value, field, limits) {
  string(value, field, limits.maxIdLength);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) {
    fail("INVALID_REQUEST", `${field} contains unsupported characters`);
  }
}

function keys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail("INVALID_REQUEST", `${field} has unknown fields: ${unknown.join(", ")}`);
}

export function validateCreate(request, limits) {
  object(request, "request");
  keys(request, ["workstreamId", "idempotencyKey", "title", "producer"], "request");
  id(request.workstreamId, "workstreamId", limits);
  id(request.idempotencyKey, "idempotencyKey", limits);
  string(request.title, "title", limits.maxTitleLength);
  string(request.producer, "producer", limits.maxIdLength);
  validateMutationSize(request, limits);
}

export function validateAppend(request, limits) {
  object(request, "request");
  keys(request, ["workstreamId", "expectedRevision", "idempotencyKey", "records"], "request");
  id(request.workstreamId, "workstreamId", limits);
  id(request.idempotencyKey, "idempotencyKey", limits);
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) {
    fail("INVALID_REQUEST", "expectedRevision must be a positive safe integer");
  }
  if (!Array.isArray(request.records) || request.records.length < 1 || request.records.length > limits.maxRecordsPerAppend) {
    fail("INVALID_REQUEST", `records must contain 1 to ${limits.maxRecordsPerAppend} entries`);
  }
  validateMutationSize(request, limits);
  request.records.forEach((record, index) => validateRecord(record, limits, `records[${index}]`));
}

export function validateClose(request, limits) {
  object(request, "request");
  keys(request, ["workstreamId", "expectedRevision", "idempotencyKey", "producer", "sourceSessionId"], "request");
  id(request.workstreamId, "workstreamId", limits);
  id(request.idempotencyKey, "idempotencyKey", limits);
  id(request.producer, "producer", limits);
  if (request.sourceSessionId !== undefined) id(request.sourceSessionId, "sourceSessionId", limits);
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) {
    fail("INVALID_REQUEST", "expectedRevision must be a positive safe integer");
  }
  validateMutationSize(request, limits);
}

function validateMutationSize(request, limits) {
  if (byteSize(request) > limits.maxMutationBytes) {
    fail("MUTATION_TOO_LARGE", `mutation exceeds ${limits.maxMutationBytes} bytes`);
  }
}

function validateRecord(record, limits, field) {
  object(record, field);
  keys(record, ["type", "producer", "sourceSessionId", "payload"], field);
  if (!RECORD_TYPES.has(record.type)) fail("INVALID_RECORD", `${field}.type is not supported`);
  string(record.producer, `${field}.producer`, limits.maxIdLength);
  if (record.sourceSessionId !== undefined) id(record.sourceSessionId, `${field}.sourceSessionId`, limits);
  object(record.payload, `${field}.payload`);

  const validators = {
    "session.pending": () => {
      keys(record.payload, ["sessionId", "associationKey"], `${field}.payload`);
      id(record.payload.sessionId, `${field}.payload.sessionId`, limits);
      id(record.payload.associationKey, `${field}.payload.associationKey`, limits);
    },
    "session.confirmed": () => {
      keys(record.payload, ["sessionId"], `${field}.payload`);
      id(record.payload.sessionId, `${field}.payload.sessionId`, limits);
    },
    "session.failed": () => {
      keys(record.payload, ["sessionId", "reason"], `${field}.payload`);
      id(record.payload.sessionId, `${field}.payload.sessionId`, limits);
      string(record.payload.reason, `${field}.payload.reason`, limits.maxTextLength);
    },
    "checkpoint.replaced": () => {
      keys(record.payload, ["sessionId", "checkpoint"], `${field}.payload`);
      id(record.payload.sessionId, `${field}.payload.sessionId`, limits);
      const checkpoint = object(record.payload.checkpoint, `${field}.payload.checkpoint`);
      keys(checkpoint, ["id", "whatChanged", "remains", "next", "references"], `${field}.payload.checkpoint`);
      id(checkpoint.id, `${field}.payload.checkpoint.id`, limits);
      string(checkpoint.whatChanged, `${field}.payload.checkpoint.whatChanged`, limits.maxTextLength);
      string(checkpoint.remains, `${field}.payload.checkpoint.remains`, limits.maxTextLength);
      string(checkpoint.next, `${field}.payload.checkpoint.next`, limits.maxTextLength);
      if (checkpoint.references !== undefined) {
        if (!Array.isArray(checkpoint.references) || checkpoint.references.length > 20) fail("INVALID_RECORD", `${field}.payload.checkpoint.references must be an array of at most 20 strings`);
        checkpoint.references.forEach((reference, index) => string(reference, `${field}.payload.checkpoint.references[${index}]`, limits.maxTextLength));
      }
    },
    "checkpoint.failed": () => {
      keys(record.payload, ["sessionId", "reason"], `${field}.payload`);
      id(record.payload.sessionId, `${field}.payload.sessionId`, limits);
      string(record.payload.reason, `${field}.payload.reason`, limits.maxTextLength);
    },
    "human-task.upsert": () => {
      keys(record.payload, ["task"], `${field}.payload`);
      const task = object(record.payload.task, `${field}.payload.task`);
      keys(task, ["id", "title", "detail"], `${field}.payload.task`);
      id(task.id, `${field}.payload.task.id`, limits);
      string(task.title, `${field}.payload.task.title`, limits.maxTitleLength);
      string(task.detail, `${field}.payload.task.detail`, limits.maxTextLength, { optional: true });
    },
    "human-task.resolved": () => {
      keys(record.payload, ["taskId"], `${field}.payload`);
      id(record.payload.taskId, `${field}.payload.taskId`, limits);
    },
    "link.upsert": () => {
      keys(record.payload, ["link"], `${field}.payload`);
      const link = object(record.payload.link, `${field}.payload.link`);
      keys(link, ["id", "kind", "reference", "label"], `${field}.payload.link`);
      id(link.id, `${field}.payload.link.id`, limits);
      string(link.kind, `${field}.payload.link.kind`, limits.maxIdLength);
      string(link.reference, `${field}.payload.link.reference`, limits.maxTextLength);
      string(link.label, `${field}.payload.link.label`, limits.maxTitleLength, { optional: true });
    },
    "link.removed": () => {
      keys(record.payload, ["linkId"], `${field}.payload`);
      id(record.payload.linkId, `${field}.payload.linkId`, limits);
    },
  };
  validators[record.type]();
  if (byteSize(record) > limits.maxRecordBytes) fail("RECORD_TOO_LARGE", `${field} exceeds ${limits.maxRecordBytes} bytes`);
}

export function emptySnapshot(created) {
  return {
    id: created.workstreamId,
    title: created.title,
    revision: 0,
    createdAt: created.recordedAt,
    updatedAt: created.recordedAt,
    sessions: [],
    humanTasks: [],
    links: [],
    closed: false,
    closedAt: null,
  };
}

export function rebuildSnapshot(ledger) {
  if (!Array.isArray(ledger) || ledger.length === 0 || ledger[0].type !== "workstream.created") {
    fail("CORRUPT_STORE", "ledger does not begin with workstream.created");
  }
  const snapshot = emptySnapshot(ledger[0]);
  const sessions = new Map();
  const tasks = new Map();
  const links = new Map();

  for (const record of ledger) {
    snapshot.revision = record.revision;
    snapshot.updatedAt = record.recordedAt;
    const payload = record.payload ?? {};
    switch (record.type) {
      case "session.pending":
        sessions.set(payload.sessionId, { id: payload.sessionId, status: "pending", associationKey: payload.associationKey, latestCheckpoint: null, checkpointFailure: null });
        break;
      case "session.confirmed": {
        const session = sessions.get(payload.sessionId) ?? { id: payload.sessionId, latestCheckpoint: null, checkpointFailure: null };
        sessions.set(payload.sessionId, { ...session, status: "active" });
        break;
      }
      case "session.failed":
        sessions.delete(payload.sessionId);
        break;
      case "checkpoint.replaced": {
        const session = sessions.get(payload.sessionId);
        if (session) sessions.set(payload.sessionId, { ...session, latestCheckpoint: clone(payload.checkpoint), checkpointFailure: null });
        break;
      }
      case "checkpoint.failed": {
        const session = sessions.get(payload.sessionId);
        if (session) sessions.set(payload.sessionId, { ...session, checkpointFailure: payload.reason });
        break;
      }
      case "human-task.upsert":
        tasks.set(payload.task.id, clone(payload.task));
        break;
      case "human-task.resolved":
        tasks.delete(payload.taskId);
        break;
      case "link.upsert":
        links.set(payload.link.id, clone(payload.link));
        break;
      case "link.removed":
        links.delete(payload.linkId);
        break;
      case "workstream.closed":
        snapshot.closed = true;
        snapshot.closedAt = record.recordedAt;
        break;
    }
  }

  snapshot.sessions = [...sessions.values()].sort((a, b) => a.id.localeCompare(b.id));
  snapshot.humanTasks = [...tasks.values()].sort((a, b) => a.id.localeCompare(b.id));
  snapshot.links = [...links.values()].sort((a, b) => a.id.localeCompare(b.id));
  return snapshot;
}
