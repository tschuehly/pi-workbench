// Durable Chat host process for PI WEB (session-host protocol v1). PI WEB's session daemon spawns one per Chat family
// with an IPC channel; requests and replies are JSON messages on it, and the host pushes PI WEB session events.
//   node src/chat-host-main.ts --store <family dir> --cwd <workspace> --model anthropic/<id>|faux
// Messages in:  { id, method, params? }
// Messages out: { ready: { protocol, durable, ownerEpoch } } once open, { id, result } | { id, error }, { event }.
// The host exits after `close`, or when PI WEB goes away (IPC disconnect), closing the store gracefully first.
// ponytail: the IPC channel ties the host's life to its session daemon; Phase C moves hosts to their own service owner.
import { parseArgs } from "node:util";
import { openChatHost } from "./chat.ts";
import { ChatSession, PROTOCOL, type UiEvent } from "./chat-session.ts";

type Request = { id: number; method: string; params?: Record<string, unknown> };

const send = (message: unknown) => {
	if (process.connected) process.send?.(message);
};
if (process.send === undefined) throw new Error("chat-host-main must be started with an IPC channel");

const { values } = parseArgs({ options: { store: { type: "string" }, cwd: { type: "string" }, model: { type: "string" }, "faux-tps": { type: "string" } } });
if (values.store === undefined || values.cwd === undefined || values.model === undefined) throw new Error("--store, --cwd and --model are required");

const tps = values["faux-tps"] === undefined ? undefined : Number(values["faux-tps"]);
const host = await openChatHost({ dir: values.store, cwd: values.cwd, model: values.model, ...(tps === undefined ? {} : { fauxTokensPerSecond: tps }) });
const session = new ChatSession(host, (event: UiEvent) => send({ event }));
await session.start();

let closing: Promise<void> | undefined;
const close = () => (closing ??= session.close());

const methods: Record<string, (params: Record<string, unknown>) => unknown> = {
	transcript: () => session.transcript(),
	status: () => session.status(),
	info: () => session.info(),
	prompt: (params) => {
		const { operationId, text, mode } = params;
		if (typeof operationId !== "string" || operationId === "" || typeof text !== "string") throw new Error("prompt needs operationId and text");
		if (mode !== undefined && mode !== "steer" && mode !== "followUp") throw new Error("mode must be steer or followUp");
		return session.prompt({ operationId, text, ...(mode === undefined ? {} : { mode }) });
	},
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

send({ ready: { protocol: PROTOCOL, durable: "1.4.0", ownerEpoch: host.store.owner.epoch } });
