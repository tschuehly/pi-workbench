export class WorkstreamStoreError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "WorkstreamStoreError";
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new WorkstreamStoreError(code, message, details);
}
