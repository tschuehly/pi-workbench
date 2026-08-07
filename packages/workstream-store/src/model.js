import { fail } from "./errors.js";

export const DEFAULT_LIMITS = Object.freeze({
  maxMutationBytes: 32 * 1024,
  maxRecordBytes: 8 * 1024,
  maxRecordsPerAppend: 32,
  maxTitleLength: 200,
  maxTextLength: 4_000,
  maxCheckpointPromptLength: 2_000,
  maxIdLength: 128,
  maxTaskOptions: 20,
  maxWatchBatch: 200,
});

const ANSWER_KINDS = new Set(["yes-no", "choice", "free-text"]);
const MATERIALITIES = new Set(["material", "non-material"]);

const RECORD_TYPES = new Set([
  "session.pending",
  "session.confirmed",
  "session.failed",
  "checkpoint.replaced",
  "checkpoint.failed",
  "checkpoint.stale",
  "human-task.upsert",
  "human-task.answered",
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
      keys(record.payload, ["sessionId", "associationKey", "machineId", "projectId", "workspaceId"], `${field}.payload`);
      if (record.payload.sessionId !== undefined) id(record.payload.sessionId, `${field}.payload.sessionId`, limits);
      id(record.payload.associationKey, `${field}.payload.associationKey`, limits);
      if (record.payload.machineId !== undefined) string(record.payload.machineId, `${field}.payload.machineId`, limits.maxIdLength);
      if (record.payload.projectId !== undefined) string(record.payload.projectId, `${field}.payload.projectId`, limits.maxIdLength);
      if (record.payload.workspaceId !== undefined) string(record.payload.workspaceId, `${field}.payload.workspaceId`, limits.maxIdLength);
    },
    "session.confirmed": () => {
      keys(record.payload, ["sessionId", "associationKey", "machineId", "projectId", "workspaceId"], `${field}.payload`);
      id(record.payload.sessionId, `${field}.payload.sessionId`, limits);
      if (record.payload.associationKey !== undefined) id(record.payload.associationKey, `${field}.payload.associationKey`, limits);
      if (record.payload.machineId !== undefined) string(record.payload.machineId, `${field}.payload.machineId`, limits.maxIdLength);
      if (record.payload.projectId !== undefined) string(record.payload.projectId, `${field}.payload.projectId`, limits.maxIdLength);
      if (record.payload.workspaceId !== undefined) string(record.payload.workspaceId, `${field}.payload.workspaceId`, limits.maxIdLength);
    },
    "session.failed": () => {
      keys(record.payload, ["sessionId", "associationKey", "reason"], `${field}.payload`);
      if (record.payload.sessionId !== undefined) id(record.payload.sessionId, `${field}.payload.sessionId`, limits);
      if (record.payload.associationKey !== undefined) id(record.payload.associationKey, `${field}.payload.associationKey`, limits);
      if (record.payload.sessionId === undefined && record.payload.associationKey === undefined) fail("INVALID_RECORD", `${field}.payload requires sessionId or associationKey`);
      string(record.payload.reason, `${field}.payload.reason`, limits.maxTextLength);
    },
    "checkpoint.replaced": () => {
      keys(record.payload, ["sessionId", "checkpoint"], `${field}.payload`);
      id(record.payload.sessionId, `${field}.payload.sessionId`, limits);
      const checkpoint = object(record.payload.checkpoint, `${field}.payload.checkpoint`);
      keys(checkpoint, ["id", "whatChanged", "remains", "next", "nextSessionPrompt", "references"], `${field}.payload.checkpoint`);
      id(checkpoint.id, `${field}.payload.checkpoint.id`, limits);
      string(checkpoint.whatChanged, `${field}.payload.checkpoint.whatChanged`, limits.maxTextLength);
      string(checkpoint.remains, `${field}.payload.checkpoint.remains`, limits.maxTextLength);
      string(checkpoint.next, `${field}.payload.checkpoint.next`, limits.maxTextLength);
      string(checkpoint.nextSessionPrompt, `${field}.payload.checkpoint.nextSessionPrompt`, limits.maxCheckpointPromptLength);
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
    "checkpoint.stale": () => {
      keys(record.payload, ["sessionId", "checkpointId", "reason"], `${field}.payload`);
      id(record.payload.sessionId, `${field}.payload.sessionId`, limits);
      id(record.payload.checkpointId, `${field}.payload.checkpointId`, limits);
      string(record.payload.reason, `${field}.payload.reason`, limits.maxTextLength);
    },
    "human-task.upsert": () => {
      keys(record.payload, ["task"], `${field}.payload`);
      validateHumanTaskInput(record.payload.task, limits, `${field}.payload.task`);
    },
    "human-task.answered": () => {
      keys(record.payload, ["taskId", "answerId", "answer"], `${field}.payload`);
      id(record.payload.taskId, `${field}.payload.taskId`, limits);
      id(record.payload.answerId, `${field}.payload.answerId`, limits);
      validateHumanTaskAnswer(record.payload.answer, limits, `${field}.payload.answer`);
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

function validateHumanTaskInput(value, limits, field) {
  const task = object(value, field);
  keys(task, ["id", "title", "detail", "answerKind", "options", "materiality"], field);
  id(task.id, `${field}.id`, limits);
  string(task.title, `${field}.title`, limits.maxTitleLength);
  string(task.detail, `${field}.detail`, limits.maxTextLength, { optional: true });

  const typedFields = [task.answerKind, task.options, task.materiality];
  if (typedFields.every((entry) => entry === undefined)) return;
  if (typedFields.some((entry) => entry === undefined)) {
    fail("INVALID_RECORD", `${field} must provide answerKind, options, and materiality together`);
  }
  if (!ANSWER_KINDS.has(task.answerKind)) fail("INVALID_RECORD", `${field}.answerKind is not supported`);
  if (!MATERIALITIES.has(task.materiality)) fail("INVALID_RECORD", `${field}.materiality is not supported`);
  if (!Array.isArray(task.options) || task.options.length > limits.maxTaskOptions) {
    fail("INVALID_RECORD", `${field}.options must be an array of at most ${limits.maxTaskOptions} entries`);
  }
  const optionIds = new Set();
  task.options.forEach((option, index) => {
    const optionField = `${field}.options[${index}]`;
    object(option, optionField);
    keys(option, ["id", "label"], optionField);
    id(option.id, `${optionField}.id`, limits);
    string(option.label, `${optionField}.label`, limits.maxTitleLength);
    if (optionIds.has(option.id)) fail("INVALID_RECORD", `${field}.options contains duplicate id ${option.id}`);
    optionIds.add(option.id);
  });
  if (task.answerKind === "free-text" && task.options.length !== 0) fail("INVALID_RECORD", `${field}.options must be empty for free-text tasks`);
  if (task.answerKind === "choice" && task.options.length < 1) fail("INVALID_RECORD", `${field}.options must contain at least one choice`);
  if (task.answerKind === "yes-no" && (task.options.length < 2 || task.options.length > 3 || !optionIds.has("yes") || !optionIds.has("no") || [...optionIds].some((optionId) => !["yes", "no", "change"].includes(optionId)))) {
    fail("INVALID_RECORD", `${field}.options for yes-no tasks must contain yes and no, with optional change`);
  }
}

function validateHumanTaskAnswer(value, limits, field) {
  const answer = object(value, field);
  if (answer.kind === "free-text") {
    keys(answer, ["kind", "text"], field);
    string(answer.text, `${field}.text`, limits.maxTextLength);
    return;
  }
  if (answer.kind === "yes-no" || answer.kind === "choice") {
    keys(answer, ["kind", "optionId"], field);
    id(answer.optionId, `${field}.optionId`, limits);
    return;
  }
  fail("INVALID_RECORD", `${field}.kind is not supported`);
}

function projectHumanTask(task, record) {
  const typed = task.answerKind !== undefined;
  return {
    ...clone(task),
    answerKind: typed ? task.answerKind : null,
    options: typed ? clone(task.options) : [],
    materiality: typed ? task.materiality : null,
    sourceSessionId: record.sourceSessionId ?? null,
    status: "pending",
    answer: null,
    answerReceipt: null,
  };
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
      case "session.pending": {
        const key = payload.sessionId ?? `pending:${payload.associationKey}`;
        sessions.set(key, {
          id: key,
          status: "pending",
          associationKey: payload.associationKey,
          machineId: payload.machineId,
          projectId: payload.projectId,
          workspaceId: payload.workspaceId,
          latestCheckpoint: null,
          checkpointFailure: null,
          checkpointStaleness: null,
          launchFailure: null,
        });
        break;
      }
      case "session.confirmed": {
        const pendingEntry = [...sessions.entries()].find(([id, session]) =>
          id === payload.sessionId || (payload.associationKey !== undefined && session.associationKey === payload.associationKey));
        const [pendingKey, session] = pendingEntry ?? [payload.sessionId, {
          id: payload.sessionId,
          latestCheckpoint: null,
          checkpointFailure: null,
          checkpointStaleness: null,
          launchFailure: null,
        }];
        sessions.delete(pendingKey);
        sessions.set(payload.sessionId, {
          ...session,
          id: payload.sessionId,
          status: "active",
          associationKey: payload.associationKey ?? session.associationKey,
          machineId: payload.machineId ?? session.machineId,
          projectId: payload.projectId ?? session.projectId,
          workspaceId: payload.workspaceId ?? session.workspaceId,
          launchFailure: null,
        });
        break;
      }
      case "session.failed": {
        const failedEntry = [...sessions.entries()].find(([id, session]) =>
          id === payload.sessionId || (payload.associationKey !== undefined && session.associationKey === payload.associationKey));
        if (failedEntry) {
          const [pendingKey, session] = failedEntry;
          const failedId = payload.sessionId ?? pendingKey;
          sessions.delete(pendingKey);
          sessions.set(failedId, {
            ...session,
            id: failedId,
            status: "failed",
            associationKey: payload.associationKey ?? session.associationKey,
            launchFailure: {
              reason: payload.reason,
              recordedAt: record.recordedAt,
              revision: record.revision,
              producer: record.producer,
              sourceSessionId: record.sourceSessionId ?? null,
            },
          });
        }
        break;
      }
      case "checkpoint.replaced": {
        const session = sessions.get(payload.sessionId);
        if (session) sessions.set(payload.sessionId, {
          ...session,
          latestCheckpoint: { ...clone(payload.checkpoint), nextSessionPrompt: payload.checkpoint.nextSessionPrompt ?? null },
          checkpointFailure: null,
          checkpointStaleness: null,
        });
        break;
      }
      case "checkpoint.failed": {
        const session = sessions.get(payload.sessionId);
        if (session) sessions.set(payload.sessionId, { ...session, checkpointFailure: payload.reason });
        break;
      }
      case "checkpoint.stale": {
        const session = sessions.get(payload.sessionId);
        if (session) sessions.set(payload.sessionId, {
          ...session,
          checkpointStaleness: {
            checkpointId: payload.checkpointId,
            reason: payload.reason,
            recordedAt: record.recordedAt,
            revision: record.revision,
            producer: record.producer,
            sourceSessionId: record.sourceSessionId ?? null,
          },
        });
        break;
      }
      case "human-task.upsert":
        tasks.set(payload.task.id, projectHumanTask(payload.task, record));
        break;
      case "human-task.answered": {
        const task = tasks.get(payload.taskId);
        if (task) tasks.set(payload.taskId, {
          ...task,
          status: "answered",
          answer: clone(payload.answer),
          answerReceipt: {
            answerId: payload.answerId,
            taskId: payload.taskId,
            acceptedRevision: record.revision,
            recordedAt: record.recordedAt,
            producer: record.producer,
            sourceSessionId: record.sourceSessionId ?? null,
          },
        });
        break;
      }
      case "human-task.resolved": {
        const task = tasks.get(payload.taskId);
        if (task?.answerKind === null) tasks.delete(payload.taskId);
        else if (task) tasks.set(payload.taskId, { ...task, status: "resolved" });
        break;
      }
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
