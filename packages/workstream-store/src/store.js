import { WorkstreamStoreError, fail } from "./errors.js";
import {
  DEFAULT_LIMITS,
  canonical,
  clone,
  rebuildSnapshot,
  validateAppend,
  validateClose,
  validateCreate,
} from "./model.js";

export class WorkstreamStore {
  constructor({ adapter, clock = () => new Date(), limits = {} }) {
    if (!adapter || typeof adapter.transaction !== "function") throw new TypeError("adapter must provide transaction(callback)");
    this.adapter = adapter;
    this.clock = clock;
    this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
  }

  async create(request) {
    validateCreate(request, this.limits);
    return this.adapter.transaction((database) => {
      const retry = exactRetry(database, request.idempotencyKey, request);
      if (retry) return retry;
      if (database.workstreams[request.workstreamId]) fail("WORKSTREAM_EXISTS", `workstream ${request.workstreamId} already exists`);

      const recordedAt = timestamp(this.clock);
      const record = {
        type: "workstream.created",
        workstreamId: request.workstreamId,
        title: request.title,
        producer: request.producer,
        revision: 1,
        recordedAt,
      };
      const entry = { ledger: [record] };
      database.workstreams[request.workstreamId] = entry;
      const receipt = addEventAndReceipt(database, request, request.workstreamId, 1, [record], recordedAt, this.limits);
      remember(database, request.idempotencyKey, request, receipt);
      return receipt;
    });
  }

  async append(request) {
    validateAppend(request, this.limits);
    return this.adapter.transaction((database) => {
      const retry = exactRetry(database, request.idempotencyKey, request);
      if (retry) return retry;
      const entry = getEntry(database, request.workstreamId);
      const before = rebuildSnapshot(entry.ledger);
      ensureRevision(before, request.expectedRevision);
      if (before.closed) fail("WORKSTREAM_CLOSED", `workstream ${request.workstreamId} is closed`);
      validateTransitions(database, request.workstreamId, before, request.records);

      const revision = before.revision + 1;
      const recordedAt = timestamp(this.clock);
      const records = request.records.map((record, index) => ({
        ...clone(record),
        workstreamId: request.workstreamId,
        revision,
        position: index,
        recordedAt,
      }));
      entry.ledger.push(...records);
      const receipt = addEventAndReceipt(database, request, request.workstreamId, revision, records, recordedAt, this.limits);
      remember(database, request.idempotencyKey, request, receipt);
      return receipt;
    });
  }

  async inspect(workstreamId) {
    validateWorkstreamId(workstreamId, this.limits);
    return this.adapter.transaction((database) => clone(rebuildSnapshot(getEntry(database, workstreamId).ledger)), { readOnly: true });
  }

  async list(query = {}) {
    validateQuery(query);
    return this.adapter.transaction((database) => {
      const summaries = Object.values(database.workstreams)
        .map(({ ledger }) => rebuildSnapshot(ledger))
        .filter((snapshot) => query.includeClosed === true || !snapshot.closed)
        .filter((snapshot) => !query.text || snapshot.title.toLocaleLowerCase().includes(query.text.toLocaleLowerCase()))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
        .map(toSummary);
      return clone(summaries);
    }, { readOnly: true });
  }

  async watch(watch = {}) {
    validateWatch(watch, this.limits);
    return this.adapter.transaction((database) => {
      const afterSequence = watch.afterSequence ?? 0;
      const limit = watch.limit ?? this.limits.maxWatchBatch;
      const relevant = (value) => !watch.workstreamId || value.workstreamId === watch.workstreamId;
      const firstRetainedSequence = database.events.length ? database.events[0].sequence : database.nextSequence;
      const replayUnavailable = afterSequence < firstRetainedSequence - 1;

      if (replayUnavailable) {
        const snapshots = Object.values(database.workstreams)
          .map(({ ledger }) => rebuildSnapshot(ledger))
          .filter((snapshot) => !watch.workstreamId || snapshot.id === watch.workstreamId)
          .sort((a, b) => a.id.localeCompare(b.id));
        return clone({
          mode: "snapshot",
          snapshots,
          nextSequence: database.nextSequence - 1,
        });
      }

      const events = database.events.filter((event) => event.sequence > afterSequence && relevant(event)).slice(0, limit);
      return clone({
        mode: "replay",
        events,
        nextSequence: events.length ? events.at(-1).sequence : database.nextSequence - 1,
      });
    }, { readOnly: true });
  }

  async close(request) {
    validateClose(request, this.limits);
    return this.adapter.transaction((database) => {
      const retry = exactRetry(database, request.idempotencyKey, request);
      if (retry) return retry;
      const entry = getEntry(database, request.workstreamId);
      const before = rebuildSnapshot(entry.ledger);
      ensureRevision(before, request.expectedRevision);
      if (before.closed) fail("WORKSTREAM_CLOSED", `workstream ${request.workstreamId} is closed`);

      const revision = before.revision + 1;
      const recordedAt = timestamp(this.clock);
      const record = {
        type: "workstream.closed",
        workstreamId: request.workstreamId,
        producer: request.producer,
        ...(request.sourceSessionId ? { sourceSessionId: request.sourceSessionId } : {}),
        payload: {},
        revision,
        recordedAt,
      };
      entry.ledger.push(record);
      const receipt = addEventAndReceipt(database, request, request.workstreamId, revision, [record], recordedAt, this.limits);
      remember(database, request.idempotencyKey, request, receipt);
      return receipt;
    });
  }
}

function validateTransitions(database, workstreamId, before, records) {
  const sessions = new Map(before.sessions.map((session) => [session.id, {
    status: session.status,
    associationKey: session.associationKey,
    checkpointId: session.latestCheckpoint?.id,
  }]));
  const pendingByAssociation = new Map(before.sessions
    .filter((session) => session.status === "pending")
    .map((session) => [session.associationKey, session.id]));
  const tasks = new Map(before.humanTasks.map((task) => [task.id, {
    status: task.status,
    answerKind: task.answerKind,
    optionIds: new Set(task.options.map((option) => option.id)),
  }]));
  const answerIds = new Set(before.humanTasks.flatMap((task) => task.answerReceipt === null ? [] : [task.answerReceipt.answerId]));
  const historicalSessionIds = new Set();
  for (const entry of Object.values(database.workstreams)) {
    for (const record of entry.ledger) {
      const sessionId = record.payload?.sessionId;
      if (sessionId && entry.ledger[0].workstreamId !== workstreamId) historicalSessionIds.add(sessionId);
    }
  }

  for (const record of records) {
    const sessionId = record.payload.sessionId;
    const associationKey = record.payload.associationKey;
    switch (record.type) {
      case "session.pending": {
        const pendingId = sessionId ?? `pending:${associationKey}`;
        if (sessionId !== undefined && historicalSessionIds.has(sessionId)) fail("SESSION_ASSIGNED_ELSEWHERE", `session ${sessionId} belongs to another workstream`);
        if (sessions.has(pendingId) || pendingByAssociation.has(associationKey)) fail("INVALID_TRANSITION", `association ${associationKey} is already pending`);
        sessions.set(pendingId, { status: "pending", associationKey, checkpointId: undefined });
        pendingByAssociation.set(associationKey, pendingId);
        break;
      }
      case "session.confirmed": {
        if (historicalSessionIds.has(sessionId)) fail("SESSION_ASSIGNED_ELSEWHERE", `session ${sessionId} belongs to another workstream`);
        const pendingId = associationKey === undefined ? sessionId : pendingByAssociation.get(associationKey);
        if (pendingId === undefined || sessions.get(pendingId)?.status !== "pending") fail("INVALID_TRANSITION", `session ${sessionId} has no matching pending association`);
        const pending = sessions.get(pendingId);
        if (pendingId !== sessionId && sessions.has(sessionId)) fail("INVALID_TRANSITION", `session ${sessionId} already exists in this workstream`);
        sessions.delete(pendingId);
        pendingByAssociation.delete(pending.associationKey);
        sessions.set(sessionId, { ...pending, status: "active", associationKey: associationKey ?? pending.associationKey });
        break;
      }
      case "session.failed": {
        const pendingId = associationKey === undefined ? sessionId : pendingByAssociation.get(associationKey);
        if (pendingId === undefined || sessions.get(pendingId)?.status !== "pending") fail("INVALID_TRANSITION", "session association is not pending");
        const pending = sessions.get(pendingId);
        const failedId = sessionId ?? pendingId;
        if (pendingId !== failedId && sessions.has(failedId)) fail("INVALID_TRANSITION", `session ${failedId} already exists in this workstream`);
        sessions.delete(pendingId);
        pendingByAssociation.delete(pending.associationKey);
        sessions.set(failedId, { ...pending, status: "failed", associationKey: associationKey ?? pending.associationKey });
        break;
      }
      case "checkpoint.replaced": {
        if (sessions.get(sessionId)?.status !== "active") fail("INVALID_TRANSITION", `session ${sessionId} is not active`);
        sessions.get(sessionId).checkpointId = record.payload.checkpoint.id;
        break;
      }
      case "checkpoint.failed":
        if (sessions.get(sessionId)?.status !== "active") fail("INVALID_TRANSITION", `session ${sessionId} is not active`);
        break;
      case "checkpoint.stale": {
        const session = sessions.get(sessionId);
        if (session?.status !== "active") fail("INVALID_TRANSITION", `session ${sessionId} is not active`);
        if (session.checkpointId !== record.payload.checkpointId) fail("INVALID_TRANSITION", `checkpoint ${record.payload.checkpointId} is not the latest confirmed checkpoint for session ${sessionId}`);
        break;
      }
      case "human-task.upsert": {
        const task = record.payload.task;
        if (tasks.has(task.id) && tasks.get(task.id).status !== "pending") fail("INVALID_TRANSITION", `human task ${task.id} is not pending`);
        tasks.set(task.id, {
          status: "pending",
          answerKind: task.answerKind ?? null,
          optionIds: new Set((task.options ?? []).map((option) => option.id)),
        });
        break;
      }
      case "human-task.answered": {
        const task = tasks.get(record.payload.taskId);
        if (!task) fail("INVALID_TRANSITION", `human task ${record.payload.taskId} does not exist`);
        if (task.status !== "pending") fail("INVALID_TRANSITION", `human task ${record.payload.taskId} is not pending`);
        if (answerIds.has(record.payload.answerId)) fail("INVALID_TRANSITION", `human task answer ${record.payload.answerId} already exists`);
        const answer = record.payload.answer;
        if (task.answerKind === null) fail("INVALID_TRANSITION", `human task ${record.payload.taskId} is not answerable`);
        if (answer.kind !== task.answerKind) fail("INVALID_TRANSITION", `answer kind does not match human task ${record.payload.taskId}`);
        if (answer.kind !== "free-text" && !task.optionIds.has(answer.optionId)) fail("INVALID_TRANSITION", `answer option ${answer.optionId} is not available for human task ${record.payload.taskId}`);
        task.status = "answered";
        answerIds.add(record.payload.answerId);
        break;
      }
      case "human-task.resolved": {
        const task = tasks.get(record.payload.taskId);
        if (!task) fail("INVALID_TRANSITION", `human task ${record.payload.taskId} does not exist`);
        if (task.status === "resolved") fail("INVALID_TRANSITION", `human task ${record.payload.taskId} is already resolved`);
        if (task.answerKind === null) tasks.delete(record.payload.taskId);
        else task.status = "resolved";
        break;
      }
    }
  }
}

function addEventAndReceipt(database, request, workstreamId, revision, records, recordedAt, limits) {
  const sequence = database.nextSequence++;
  const snapshotReference = { workstreamId, revision };
  database.events.push({ sequence, workstreamId, revision, records: clone(records), recordedAt });
  const retention = database.eventRetention;
  if (database.events.length > retention) database.events.splice(0, database.events.length - retention);
  return {
    workstreamId,
    acceptedRevision: revision,
    snapshotReference,
    sequence,
    idempotencyKey: request.idempotencyKey,
    recordedAt,
  };
}

function remember(database, key, request, receipt) {
  database.idempotency[key] = { fingerprint: canonical(request), receipt: clone(receipt) };
}

function exactRetry(database, key, request) {
  const prior = database.idempotency[key];
  if (!prior) return null;
  if (prior.fingerprint !== canonical(request)) {
    fail("IDEMPOTENCY_CONFLICT", `idempotency key ${key} was already used with different input`);
  }
  return clone(prior.receipt);
}

function getEntry(database, workstreamId) {
  const entry = database.workstreams[workstreamId];
  if (!entry) fail("WORKSTREAM_NOT_FOUND", `workstream ${workstreamId} was not found`);
  return entry;
}

function ensureRevision(snapshot, expected) {
  if (snapshot.revision !== expected) {
    fail("STALE_REVISION", `expected revision ${expected}, current revision is ${snapshot.revision}`, { currentRevision: snapshot.revision });
  }
}

function timestamp(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) fail("INVALID_CLOCK", "clock returned an invalid date");
  return date.toISOString();
}

function toSummary(snapshot) {
  return {
    id: snapshot.id,
    title: snapshot.title,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    activeSessionCount: snapshot.sessions.filter((session) => session.status === "active").length,
    pendingSessionCount: snapshot.sessions.filter((session) => session.status === "pending").length,
    failedSessionCount: snapshot.sessions.filter((session) => session.status === "failed").length,
    unresolvedHumanTaskCount: snapshot.humanTasks.filter((task) => task.status === "pending").length,
    closed: snapshot.closed,
  };
}

function validateWorkstreamId(value, limits) {
  if (typeof value !== "string" || value.length < 1 || value.length > limits.maxIdLength || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)) {
    fail("INVALID_REQUEST", "workstreamId is invalid");
  }
}

function validateQuery(query) {
  if (!query || typeof query !== "object" || Array.isArray(query)) fail("INVALID_REQUEST", "query must be an object");
  const unknown = Object.keys(query).filter((key) => !["includeClosed", "text"].includes(key));
  if (unknown.length) fail("INVALID_REQUEST", `query has unknown fields: ${unknown.join(", ")}`);
  if (query.includeClosed !== undefined && typeof query.includeClosed !== "boolean") fail("INVALID_REQUEST", "includeClosed must be boolean");
  if (query.text !== undefined && (typeof query.text !== "string" || query.text.length > 200)) fail("INVALID_REQUEST", "text must be a string of at most 200 characters");
}

function validateWatch(watch, limits) {
  if (!watch || typeof watch !== "object" || Array.isArray(watch)) fail("INVALID_REQUEST", "watch must be an object");
  const unknown = Object.keys(watch).filter((key) => !["afterSequence", "workstreamId", "limit"].includes(key));
  if (unknown.length) fail("INVALID_REQUEST", `watch has unknown fields: ${unknown.join(", ")}`);
  if (watch.afterSequence !== undefined && (!Number.isSafeInteger(watch.afterSequence) || watch.afterSequence < 0)) fail("INVALID_REQUEST", "afterSequence must be a non-negative safe integer");
  if (watch.workstreamId !== undefined) validateWorkstreamId(watch.workstreamId, limits);
  if (watch.limit !== undefined && (!Number.isSafeInteger(watch.limit) || watch.limit < 1 || watch.limit > limits.maxWatchBatch)) fail("INVALID_REQUEST", `limit must be between 1 and ${limits.maxWatchBatch}`);
}

export { WorkstreamStoreError, rebuildSnapshot };
