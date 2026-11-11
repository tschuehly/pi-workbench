export class WorkstreamStoreError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "WorkstreamStoreError";
    this.code = code;
    this.details = details;
  }
}

// Never serialize native errors (which can contain paths or tokens) into diagnostics.
export function lockUnavailable(operation, cause, jsonCommitted) {
  const details = { operation };
  if (jsonCommitted !== undefined) details.jsonCommitted = jsonCommitted;
  const error = new WorkstreamStoreError("LOCK_COORDINATOR_UNAVAILABLE",
    jsonCommitted === true
      ? "JSON is definitely committed, but lock cleanup failed. Confirm lease release before retrying; retry the exact same idempotency-key and request after confirmed release to recover the original receipt without duplicate events. Preserve artifacts and check local storage/locking."
      : "Lock coordinator unavailable; require Node >=24.13.0 with node:sqlite and owner-controlled local writable storage. Preserve artifacts and check permissions/locking before retrying.", details);
  Object.defineProperty(error, "cause", { value: cause });
  return error;
}

export function fail(code, message, details) {
  throw new WorkstreamStoreError(code, message, details);
}
