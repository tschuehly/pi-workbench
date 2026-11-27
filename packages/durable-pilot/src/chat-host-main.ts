// Durable Chat host process for PI WEB (session-host protocol v2), one per Chat family.
//   node src/chat-host-main.ts --store <family dir> --cwd <workspace> --model <provider>/<id>|faux
//                              [--session-id <PI WEB Chat ID>] [--scripted] [--packages] [--socket <path>]
// --packages runs the bound installed Pi packages from PI_CODING_AGENT_DIR's settings (src/packages.ts).
// --end-jobs (with --store and --session-id): the owner ends a Chat whose host is gone. Cancel the family's unfinished
// background jobs and exit, without opening the store: no completion is delivered and no model request starts.
// Exit 0 once cancelled.
// --read-transcript: the history of a Chat whose host is gone, for PI WEB's history reads, without starting a host: open
// the store paused, send { transcript: { messages } } over the IPC channel, close and exit 0. No package, job, Page,
// delivery or model request runs.
// Transport: with --socket (Phase C1, a launchd job per family), an owner-only Unix socket that outlives any one session
// daemon: newline-delimited JSON, one daemon connection at a time (a new one replaces the old), and the ready handshake
// on every connection. Without it, the IPC channel of the daemon that forked the host (tests, the e2e fleet).
// Messages in:  { id, method, params? }
// Messages out: { ready: { protocol, durable, revision, storeId, ownerEpoch, pid, capabilities, resources } } once open,
//               { id, result } | { id, error }, { event }. Events emitted while no daemon is connected are dropped: a
//               reattaching daemon reads status and transcript afresh.
// `close` with `{ end: true }` is the owner ending the Chat: its background jobs are cancelled first; without it (and on
// signals or a lost daemon) they keep running. `close` with `{ reason: "upgrade" }` is PI WEB's Upgrade now: an ordinary
// close, recorded as an `upgrade-restart`; `resume` with `{ reason: "upgrade-restart" }` then makes the next host resume
// at once instead of staying paused (the owner asked for the restart). With `ifRestartSafe: true` as well (PI WEB's
// automatic upgrade), the host first stops admitting input and closes only if nothing but restart-surviving work runs;
// otherwise it answers `{ closed: false, busy }` and keeps running. The host exits after `close` or on SIGTERM/SIGINT, and an IPC host also when its daemon goes away (disconnect),
// closing the store gracefully first. A socket host stays when its daemon goes away.
import { chmodSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, type Socket } from "node:net";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { CompactionSettings } from "@earendil-works/pi-durable";
// The Workbench telemetry extension's recorder: same JSONL events, same PI_TELEMETRY_DIR.
import { createRecorder } from "../../../extensions/telemetry/telemetry.mjs";
import { chatBackupPath, startBackups } from "./backup.ts";
import { openChatHost } from "./chat.ts";
import { COMMANDS } from "./extensions.ts";
import { redact, sealed } from "./redact.ts";
import { BackgroundBash } from "./background-bash.ts";
import { setDelegationHold } from "./delegation.ts";
import { type Attachment, CAPABILITIES, ChatSession, piWebChatTitle, storedMessages, PROTOCOL, type QueueAction, type Recorder, type Resolution, type UiEvent } from "./chat-session.ts";
import type { CloseAsk, Resources } from "./workbench.ts";
import type { SpawnResult } from "./spawn-session.ts";
import { isLiveReview } from "./chat-message.ts";

type Request = { id: number; method: string; params?: Record<string, unknown> };

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
		socket: { type: "string" },
		"end-jobs": { type: "boolean" },
		"read-transcript": { type: "boolean" },
	},
});
if (values["end-jobs"] === true) {
	if (values.store === undefined) throw new Error("--store is required");
	// The same Chat ID the host would use; the daemon passes its usual host arguments, the rest are ignored here.
	await new BackgroundBash({ chatId: values["session-id"] ?? values.store, cwd: values.store, rootId: () => undefined }).cancelAll();
	process.exit(0);
}
if (values.store === undefined || values.cwd === undefined || values.model === undefined) throw new Error("--store, --cwd and --model are required");
const socketPath = values.socket;
if (socketPath === undefined && process.send === undefined) throw new Error("chat-host-main must be started with an IPC channel or --socket");
if (socketPath !== undefined) {
	// Only the owner may reach the host: its folder admits nobody else (the socket itself is 0600 too).
	const folder = lstatSync(dirname(socketPath));
	if (!folder.isDirectory() || folder.uid !== process.getuid?.() || (folder.mode & 0o077) !== 0) throw new Error(`--socket must be in an owner-only folder: ${dirname(socketPath)}`);
}
/** The daemon connected over the socket, if any. */
let peer: Socket | undefined;
const write = (socket: Socket, message: unknown) => {
	if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
};
const send = (message: unknown) => {
	if (socketPath !== undefined) {
		if (peer !== undefined) write(peer, message);
	} else if (process.connected) process.send?.(message);
};

const tps = values["faux-tps"] === undefined ? undefined : Number(values["faux-tps"]);
const chatId = values["session-id"] ?? values.store;
/** Set once the orderly shutdown below is in place: an Atelier takeover from another Chat closes this host only then. */
let releasable = false;
const host = await openChatHost({
	dir: values.store,
	cwd: values.cwd,
	model: values.model,
	chatId,
	scripted: values.scripted === true,
	...(tps === undefined ? {} : { fauxTokensPerSecond: tps }),
	...(values.thinking === undefined ? {} : { thinkingLevel: values.thinking }),
	...(values.packages === true ? { packages: {} } : {}),
	...(values["read-transcript"] === true ? { readOnly: true } : {}),
	// Only a PI WEB Chat (its own --session-id) gives a Page up to another Chat; the close comes after the release answer.
	...(values["session-id"] === undefined ? {} : { release: () => (releasable ? (setImmediate(shutdown), undefined) : "it is still starting; try again in a moment.") }),
	// Tests and trials: also by environment, so PI WEB's isolated e2e daemon can ask for it without a new host argument.
	...(values["scripted-providers"] === true || process.env.PI_DURABLE_SCRIPTED_PROVIDERS === "1" ? { scriptedProviders: true } : {}),
});
if (values["read-transcript"] === true) {
	const messages = await storedMessages(host);
	await host.close();
	await new Promise((resolve, reject) => process.send?.({ transcript: { messages } }, (error) => (error === null ? resolve(undefined) : reject(error))) ?? reject(new Error("--read-transcript needs an IPC channel")));
	process.exit(0);
}
// The Chat's backup copy (src/backup.ts): every 5 min while it changed, and on close. The family folder's name is the Chat ID.
startBackups(host.store, chatBackupPath(basename(values.store)), (message) => process.stderr.write(`${redact(message)}\n`));
// Crash-matrix barriers (tests only): the named reporter fault windows announce themselves and stop until killed;
// `name@ms` releases the window after that many milliseconds instead, so a race can be staged without a kill.
const holds = new Map((process.env.PI_DURABLE_HOLD ?? "").split(",").filter(Boolean).map((hold) => {
	const [name, ms] = hold.split("@");
	return [name!, ms === undefined ? undefined : Number(ms)] as const;
}));
if (holds.size > 0)
	setDelegationHold((name, signal) => {
		if (!holds.has(name)) return Promise.resolve();
		send({ event: { type: "test.hold", name } });
		const release = holds.get(name);
		return new Promise((resolve, reject) => {
			if (release !== undefined) setTimeout(resolve, release);
			signal?.addEventListener("abort", () => reject(new Error(`hold ${name} aborted`)), { once: true });
		});
	});
// A socket host has no daemon until one connects: spawn_session and send_chat_message answer timeouts wait for it.
if (socketPath !== undefined) {
	host.spawner.disconnected();
	host.messenger.disconnected();
}
const session = new ChatSession(host, (event: UiEvent) => send({ event }), { chatId, telemetry: createRecorder() as Recorder, title: () => piWebChatTitle(values.store!, chatId) });
await session.start();

let closing: Promise<void> | undefined;
/** `end` (optional on `close`): an explicit end of the Chat, which cancels its background jobs; restarts omit it. */
const close = (end = false, upgrade = false) => (closing ??= session.close({ end, ...(upgrade ? { reason: "upgrade" as const } : {}) }));
/**
 * B's close: only if the Chat may restart now, decided with input held off (`ChatSession.quiesce`); else a refusal.
 * Past the quiet check the session admits nothing, so a close that fails or outlives its deadline must not leave a host
 * that runs on admitting nothing: it exits non-zero, its work interrupted as after a crash, as `shutdown` does.
 */
const closeIfRestartSafe = async (): Promise<{ closed: boolean; busy?: string }> => {
	const busy = closing === undefined ? await session.quiesce() : undefined;
	if (busy !== undefined) return { closed: false, busy };
	const deadline = setTimeout(() => {
		process.stderr.write(`Durable host: close did not finish within ${CLOSE_DEADLINE_MS} ms; exiting with running work interrupted\n`);
		process.exit(1);
	}, CLOSE_DEADLINE_MS);
	try {
		await close(false, true);
	} catch (error) {
		process.stderr.write(`Durable host: close failed: ${redact(error instanceof Error ? error.message : String(error))}\n`);
		process.exit(1);
	} finally {
		clearTimeout(deadline);
	}
	return { closed: true };
};

const text = (params: Record<string, unknown>, name: string): string => {
	const value = params[name];
	if (typeof value !== "string" || value === "") throw new Error(`${name} must be a non-empty string`);
	return value;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const methods: Record<string, (params: Record<string, unknown>) => unknown> = {
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
		// PI WEB answers spawn_session requests (`durable.spawn` events) with `spawned`.
		spawnSessions: params.spawnSessions === true,
		// PI WEB answers send_chat_message requests (`durable.chat-message`, `durable.chat-list`) with `chatMessaged`.
		chatMessages: params.chatMessages === true,
	}),
	spawned: (params) => {
		const { result, error } = params;
		if (error !== undefined && typeof error !== "string") throw new Error("error must be a string");
		if (result !== undefined && !(isObject(result) && typeof result.sessionId === "string" && typeof result.cwd === "string" && (result.model === undefined || typeof result.model === "string")))
			throw new Error("result must name sessionId and cwd");
		return session.spawned({ requestId: text(params, "requestId"), ...(result === undefined ? {} : { result: result as SpawnResult }), ...(error === undefined ? {} : { error }) });
	},
	chatMessaged: (params) => {
		const { result, error } = params;
		if (error !== undefined && typeof error !== "string") throw new Error("error must be a string");
		if (result !== undefined && !isObject(result)) throw new Error("result must be an object");
		return session.chatMessaged({ requestId: text(params, "requestId"), ...(result === undefined ? {} : { result: result as never }), ...(error === undefined ? {} : { error }) });
	},
	// Another Chat's message; `from` is PI WEB's record of the sender.
	chatMessage: (params) => {
		const { from, wake, urgent, hop, held, liveReview } = params;
		if (!isObject(from) || typeof from.chatId !== "string" || typeof from.key !== "string" || typeof from.name !== "string") throw new Error("from must name chatId, key and name");
		if (wake !== undefined && typeof wake !== "boolean") throw new Error("wake must be a boolean");
		if (urgent !== undefined && typeof urgent !== "boolean") throw new Error("urgent must be a boolean");
		if (held !== undefined && typeof held !== "boolean") throw new Error("held must be a boolean");
		if (hop !== undefined && (typeof hop !== "number" || !Number.isInteger(hop) || hop < 1)) throw new Error("hop must be a positive integer");
		if (liveReview !== undefined && !isLiveReview(liveReview)) throw new Error("liveReview must be a reviewer or a digest with a positive turn, a trigger turn, turn5 or edits, and a brief silent or coach");
		return session.chatMessage({
			requestId: text(params, "requestId"), from: { chatId: from.chatId, key: from.key, name: from.name }, text: text(params, "text"), wake: wake !== false,
			...(urgent === true ? { urgent } : {}), ...(hop === undefined ? {} : { hop }), ...(held === true ? { held } : {}), ...(liveReview === undefined ? {} : { liveReview }),
		});
	},
	compact: (params) => session.compact(typeof params.instructions === "string" ? params.instructions : undefined),
	// One command list and dispatcher: host commands (/quota-check) and the bound Pi packages' commands.
	commands: () => session.commands(),
	command: (params) => session.command(text(params, "name"), typeof params.args === "string" ? params.args : "", typeof params.operationId === "string" ? params.operationId : undefined),
	// One request outside the conversation (PI WEB's Chat title).
	complete: (params) => {
		const { maxTokens, reasoning, timeoutMs, model } = params;
		return session.complete({
			systemPrompt: text(params, "systemPrompt"),
			prompt: text(params, "prompt"),
			...(typeof maxTokens === "number" ? { maxTokens } : {}),
			...(typeof reasoning === "string" ? { reasoning: reasoning as ModelThinkingLevel } : {}),
			...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
			...(isObject(model) && typeof model.provider === "string" && typeof model.modelId === "string" ? { model: { provider: model.provider, modelId: model.modelId } } : {}),
		});
	},
	// PI WEB's title fallback source: whole text through the host's redactor, before PI WEB formats or truncates it.
	redact: (params) => sealed(redact)(text(params, "text")),
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
	close: (params) => (params.ifRestartSafe === true ? closeIfRestartSafe() : close(params.end === true, params.reason === "upgrade")),
	// The host after an Upgrade now: restored work resumes at once (recovery as after any restart), not paused.
	resume: (params) => {
		if (params.reason !== "upgrade-restart") throw new Error("resume needs reason upgrade-restart");
		return session.resume("upgrade-restart");
	},
};

/** Operations that must not overlap history navigation (legacy `assertTreeNavigationInactive`). */
const EXCLUSIVE = new Set(["prompt", "resume", "mode", "closeAsk", "setModel", "resolveEffect", "compact", "command", "mutateQueue", "setThinkingLevel", "cycleThinkingLevel", "shell"]);

/** One request; the reply goes back the way it came (a socket request to the connection that sent it). */
async function handle(message: Request, reply: (message: unknown) => void): Promise<void> {
	try {
		if (message.method === "transcript") {
			const { before, limit } = message.params ?? {};
			for (const value of [before, limit]) if (value !== undefined && !(Number.isInteger(value) && (value as number) >= 0)) throw new Error("before and limit must be non-negative integers");
			const page = before === undefined && limit === undefined ? undefined : { before: before as number | undefined, limit: limit as number | undefined };
			// No yield between reading messages/partial and sending: the daemon stamps the watermark on receipt.
			await session.snapshot(page, (result) => reply({ id: message.id, result }));
			return;
		}
		const method = methods[message.method];
		if (method === undefined) throw new Error(`Unknown method ${message.method}`);
		const run = () => Promise.resolve(method(message.params ?? {}));
		const result = await (EXCLUSIVE.has(message.method) ? session.exclusive(run) : run());
		reply({ id: message.id, result: result ?? null });
		// A refused conditional close leaves the host running.
		if (message.method !== "close" || (isObject(result) && result.closed === false)) return;
		if (socketPath !== undefined) shutdown();
		else if (process.connected) process.disconnect?.();
	} catch (error) {
		reply({ id: message.id, error: { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) } });
	}
}
if (socketPath === undefined) process.on("message", (message: Request) => void handle(message, send));
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
		() => exit(0),
		(error: unknown) => {
			process.stderr.write(`Durable host: close failed: ${redact(error instanceof Error ? error.message : String(error))}\n`);
			process.exit(1);
		},
	);
}
/** Exit once the daemon has every reply written so far (a socket host's `close` answer). */
function exit(code: number): void {
	if (peer === undefined || peer.destroyed) process.exit(code);
	peer.end(() => process.exit(code));
	setTimeout(() => process.exit(code), 500).unref();
}
process.on("disconnect", shutdown);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, shutdown);
releasable = true;

/** The revision folder this host's code runs from (an installed `pi-workbench-<rev>` folder, never a `*.installed` link). */
const REVISION = realpathSync(fileURLToPath(new URL("../../..", import.meta.url)));
/** The installed pi-durable version, as the handshake reports it. */
const DURABLE_VERSION = (createRequire(import.meta.url)("@earendil-works/pi-durable/package.json") as { version: string }).version;
// `resources`: what the bound packages contributed (resources_discover), for PI WEB to load with the Chat's others.
const ready = () => ({
	ready: {
		protocol: PROTOCOL, durable: DURABLE_VERSION, revision: REVISION, storeId: basename(values.store!), ownerEpoch: host.store.owner.epoch, pid: process.pid,
		capabilities: CAPABILITIES, resources: session.resources(),
		// `close` with `{ reason: "upgrade", ifRestartSafe: true }` closes only if the Chat may restart now (PI WEB's B).
		closeIfRestartSafe: true,
	},
});
if (socketPath === undefined) send(ready());
else {
	const server = createServer((socket) => {
		peer?.destroy();
		peer = socket;
		socket.setEncoding("utf8");
		socket.on("error", () => undefined);
		socket.on("close", () => {
			if (peer !== socket) return;
			peer = undefined;
			host.spawner.disconnected();
			host.messenger.disconnected();
		});
		let buffer = "";
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				let message: Request;
				try {
					message = JSON.parse(line) as Request;
				} catch {
					socket.destroy();
					return;
				}
				void handle(message, (answer) => write(socket, answer));
			}
		});
		write(socket, ready());
		// spawn_session and send_chat_message requests the previous daemon may have missed or left unanswered.
		host.spawner.resend();
		host.messenger.resend();
	});
	rmSync(socketPath, { force: true });
	// Created 0600 (bind is synchronous inside listen), then the umask goes back for everything the host's tools create.
	const umask = process.umask(0o077);
	try {
		server.listen(socketPath);
	} finally {
		process.umask(umask);
	}
	await new Promise<void>((resolve, reject) => server.once("listening", resolve).once("error", reject));
	chmodSync(socketPath, 0o600);
	const bound = lstatSync(socketPath);
	// Remove the socket on exit only while it is still this host's (a replacement host may have bound the path).
	process.on("exit", () => {
		try {
			const current = lstatSync(socketPath);
			if (current.ino === bound.ino && current.dev === bound.dev) rmSync(socketPath);
		} catch {
			// Already gone.
		}
	});
}
