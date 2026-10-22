// Durable Chat host process for PI WEB (session-host protocol v2). PI WEB's session daemon spawns one per Chat family
// with an IPC channel; requests and replies are JSON messages on it, and the host pushes PI WEB session events.
//   node src/chat-host-main.ts --store <family dir> --cwd <workspace> --model anthropic/<id>|faux
//                              [--session-id <PI WEB Chat ID>] [--scripted]
// Messages in:  { id, method, params? }
// Messages out: { ready: { protocol, durable, ownerEpoch } } once open, { id, result } | { id, error }, { event }.
// The host exits after `close`, when PI WEB goes away (IPC disconnect), or on SIGTERM/SIGINT, closing the store
// gracefully first.
// ponytail: the IPC channel ties the host's life to its session daemon; Phase C moves hosts to their own service owner.
import { parseArgs } from "node:util";
// The Workbench telemetry extension's recorder: same JSONL events, same PI_TELEMETRY_DIR.
import { createRecorder } from "../../../extensions/telemetry/telemetry.mjs";
import { openChatHost } from "./chat.ts";
import { COMMANDS } from "./extensions.ts";
import { ChatSession, PROTOCOL, type Recorder, type Resolution, type UiEvent } from "./chat-session.ts";
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

const methods: Record<string, (params: Record<string, unknown>) => unknown> = {
	transcript: () => session.transcript(),
	status: () => session.status(),
	info: () => session.info(),
	prompt: (params) => {
		const { operationId, text: body, mode } = params;
		if (typeof operationId !== "string" || operationId === "" || typeof body !== "string") throw new Error("prompt needs operationId and text");
		if (mode !== undefined && mode !== "steer" && mode !== "followUp") throw new Error("mode must be steer or followUp");
		return session.prompt({ operationId, text: body, ...(mode === undefined ? {} : { mode }) });
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
	configure: (params) => session.configure((params.resources ?? {}) as Resources),
	commands: () => COMMANDS,
	command: (params) => session.command(text(params, "name"), typeof params.args === "string" ? params.args : ""),
	abort: () => session.abort(),
	clearQueue: () => session.clearQueue(),
	close: () => close(),
};

process.on("message", (message: Request) => {
	void (async () => {
		try {
			const method = methods[message.method];
			if (method === undefined) throw new Error(`Unknown method ${message.method}`);
			send({ id: message.id, result: (await method(message.params ?? {})) ?? null });
			if (message.method === "close" && process.connected) process.disconnect?.();
		} catch (error) {
			send({ id: message.id, error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) } });
		}
	})();
});
process.on("disconnect", () => void close());
// An orderly shutdown (service stop, logout, the trial's stop script) closes the store gracefully: committed work and
// the intent of a running tool stay, and restore is paused on the next open.
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void close().finally(() => process.exit(0)));

send({ ready: { protocol: PROTOCOL, durable: "1.4.0", ownerEpoch: host.store.owner.epoch } });
