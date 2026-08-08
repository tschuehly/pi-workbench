import { homedir } from "node:os";
import { join } from "node:path";
import { FileWorkerAdapter, InMemoryWorkerAdapter } from "./adapters.js";
import { WorkerRegistry } from "./registry.js";
import { WorkerRegistryError } from "./errors.js";

export { FileWorkerAdapter, InMemoryWorkerAdapter, WorkerRegistry, WorkerRegistryError };

export function createUserLocalWorkerRegistry({ directory, clock, isProcessAlive } = {}) {
  const resolved = directory ?? join(homedir(), ".pi-workbench", "workers");
  return new WorkerRegistry({ adapter: new FileWorkerAdapter({ directory: resolved }), clock, isProcessAlive });
}
