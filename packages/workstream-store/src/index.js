import { homedir } from "node:os";
import { join } from "node:path";
import { FileWorkstreamAdapter, InMemoryWorkstreamAdapter } from "./adapters.js";
import { WorkstreamStore, WorkstreamStoreError, rebuildSnapshot } from "./store.js";

export function createUserLocalWorkstreamStore(options = {}) {
  const directory = options.directory ?? join(homedir(), ".pi-workbench", "workstreams");
  const adapter = new FileWorkstreamAdapter({
    directory,
    eventRetention: options.eventRetention,
    lockTimeoutMs: options.lockTimeoutMs,
  });
  return new WorkstreamStore({ adapter, clock: options.clock, limits: options.limits });
}

export {
  FileWorkstreamAdapter,
  InMemoryWorkstreamAdapter,
  WorkstreamStore,
  WorkstreamStoreError,
  rebuildSnapshot,
};
