// The original tools run unchanged inside Seatbelt, so fallback path spellings, images and every file a
// recursive search opens get the kernel's decision. Only the bounded tool result crosses back to the host.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { fenced, inheritedReadFence, readLaunch } from "../../../extensions/background-bash/sandbox.mjs";
import type { BackgroundBash } from "./background-bash.ts";

export function fencedReader(tool: ToolRegistration, bash?: BackgroundBash): ToolRegistration {
	return { ...tool, execute: async (args, api, c) => {
		if (bash?.readerUnfenced(api.conversationId) ?? (!fenced() || inheritedReadFence())) return tool.execute(args, api, c);
		const agent = await api.agent(c);
		const cwd = api.env?.cwd ?? agent.cwd;
		if (!cwd) throw new Error("No workspace for fenced read");
		const ref = agent.model;
		const model = ref && api.models.getModel(ref.provider, ref.modelId);
		const { file, args: argv } = readLaunch([process.execPath, fileURLToPath(new URL("./read-tool-main.ts", import.meta.url))], process.env);
		return new Promise((resolve, reject) => {
			const child = execFile(file, argv, { cwd, signal: c.abortSignal, maxBuffer: 64 * 1024 * 1024,
				env: { HOME: process.env.HOME, PATH: process.env.PATH, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR },
			}, (error, stdout, stderr) => {
				if (error) return reject(new Error(stderr.trim() || error.message));
				try { resolve(JSON.parse(stdout)); } catch (err) { reject(err); }
			});
			child.stdin!.on("error", () => {});
			child.stdin!.end(JSON.stringify({ name: tool.name, args, model: model && { id: model.id, input: model.input, inputLimits: model.inputLimits } }));
		});
	} };
}
