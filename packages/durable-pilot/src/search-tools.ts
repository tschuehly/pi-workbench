// Pi's grep, find and ls tools in Durable Chats, exactly as legacy Chats run them: the installed Pi package's own tool
// definitions (ripgrep/fd, output format, limits and truncation notices), bound to Durable's tool contract. As in a
// legacy Chat they are not in the lead's default tool set (Durable `deferred`): children whose allowlist names them
// get them, as `--tools read,grep,find,ls` does today. Read-only, so an interrupted call may rerun.
import { createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition } from "@earendil-works/pi-coding-agent";
import type { JsonObject, ToolRegistration } from "@earendil-works/pi-durable";

type PiDefinition = {
	name: string;
	description: string;
	parameters: unknown;
	execute(toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: { cwd: string }): Promise<{ content: unknown; details?: unknown }>;
};

/** grep, find and ls rooted at the Chat's workspace; a conversation's own `cwd` wins when it has one. */
export function searchTools(cwd: string): ToolRegistration[] {
	const definitions = [createGrepToolDefinition(cwd), createFindToolDefinition(cwd), createLsToolDefinition(cwd)] as unknown as PiDefinition[];
	return definitions.map((definition) => ({
		name: definition.name,
		description: definition.description,
		parameters: definition.parameters as ToolRegistration["parameters"],
		replay: "safe" as const,
		deferred: true as const,
		execute: async (args, api, c) => {
			const result = await definition.execute(api.callId, args, c.abortSignal, undefined, { cwd: (await api.agent(c)).cwd ?? cwd });
			return {
				output: result.content as never,
				...(result.details === undefined ? {} : { details: JSON.parse(JSON.stringify(result.details)) as JsonObject }),
			};
		},
	}));
}
