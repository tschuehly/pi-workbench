// One read-only tool call. No session, providers, credentials or access to the host IPC channel.
import { text } from "node:stream/consumers";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { createReadTool } from "@earendil-works/pi-durable/tools";

try {
	const { name, args, model } = JSON.parse(await text(process.stdin));
	const cwd = process.cwd();
	const tool = name === "read" ? createReadTool() : (await import("./search-tools.ts")).searchTools(cwd).find((t) => t.name === name);
	if (!tool) throw new Error("Unknown read tool");
	const api = { env: new NodeExecutionEnv({ cwd }), agent: async () => ({ cwd, model: model && { modelId: model.id } }), models: { getModel: () => model } };
	process.stdout.write(JSON.stringify(await tool.execute(args, api as never, BACKGROUND_CONTEXT)));
} catch (error) {
	console.error((error as Error).message);
	process.exitCode = 1;
}
