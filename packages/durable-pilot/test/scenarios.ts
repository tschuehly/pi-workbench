// Child-process side of each crash-matrix scenario: `crash` starts work until an armed barrier, `verify` reopens,
// resumes explicitly and returns evidence. Assertions live in the *.test.ts files.
import { join } from "node:path";
import type { AssistantMessage, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { defineExtension, type HarnessSettings, LiveDoc, type SubmissionId } from "@earendil-works/pi-durable";
import { fileDeferred, readLog, router } from "../src/faux.ts";
import { admit, context, type Host, type HostOptions, openHost, Reconcile } from "../src/host.ts";
import { ChildTools, crasherTool, effectTool, entriesOf, QuestionTools } from "../src/pilot.ts";
import type { Faults } from "../src/store.ts";

export type Io = {
	readonly armed: Set<string>;
	readonly closing: Promise<void>;
	barrier(name: string, data?: unknown): Promise<void>;
};
export type Options = Record<string, unknown>;
export type Scenario = {
	crash(dir: string, options: Options, io: Io): Promise<Host>;
	verify(dir: string, options: Options, io: Io): Promise<Record<string, unknown>>;
};

type Setup = {
	readonly replay?: "safe" | "unsafe";
	readonly repropose?: boolean;
	readonly holdOn?: string;
	readonly hold?: (name: string, signal: AbortSignal | undefined) => Promise<void>;
	readonly faux?: HostOptions["faux"];
	readonly settings?: HarnessSettings;
	readonly now?: () => number;
	readonly faults?: Faults;
	readonly provider?: HostOptions["provider"];
};

/** The pilot host every scenario uses: guard, effect tools, children and questions on the scripted model. */
export async function pilotHost(dir: string, setup: Setup = {}): Promise<Host> {
	const tools = defineExtension({
		name: "pilot.tools",
		tools: [effectTool(dir, "work", setup.replay ?? "unsafe"), effectTool(dir, "deploy", "unsafe"), effectTool(dir, "wait_tool", "safe"), crasherTool(dir)],
	});
	const host = await openHost(dir, {
		extensions: [tools, ChildTools, QuestionTools],
		...(setup.faux === undefined ? {} : { faux: setup.faux }),
		...(setup.settings === undefined ? {} : { settings: setup.settings }),
		...(setup.now === undefined ? {} : { now: setup.now }),
		...(setup.faults === undefined ? {} : { faults: setup.faults }),
		...(setup.provider === undefined ? {} : { provider: setup.provider }),
	});
	const step = router(dir, {
		...(setup.repropose === undefined ? {} : { repropose: setup.repropose }),
		...(setup.holdOn === undefined ? {} : { holdOn: setup.holdOn }),
		...(setup.hold === undefined ? {} : { hold: setup.hold }),
	});
	host.faux.setResponses(Array.from({ length: 500 }, () => step));
	return host;
}

const textOf = (message: Message | undefined): string =>
	message === undefined || message.role === "system"
		? ""
		: typeof message.content === "string"
			? message.content
			: message.content.map((c) => (c.type === "text" ? c.text : "")).join("");

/** Transcript summary: kinds, user texts, assistant stop reasons, tool results. */
export async function transcript(host: Host, conversationId = host.root.id) {
	const entries = await entriesOf(host.harness, conversationId);
	const messages = entries.map((entry) => entry.model?.[0] as Message | undefined);
	return {
		kinds: entries.map((entry) => entry.kind).filter((kind) => kind !== "pi.system"),
		users: messages.filter((m) => m?.role === "user").map(textOf),
		assistants: messages
			.filter((m): m is AssistantMessage => m?.role === "assistant")
			.map((m) => ({ stop: m.stopReason, text: textOf(m).slice(0, 80) })),
		results: messages
			.filter((m): m is ToolResultMessage => m?.role === "toolResult")
			.map((m) => ({ tool: m.toolName, isError: m.isError, text: textOf(m).slice(0, 200) })),
	};
}

export async function submissionByRequest(host: Host, requestId: string) {
	return host.root.commit((tx) => tx.submissionByRequest(host.root.id, requestId), context);
}

export async function waitRequest(host: Host, requestId: string) {
	const record = await submissionByRequest(host, requestId);
	if (record === undefined) return { status: "missing" as const };
	const settled = await (await host.harness.submission(record.id, context))!.wait(context);
	return { id: record.id, status: settled.status, ...(settled.status === "unanswered" ? { reason: settled.reason } : {}) };
}

/** Counts and state any verify reports. */
export async function common(host: Host, dir: string) {
	const inspection = await host.harness.inspect(context);
	return {
		requests: readLog(join(dir, "requests.log")).length,
		requestPids: [...new Set(readLog(join(dir, "requests.log")).map((r) => r.pid))].length,
		effects: readLog(join(dir, "effects.log")),
		liveTasks: inspection.tasks.map((t) => ({ id: t.record.id, kind: t.record.kind, state: t.state.kind })),
		reports: host.reports,
		owner: host.store.owner.epoch,
	};
}

/** Paused restore: opening and inspecting runs nothing until `resume()`. */
async function pausedCheck(host: Host, dir: string) {
	const before = readLog(join(dir, "requests.log")).length;
	const inspection = await host.harness.inspect(context);
	await host.harness.snapshot(LiveDoc, host.root.id, context);
	return {
		scheduling: inspection.scheduling,
		pendingTasks: inspection.tasks.length,
		requestsUnchanged: readLog(join(dir, "requests.log")).length === before,
	};
}

// ─── Generation ──────────────────────────────────────────────────────────────

const generation: Scenario = {
	async crash(dir, options, io) {
		const window = options.window as string;
		if (window === "before-partial") {
			const host = await pilotHost(dir, { holdOn: "gen", hold: async (name, signal) => holdIn(io, name, signal) });
			await admit(host.root, { operationId: "op-1", text: "gen" });
			return host;
		}
		const deferred = window === "deferred";
		const host = await pilotHost(dir, {
			...(deferred
				? { provider: (faux) => fileDeferred(faux, dir), settings: { stream: { deferred: true } } }
				: { faux: { tokensPerSecond: 200, tokenSize: { min: 1, max: 1 } } }),
		});
		const watch = (await host.harness.watchDoc(LiveDoc, host.root.id, context))!;
		let sent = false;
		watch.start(async (value) => {
			if (sent) return;
			const message = value?.generation?.message as AssistantMessage | undefined;
			if (deferred ? value?.generation?.deferred !== undefined : textOf(message) !== "") {
				sent = true;
				await io.barrier(deferred ? "deferred" : "partial", { text: textOf(message) });
			}
		});
		await admit(host.root, { operationId: "op-1", text: "gen" });
		return host;
	},
	async verify(dir, options) {
		const deferred = options.window === "deferred";
		const host = await pilotHost(dir, {
			// The stored poll is due 60 s later; this process's clock is past it.
			...(deferred ? { provider: (faux) => fileDeferred(faux, dir), settings: { stream: { deferred: true } }, now: () => Date.now() + 120_000 } : {}),
		});
		const paused = await pausedCheck(host, dir);
		const storedPartial = textOf((await host.harness.snapshot(LiveDoc, host.root.id, context))?.generation?.message as Message | undefined);
		host.resume();
		const settled = await waitRequest(host, "op-1");
		const evidence = {
			paused,
			storedPartial,
			settled,
			transcript: await transcript(host),
			deferredSubmits: readLog(join(dir, "requests.log")).filter((r) => r.label === "deferred-submit").length,
			deferredFetches: readLog(join(dir, "requests.log")).filter((r) => r.label === "deferred-fetch").length,
			...(await common(host, dir)),
		};
		await host.close();
		return evidence;
	},
};

/** A hold used outside a fixture: same barrier semantics as proc.ts's installed hold. */
async function holdIn(io: Io, name: string, signal: AbortSignal | undefined): Promise<void> {
	if (!io.armed.delete(name)) return;
	await io.barrier(name);
	await new Promise<never>((_, reject) => {
		if (signal === undefined) return;
		if (signal.aborted) reject(signal.reason);
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}

// ─── Safe and unsafe tools ───────────────────────────────────────────────────

const tools: Scenario = {
	async crash(dir, options) {
		const host = await pilotHost(dir, { replay: options.stored as "safe" | "unsafe" });
		await admit(host.root, { operationId: "op-1", text: `call:${options.tool as string} {"target":"prod"}` });
		return host;
	},
	async verify(dir, options) {
		const host = await pilotHost(dir, { replay: options.current as "safe" | "unsafe", repropose: options.repropose === true });
		const uncertainAtOpen = [...host.uncertain];
		host.resume();
		const settled = await waitRequest(host, "op-1");
		const evidence = {
			uncertainAtOpen,
			reconcile: (await host.harness.snapshot(Reconcile, context))?.uncertain ?? {},
			settled,
			transcript: await transcript(host),
			...(await common(host, dir)),
		};
		await host.close();
		return evidence;
	},
};

export const scenarios: Record<string, Scenario> = { generation, tools };
export type { SubmissionId };
