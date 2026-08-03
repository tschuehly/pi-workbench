import { createUserLocalWorkstreamStore, WorkstreamStoreError } from "../workstream-store/src/index.js";

const store = createUserLocalWorkstreamStore({
  ...(process.env.PI_WORKBENCH_WORKSTREAM_DIR === undefined ? {} : { directory: process.env.PI_WORKBENCH_WORKSTREAM_DIR }),
});

export default {
  apiVersion: 1,
  async handle(request) {
    try {
      return { ok: true, value: await dispatch(request) };
    } catch (error) {
      if (error instanceof WorkstreamStoreError) {
        return { ok: false, error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } };
      }
      if (error instanceof WorkstreamServiceRequestError) return { ok: false, error: { code: "INVALID_REQUEST", message: error.message } };
      throw error;
    }
  },
};

function dispatch(request) {
  switch (request.operation) {
    case "create": return store.create(request.input);
    case "append": return store.append(request.input);
    case "inspect": return store.inspect(workstreamId(request.input));
    case "list": return store.list(request.input ?? {});
    case "watch": return store.watch(request.input ?? {});
    case "close": return store.close(request.input);
    default: throw new WorkstreamServiceRequestError(`Unsupported Workstream operation: ${String(request.operation)}`);
  }
}

function workstreamId(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input) || typeof input.workstreamId !== "string") {
    throw new WorkstreamServiceRequestError("inspect requires a workstreamId.");
  }
  return input.workstreamId;
}

class WorkstreamServiceRequestError extends Error {}
