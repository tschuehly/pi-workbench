export class WorkerRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkerRegistryError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new WorkerRegistryError(code, message);
}
