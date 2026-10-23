// Tool groups for Durable Chats (extensions/tool-groups, ported): rarely used groups stay out of the lead's startup
// context as Durable `deferred` tools; `tools_enable({ group })` loads them with `control.addTools`, which Durable
// records in the conversation's `modelTools`, so the exposure survives a restart, a compaction and a fork (as of its
// entry). An enabled-group document records the choice; Orchestration "Workers" shows the workers group as legacy does.
// Exposure never widens an allowlist: `modelTools` only filters a conversation's enabled `tools`, and nested calls of a
// group tool that is not exposed in the calling conversation are blocked.
import { Type } from "@earendil-works/pi-ai";
import {
	AgentDoc,
	type Conversation,
	defineDoc,
	defineExtension,
	defineTool,
	type Extension,
	type Harness,
	hook,
	type Registry,
	ToolTask,
	type ToolRegistration,
	wrapTool,
} from "@earendil-works/pi-durable";
import { GROUPS, inGroup } from "../../../extensions/tool-groups/groups.mjs";
import { context } from "./host.ts";
import { WorkingModeDoc } from "./workbench.ts";

type Group = keyof typeof GROUPS;
const GROUP_IDS = Object.keys(GROUPS) as Group[];

/** Groups a conversation enabled with `tools_enable`; rewindable, so a fork keeps those of its fork point. */
export const ToolGroupsDoc = defineDoc<{ enabled: string[] }>({
	kind: "workbench.tool-groups",
	version: 1,
	scope: "conversation",
	history: "rewindable",
	fork: "asOf",
	initial: () => ({ enabled: [] }),
	checkpointWhen: () => false,
});

/** Tools by provider: a Durable extension, or a Pi package's provenance (`PiPackages.sources`). */
type Provider = { readonly name: string; readonly tools?: readonly { readonly name: string }[] };

/** Group members among the providers' tools: by name, or (monitor) by the extension or package that provides them. */
export function groupMembers(extensions: readonly Provider[]): Record<Group, string[]> {
	const members = Object.fromEntries(GROUP_IDS.map((id) => [id, [] as string[]])) as Record<Group, string[]>;
	for (const extension of extensions)
		for (const tool of extension.tools ?? [])
			for (const id of GROUP_IDS) if (inGroup(id, { name: tool.name, sourceInfo: { source: extension.name } })) members[id].push(tool.name);
	return members;
}

const added = (modelTools: unknown): string[] => (Array.isArray(modelTools) ? (modelTools as string[]) : ((modelTools as { add?: string[] } | undefined)?.add ?? []));

/**
 * The tool-groups extension for the given extensions' tools: deferral of every group tool, `tools_enable`, and the
 * nested-call guard.
 */
export function toolGroupsExtension(extensions: readonly Provider[]) {
	const members = groupMembers(extensions);
	const all = new Map(GROUP_IDS.flatMap((id) => members[id].map((name) => [name, id] as const)));
	const enable = defineTool({
		name: "tools_enable",
		description: [
			"Enable a tool group. workers: worker_create/dispatch/status/retire. monitor: monitor* tools for background processes and logs. atelier: the atelier tool for Pages.",
			"Call tools_enable first when you need durable workers, the background process monitor, or Atelier Pages (interactive HTML the human comments on and decides in); the tools appear on the next model request.",
		].join("\n\n"),
		parameters: Type.Object({ group: Type.Union(GROUP_IDS.map((id) => Type.Literal(id))) }, { additionalProperties: false }),
		callers: ["model"],
		replay: "safe",
		execute: async ({ group }, api, c) => {
			// Only tools this conversation has enabled: a child's allowlist leaves the group's tools out entirely.
			const agent = await api.agent(c);
			const names = [...agent.tools, ...agent.deferred].map((tool) => tool.name).filter((name) => members[group as Group].includes(name));
			if (names.length === 0) throw new Error(`No ${group} tools are registered in this session.`);
			await api.commit(async (tx) => {
				const doc = await tx.doc(ToolGroupsDoc, api.conversationId);
				if (!doc.enabled.includes(group)) doc.enabled.push(group);
			}, c);
			return { output: [{ type: "text" as const, text: `Enabled: ${names.join(", ")}.` }], details: { group, enabled: names }, control: { addTools: names } };
		},
	});
	return defineExtension({
		name: "workbench.tool-groups",
		tools: [enable],
		wraps: [...all.keys()].map((name) => wrapTool({ name } as ToolRegistration, (tool) => ({ ...tool, deferred: true as const }))),
		hooks: [
			hook(ToolTask, {
				beforeTool: async (call, api, c) => {
					const group = all.get(call.name);
					if (call.parent === undefined || group === undefined) return undefined;
					const agent = await api.snapshot(AgentDoc, api.conversationId, c);
					return added(agent?.modelTools).includes(call.name) ? undefined : { block: `The ${group} tool group is not enabled in this conversation; call tools_enable first.` };
				},
			}),
		],
	});
}

/**
 * Show the workers group while Orchestration is Workers and hide it again when the group was not enabled with
 * `tools_enable` (legacy `pi-workbench:working-mode` handling). Other loaded tools stay as they are.
 */
export async function syncWorkersGroup(harness: Harness, registry: Registry, conversation: Conversation, extensions: readonly Extension[]): Promise<void> {
	const workers = groupMembers(extensions).workers;
	if (workers.length === 0) return;
	const [mode, groups, agent] = await Promise.all([
		harness.snapshot(WorkingModeDoc, conversation.id, context),
		harness.snapshot(ToolGroupsDoc, conversation.id, context),
		harness.snapshot(AgentDoc, conversation.id, context),
	]);
	const show = mode?.selected.orchestration === "Workers" || (groups?.enabled ?? []).includes("workers");
	const current = added(agent?.modelTools);
	const next = show ? [...new Set([...current, ...workers])] : current.filter((name) => !workers.includes(name));
	if (next.length === current.length && next.every((name) => current.includes(name))) return;
	if (Array.isArray(agent?.modelTools)) return; // an explicit allowlist (a child's) is never widened or edited here
	const byName = new Map<string, ToolRegistration>(registry.snapshot().tools().map(({ tool }: { tool: ToolRegistration }) => [tool.name, tool]));
	const remove = ((agent?.modelTools as { remove?: string[] } | undefined)?.remove ?? []).flatMap((name) => byName.get(name) ?? []);
	await conversation.configure({ modelTools: { remove, add: next.flatMap((name) => byName.get(name) ?? []) } }, context);
}
