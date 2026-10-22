// Durable Chat host process for PI WEB (session-host protocol v2). PI WEB's session daemon spawns one per Chat family
// with an IPC channel; requests and replies are JSON messages on it, and the host pushes PI WEB session events.
//   node src/chat-host-main.ts --store <family dir> --cwd <workspace> --model <provider>/<id>|faux
//                              [--session-id <PI WEB Chat ID>] [--scripted] [--packages]
// --packages runs the bound installed Pi packages from PI_CODING_AGENT_DIR's settings (src/packages.ts).
// Messages in:  { id, method, params? }
// Messages out: { ready: { protocol, durable, ownerEpoch, capabilities } } once open, { id, result } | { id, error }, { event }.
// The host exits after `close`, when PI WEB goes away (IPC disconnect), or on SIGTERM/SIGINT, closing the store
// gracefully first.
// ponytail: the IPC channel ties the host's life to its session daemon; Phase C moves hosts to their own service owner.
import { parseArgs } from "node:util";
import type { CompactionSettings } from "@earendil-works/pi-durable";
// The Workbench telemetry extension's recorder: same JSONL events, same PI_TELEMETRY_DIR.
import { createRecorder } from "../../../extensions/telemetry/telemetry.mjs";
import { openChatHost } from "./chat.ts";
import { COMMANDS } from "./extensions.ts";
import { redact } from "./redact.ts";
import { setDelegationHold } from "./delegation.ts";
import { type Attachment, CAPABILITIES, ChatSession, PROTOCOL, type QueueAction, type Recorder, type Resolution, type UiEvent } from "./chat-session.ts";
import type { CloseAsk, Resources } from "./workbench.ts";

type Request = { id: number; method: string; params?: Record<string, unknown> };

const send = (message: unknown) => {
	if (process.connected) process.send?.(message);
};
if (process.send === undefined) throw new Error("chat-host-main must be started with an IPC channel");

const { values } = parseArgs({
	options: {
		store: { type: "string" },
		cwd: { type: "string" },
		model: { type: "string" },
		"session-id": { type: "string" },
		scripted: { type: "boolean" },
		"faux-tps": { type: "string" },
		thinking: { type: "string" },
		packages: { type: "boolean" },
		"scripted-providers": { type: "boolean" },
	},
});
if (values.store === undefined || values.cwd === undefined || values.model === undefined) throw new Error("--store, --cwd and --model are required");

const tps = values["faux-tps"] === undefined ? undefined : Number(values["faux-tps"]);
const chatId = values["session-id"] ?? values.store;
const host = await openChatHost({
	dir: values.store,
	cwd: values.cwd,
	model: values.model,
	chatId,
	scripted: values.scripted === true,
	...(tps === undefined ? {} : { fauxTokensPerSecond: tps }),
	...(values.thinking === undefined ? {} : { thinkingLevel: values.thinking }),
	...(values.packages === true ? { packages: {} } : {}),
	// Tests and trials: also by environment, so PI WEB's isolated e2e daemon can ask for it without a new host argument.
	...(values["scripted-providers"] === true || process.env.PI_DURABLE_SCRIPTED_PROVIDERS === "1" ? { scriptedProviders: true } : {}),
});
// Crash-matrix barriers (tests only): the named reporter fault windows announce themselves and stop until killed.
const holds = (process.env.PI_DURABLE_HOLD ?? "").split(",").filter(Boolean);
if (holds.length > 0)
	setDelegationHold((name, signal) => {
		if (!holds.includes(name)) return Promise.resolve();
		send({ event: { type: "test.hold", name } });
		return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error(`hold ${name} aborted`)), { once: true }));
	});
const session = new ChatSession(host, (event: UiEvent) => send({ event }), { chatId, telemetry: createRecorder() as Recorder });
await session.start();

let closing: Promise<void> | undefined;
const close = () => (closing ??= session.close());

const text = (params: Record<string, unknown>, name: string): string => {
	const value = params[name];
	if (typeof value !== "string" || value === "") throw new Error(`${name} must be a non-empty string`);
	return value;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const methods: Record<string, (params: Record<string, unknown>) => unknown> = {
	transcript: () => session.transcript(),
	status: () => session.status(),
	info: () => session.info(),
	prompt: (params) => {
		const { operationId, text: body, mode } = params;
		if (typeof operationId !== "string" || operationId === "" || typeof body !== "string") throw new Error("prompt needs operationId and text");
		if (mode !== undefined && mode !== "steer" && mode !== "followUp") throw new Error("mode must be steer or followUp");
		const { images, attachments } = params;
		if (images !== undefined && (!Array.isArray(images) || !images.every((i) => typeof i?.data === "string" && typeof i?.mimeType === "string"))) throw new Error("images must be image blocks");
		return session.prompt({
			operationId, text: body, ...(mode === undefined ? {} : { mode }),
			...(images === undefined ? {} : { images: images.map((i: { data: string; mimeType: string }) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType })) }),
			...(Array.isArray(attachments) ? { attachments: attachments as Attachment[] } : {}),
		});
	},
	mode: (params) => session.mode(typeof params.args === "string" ? params.args : ""),
	closeAsk: (params) => {
		const outcome = params.outcome as CloseAsk["outcome"] | undefined;
		if (outcome === undefined || typeof outcome !== "object" || typeof params.content !== "string") throw new Error("closeAsk needs outcome and content");
		return session.closeAsk({
			askId: text(params, "askId"),
			operationId: text(params, "operationId"),
			outcome,
			content: params.content,
			...(typeof params.revision === "string" ? { revision: params.revision } : {}),
		});
	},
	acknowledgeAttention: (params) => session.acknowledgeAttention(text(params, "requestId")),
	models: () => session.models(),
	setModel: (params) => session.setModel(text(params, "provider"), text(params, "modelId")),
	resolveEffect: (params) => {
		const resolution = params.resolution;
		if (resolution !== "done" && resolution !== "not-done" && resolution !== "retry") throw new Error("resolution must be done, not-done or retry");
		return session.resolveEffect(text(params, "taskId"), resolution as Resolution);
	},
	// Pi's compaction settings ({ enabled, reserveTokens, keepRecentTokens }, or Durable's full shape in tests).
	configure: (params) => session.configure((params.resources ?? {}) as Resources, {
		...(isObject(params.compaction) ? { compaction: params.compaction as CompactionSettings } : {}),
	}),
	compact: (params) => session.compact(typeof params.instructions === "string" ? params.instructions : undefined),
	// One command list and dispatcher: host commands (/quota-check) and the bound Pi packages' commands.
	commands: () => session.commands(),
	command: (params) => session.command(text(params, "name"), typeof params.args === "string" ? params.args : ""),
	abort: () => session.abort(),
	mutateQueue: (params) => {
		const { action, index, expected } = params;
		if (!["remove", "recall", "toggle", "promote", "promoteAll"].includes(String(action))) throw new Error("Unknown queue action");
		if (typeof index !== "number" || !Number.isInteger(index) || index < 0) throw new Error("index must be a queue position");
		if (!Array.isArray(expected) || !expected.every((id) => typeof id === "number")) throw new Error("expected must list queued IDs");
		return session.mutateQueue({ editId: text(params, "editId"), action: action as QueueAction, index, expected: expected as number[] });
	},
	thinkingLevels: () => session.thinkingLevels(),
	setThinkingLevel: (params) => session.setThinkingLevel(text(params, "level")),
	cycleThinkingLevel: () => session.cycleThinkingLevel(),
	shell: (params) => session.shell(text(params, "text")),
	clearQueue: () => session.clearQueue(),
	// History navigation: the tree of retained branches, and continuing from an earlier entry.
	tree: () => session.tree(),
	navigate: (params) => {
		const { targetId, expectedLeafId, retainCheckpoint } = params;
		if (typeof targetId !== "string" || targetId.trim() === "") throw new Error("Session tree target is required");
		if (expectedLeafId !== null && typeof expectedLeafId !== "string") throw new Error("expectedLeafId must be an entry ID or null");
		return session.navigate({ targetId, expectedLeafId, ...(retainCheckpoint === true ? { retainCheckpoint } : {}) });
	},
	close: () => close(),
};

/** Operations that must not overlap history navigation (legacy `assertTreeNavigationInactive`). */
const EXCLUSIVE = new Set(["prompt", "mode", "closeAsk", "setModel", "resolveEffect", "compact", "command", "mutateQueue", "setThinkingLevel", "cycleThinkingLevel", "shell"]);

process.on("message", (message: Request) => {
	void (async () => {
		try {
			const method = methods[message.method];
			if (method === undefined) throw new Error(`Unknown method ${message.method}`);
			const run = () => Promise.resolve(method(message.params ?? {}));
			send({ id: message.id, result: (await (EXCLUSIVE.has(message.method) ? session.exclusive(run) : run())) ?? null });
			if (message.method === "close" && process.connected) process.disconnect?.();
		} catch (error) {
			send({ id: message.id, error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) } });
		}
	})();
});
/** How long an orderly shutdown waits for its close; under PI WEB's 5 s SIGTERM-to-SIGKILL grace. */
const CLOSE_DEADLINE_MS = 3000;
/**
 * An orderly shutdown (service stop, logout, PI WEB going away, the trial's stop script) closes the store gracefully:
 * committed work and the intent of a running tool stay, and restore is paused on the next open. A close that fails or
 * outlives its deadline (a tool or package ignoring cancellation) exits non-zero: the store reopens with that work
 * interrupted, as after a crash.
 */
function shutdown(): void {
	setTimeout(() => {
		process.stderr.write(`Durable host: close did not finish within ${CLOSE_DEADLINE_MS} ms; exiting with running work interrupted\n`);
		process.exit(1);
	}, CLOSE_DEADLINE_MS);
	close().then(
		() => process.exit(0),
		(error: unknown) => {
			process.stderr.write(`Durable host: close failed: ${redact(error instanceof Error ? error.message : String(error))}\n`);
			process.exit(1);
		},
	);
}
process.on("disconnect", shutdown);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, shutdown);

send({ ready: { protocol: PROTOCOL, durable: "1.4.0", ownerEpoch: host.store.owner.epoch, capabilities: CAPABILITIES } });
