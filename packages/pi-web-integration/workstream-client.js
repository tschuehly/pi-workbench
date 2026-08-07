export class WorkstreamClientError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "WorkstreamClientError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function createWorkbenchWorkstreamClient(service) {
  if (service === undefined) throw new WorkstreamClientError("HOST_UNAVAILABLE", "This PI WEB host does not expose the plugin service transport.");
  const call = async (operation, input) => validateOperationValue(operation, unwrap(await service.request(operation, input)));
  return {
    create: (request) => call("create", request),
    append: (request) => call("append", request),
    inspect: (workstreamId) => call("inspect", { workstreamId }),
    list: (query = {}) => call("list", query),
    watch: (watch = {}) => call("watch", watch),
    close: (request) => call("close", request),
  };
}

export async function reconcileWorkstreams(client, current = { snapshots: [], sequence: 0 }) {
  const batch = await client.watch({ afterSequence: current.sequence });
  if (batch.mode === "snapshot") return { snapshots: sortSnapshots(batch.snapshots), sequence: batch.nextSequence, mode: "snapshot" };
  if (batch.events.length === 0) {
    if (current.sequence === 0 && current.snapshots.length === 0) {
      const summaries = await client.list({ includeClosed: true });
      const snapshots = await Promise.all(summaries.map((summary) => client.inspect(summary.id)));
      return { snapshots: sortSnapshots(snapshots), sequence: batch.nextSequence, mode: "replay" };
    }
    return { snapshots: structuredClone(current.snapshots), sequence: batch.nextSequence, mode: "replay" };
  }
  const changedIds = [...new Set(batch.events.map((event) => event.workstreamId))];
  const changed = await Promise.all(changedIds.map((id) => client.inspect(id)));
  const byId = new Map(current.snapshots.map((snapshot) => [snapshot.id, structuredClone(snapshot)]));
  for (const snapshot of changed) byId.set(snapshot.id, snapshot);
  return { snapshots: sortSnapshots([...byId.values()]), sequence: batch.nextSequence, mode: "replay" };
}

function unwrap(response) {
  if (!isRecord(response) || typeof response.ok !== "boolean") throw new WorkstreamClientError("INVALID_RESPONSE", "Workstream service returned an invalid response.");
  if (response.ok) return response.value;
  const error = response.error;
  if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string") throw new WorkstreamClientError("INVALID_RESPONSE", "Workstream service returned an invalid error response.");
  throw new WorkstreamClientError(error.code, error.message, error.details);
}

function validateOperationValue(operation, value) {
  const valid = operation === "create" || operation === "append" || operation === "close"
    ? isReceipt(value)
    : operation === "inspect"
      ? isWorkstreamSnapshot(value)
      : operation === "list"
        ? Array.isArray(value) && value.every(isWorkstreamSummary)
        : operation === "watch"
          ? isWatchBatch(value)
          : false;
  if (!valid) throw new WorkstreamClientError("INVALID_RESPONSE", `Workstream service returned an invalid ${operation} value.`);
  return value;
}

function isReceipt(value) {
  return isRecord(value)
    && isString(value.workstreamId)
    && isPositiveInteger(value.acceptedRevision)
    && isRecord(value.snapshotReference)
    && value.snapshotReference.workstreamId === value.workstreamId
    && value.snapshotReference.revision === value.acceptedRevision
    && isPositiveInteger(value.sequence)
    && isString(value.idempotencyKey)
    && isString(value.recordedAt);
}

function isWorkstreamSummary(value) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.title)
    && isPositiveInteger(value.revision)
    && isString(value.updatedAt)
    && isNonNegativeInteger(value.activeSessionCount)
    && isNonNegativeInteger(value.pendingSessionCount)
    && isNonNegativeInteger(value.failedSessionCount)
    && isNonNegativeInteger(value.unresolvedHumanTaskCount)
    && typeof value.closed === "boolean";
}

function isWatchBatch(value) {
  if (!isRecord(value) || !isNonNegativeInteger(value.nextSequence)) return false;
  if (value.mode === "snapshot") return Array.isArray(value.snapshots) && value.snapshots.every(isWorkstreamSnapshot);
  return value.mode === "replay" && Array.isArray(value.events) && value.events.every((event) =>
    isRecord(event)
      && isPositiveInteger(event.sequence)
      && isString(event.workstreamId)
      && isPositiveInteger(event.revision)
      && Array.isArray(event.records)
      && isString(event.recordedAt));
}

function isWorkstreamSnapshot(value) {
  return isRecord(value)
    && isString(value.id)
    && isString(value.title)
    && isPositiveInteger(value.revision)
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
      || !(value.latestCheckpoint === null || isCheckpoint(value.latestCheckpoint))
      || !(value.checkpointFailure === null || isString(value.checkpointFailure))
      || !(value.checkpointStaleness === null || isCheckpointStaleness(value.checkpointStaleness))
      || !(value.launchFailure === null || isRecordProvenance(value.launchFailure) && isString(value.launchFailure.reason))) return false;
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
    && (value.references === undefined || Array.isArray(value.references) && value.references.every(isString));
}

function isCheckpointStaleness(value) {
  return isRecordProvenance(value) && isString(value.checkpointId) && isString(value.reason);
}

function isRecordProvenance(value) {
  return isRecord(value)
    && isString(value.recordedAt)
    && isPositiveInteger(value.revision)
    && isString(value.producer)
    && (value.sourceSessionId === null || isString(value.sourceSessionId));
}

function isHumanTask(value) {
  if (!isRecord(value)
      || !isString(value.id)
      || !isString(value.title)
      || !(value.detail === undefined || isString(value.detail))
      || !Array.isArray(value.options)
      || !value.options.every((option) => isRecord(option) && isString(option.id) && isString(option.label))
      || !(value.sourceSessionId === null || isString(value.sourceSessionId))
      || !["pending", "answered", "resolved"].includes(value.status)) return false;
  const legacy = value.answerKind === null && value.materiality === null && value.options.length === 0;
  const typed = ["yes-no", "choice", "free-text"].includes(value.answerKind)
    && ["material", "non-material"].includes(value.materiality)
    && validOptions(value.answerKind, value.options);
  if (!legacy && !typed) return false;
  if (value.status === "pending") return value.answer === null && value.answerReceipt === null;
  if (value.answer === null || value.answerReceipt === null) return value.status === "resolved" && value.answer === null && value.answerReceipt === null;
  return isHumanTaskAnswer(value.answer, value.answerKind, value.options) && isAnswerReceipt(value.answerReceipt, value.id);
}

function validOptions(kind, options) {
  const ids = new Set(options.map((option) => option.id));
  if (ids.size !== options.length) return false;
  if (kind === "free-text") return options.length === 0;
  if (kind === "yes-no") return options.length >= 2 && options.length <= 3 && ids.has("yes") && ids.has("no") && [...ids].every((id) => ["yes", "no", "change"].includes(id));
  return options.length > 0;
}

function isHumanTaskAnswer(value, kind, options) {
  if (!isRecord(value) || value.kind !== kind) return false;
  if (kind === "free-text") return isString(value.text);
  return isString(value.optionId) && options.some((option) => option.id === value.optionId);
}

function isAnswerReceipt(value, taskId) {
  return isRecord(value)
    && isString(value.answerId)
    && value.taskId === taskId
    && isPositiveInteger(value.acceptedRevision)
    && isString(value.recordedAt)
    && isString(value.producer)
    && (value.sourceSessionId === null || isString(value.sourceSessionId));
}

function sortSnapshots(snapshots) {
  return structuredClone(snapshots).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
