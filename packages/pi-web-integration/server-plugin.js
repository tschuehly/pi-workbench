import workstreamService from "./workstream-service.js";

export default {
  apiVersion: 3,
  name: "Pi Workbench Workstreams",
  activate() {
    return {
      peer: {
        request(context) {
          context.signal.throwIfAborted();
          return workstreamService.handle({ operation: context.operation, input: context.input });
        },
      },
    };
  },
};
