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
  const call = async (operation, input) => validateCheckpointProjection(operation, unwrap(await service.request(operation, input)));
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

function validateCheckpointProjection(operation, value) {
  const snapshots = operation === "inspect"
    ? [value]
    : operation === "watch" && isRecord(value) && value.mode === "snapshot"
      ? value.snapshots
      : undefined;
  if (snapshots === undefined) return value;
  if (!Array.isArray(snapshots) || snapshots.some((snapshot) =>
    !isRecord(snapshot)
      || !Array.isArray(snapshot.sessions)
      || snapshot.sessions.some((session) => !isRecord(session) || !isCheckpointPromptProjection(session.latestCheckpoint)))) {
    throw new WorkstreamClientError("INVALID_RESPONSE", "Workstream service returned a checkpoint projection without a canonical next-session prompt.");
  }
  return value;
}

function isCheckpointPromptProjection(checkpoint) {
  return checkpoint === null
    || isRecord(checkpoint)
      && (checkpoint.nextSessionPrompt === null
        || typeof checkpoint.nextSessionPrompt === "string"
          && checkpoint.nextSessionPrompt.trim() !== ""
          && checkpoint.nextSessionPrompt.length <= 2_000);
}

function sortSnapshots(snapshots) {
  return structuredClone(snapshots).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
