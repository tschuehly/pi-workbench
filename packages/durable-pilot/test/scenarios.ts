// Child-process side of each crash-matrix scenario: `crash` starts work until an armed barrier, `verify` reopens,
// resumes explicitly and returns evidence. Assertions live in the *.test.ts files.
import { join } from "node:path";
import type { AssistantMessage, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { defineDoc, defineExtension, defineTask, type HarnessSettings, LiveDoc, type SubmissionId } from "@earendil-works/pi-durable";
import { fileDeferred, readLog, router } from "../src/faux.ts";
import { admit, context, editQueued, Edits, type Host, type HostOptions, openHost, Reconcile } from "../src/host.ts";
import {
	acknowledgeAttention,
	Attention,
	answerQuestion,
	ChildTools,
	collect,
	crasherTool,
	effectTool,
	entriesOf,
	LeafTools,
	notifyAttention,
	QuestionTools,
	Questions,
	requestAttention,
	StaleAnswer,
	Subagents,
} from "../src/pilot.ts";
import { type Faults, serveEndpoint } from "../src/store.ts";

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
		extensions: [tools, ChildTools, LeafTools, QuestionTools],
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
		pragmas: host.store.pragmas,
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
		await host.resume();
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
		await host.resume();
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

// ─── Children: launch/report kill points, cancellation, worker/leaf settlement ──

/** A hold that also tells the crash flow it was reached, then waits for cancellation like proc.ts's. */
function localHold(io: Io) {
	let reach!: (name: string) => void;
	const reached = new Promise<string>((resolve) => (reach = resolve));
	const hold = async (name: string, signal: AbortSignal | undefined) => {
		if (!io.armed.delete(name)) return;
		reach(name);
		await new Promise<never>((_, reject) => {
			if (signal === undefined) return;
			if (signal.aborted) reject(signal.reason);
			signal.addEventListener("abort", () => reject(signal.reason), { once: true });
		});
	};
	return { hold, reached };
}

async function childState(host: Host) {
	const doc = await host.harness.snapshot(Subagents, host.root.id, context);
	const agents = Object.entries(doc?.agents ?? {});
	const children = [];
	for (const [name, agent] of agents) {
		const t = await transcript(host, agent.conversationId);
		const leaves = (await host.root.commit((tx) => tx.scanConversations({}, 100), context)).items.filter(
			(c) => c.owner !== undefined && c.id !== agent.conversationId && c.id !== host.root.id,
		);
		const leafTranscripts = [];
		for (const leaf of leaves) leafTranscripts.push(await transcript(host, leaf.id));
		const live = await host.harness.snapshot(LiveDoc, agent.conversationId, context);
		children.push({ name, users: t.users, assistants: t.assistants, results: t.results, running: live?.run !== undefined, leaves: leafTranscripts });
	}
	const reporters = [];
	for (const id of Object.values(doc?.reporters ?? {})) {
		const record = await host.harness.getTask(id, context);
		reporters.push({ id, status: record?.state.status, outcome: record?.state.status === "terminal" ? record.state.outcome.status : null });
	}
	return { children, reporters, results: Object.values(doc?.results ?? {}) };
}

const child: Scenario = {
	async crash(dir, options, io) {
		const window = options.window as string;
		if (window === "kill-point") {
			const host = await pilotHost(dir);
			await admit(host.root, { operationId: "op-1", text: "spawn:reader child task" });
			return host;
		}
		const local = localHold(io);
		const blockOn = window === "cancel-parent" ? "child-block" : "leaf-task";
		const host = await pilotHost(dir, { holdOn: blockOn, hold: local.hold });
		io.armed.add(`request:${blockOn}`);
		await admit(host.root, { operationId: "op-1", text: window === "cancel-parent" ? "spawn:reader child-block" : "spawn:worker leaf:leaf-task" });
		await local.reached;
		const doc = (await host.harness.snapshot(Subagents, host.root.id, context))!;
		const agent = Object.values(doc.agents)[0]!;
		const data: Record<string, unknown> = {};
		if (window === "cancel-parent") {
			// Esc on the parent stops at the background boundary; ending the Chat reaches the child.
			await host.root.abort(context);
			data.childRunningAfterEsc = (await host.harness.snapshot(LiveDoc, agent.conversationId, context))?.run !== undefined;
			await host.root.abort(context, { background: true });
			data.childRunningAfterEnd = (await host.harness.snapshot(LiveDoc, agent.conversationId, context))?.run !== undefined;
		} else if (window === "cancel-worker") {
			await (await host.harness.conversation(agent.conversationId, context))!.abort(context);
		} else if (window === "cancel-leaf") {
			const leafCall = (await host.harness.snapshot(LiveDoc, agent.conversationId, context))!.tools![0]!.taskId!;
			await host.harness.abortTask(leafCall, context);
			await host.harness.waitForTask(leafCall, context);
		}
		await io.barrier(window, data);
		return host;
	},
	async verify(dir) {
		const host = await pilotHost(dir);
		await host.resume();
		const settled = await waitRequest(host, "op-1");
		const doc = await host.harness.snapshot(Subagents, host.root.id, context);
		for (const id of Object.values(doc?.reporters ?? {})) await host.harness.waitForTask(id, context);
		await host.root.waitForIdle(context);
		const state = await childState(host);
		const t = await transcript(host);
		const name = state.children[0]?.name ?? "none";
		const firstCollect = await collect(host.root, name);
		const secondCollect = await collect(host.root, name);
		const evidence = {
			settled,
			...state,
			childReports: t.users.filter((u) => u.startsWith("[child")),
			mainUsers: t.users,
			collected: { first: firstCollect.length, second: secondCollect.length },
			requestLabels: readLog<{ label: string; pid: number }>(join(dir, "requests.log")).map((r) => r.label),
			...(await common(host, dir)),
		};
		await host.close();
		return evidence;
	},
};

// ─── Queued input and admission ──────────────────────────────────────────────

const EDIT = { editId: "edit-1", operationId: "op-f2", text: "follow-2 edited" } as const;

const queue: Scenario = {
	async crash(dir, options, io) {
		const window = options.window as string;
		let holdCommit = false;
		const localFail = localHold(io);
		const host = await pilotHost(dir, {
			faults: {
				beforeCommit: async (tables) => {
					if (!holdCommit || !tables.has("submissions")) return;
					holdCommit = false;
					await io.barrier("mid-commit");
					await io.closing;
					throw new Error("injected: commit abandoned at close");
				},
			},
			...(window === "failed-run" ? { holdOn: "fail", hold: localFail.hold } : {}),
		});
		if (window === "mid-commit") {
			holdCommit = true;
			void admit(host.root, { operationId: "op-1", text: "hello" }).catch(() => {});
		} else if (window === "after-commit") {
			const id = await admit(host.root, { operationId: "op-1", text: "hello" });
			await io.barrier("committed-unacked", { id });
		} else if (window === "receipt") {
			void admit(host.root, { operationId: "op-1", text: "hello" }, { afterReceipt: () => io.barrier("receipt").then(() => new Promise(() => {})) });
		} else if (window === "order") {
			await admit(host.root, { operationId: "op-0", text: "call:wait_tool" });
			await until(host, async () => (await host.harness.snapshot(LiveDoc, host.root.id, context))?.tools?.[0]?.status === "running");
			await admit(host.root, { operationId: "op-s1", text: "steer-1", mode: "steer" });
			await admit(host.root, { operationId: "op-f1", text: "follow-1" });
			await admit(host.root, { operationId: "op-s2", text: "steer-2", mode: "steer" });
			await admit(host.root, { operationId: "op-f2", text: "follow-2" });
			const withdrawn = await admit(host.root, { operationId: "op-f3", text: "follow-3" });
			const outcome = await host.harness.abortSubmission(withdrawn, context);
			await io.barrier("queued", { withdrawn: outcome });
		} else if (window === "edit") {
			await admit(host.root, { operationId: "op-0", text: "call:wait_tool" });
			await until(host, async () => (await host.harness.snapshot(LiveDoc, host.root.id, context))?.tools?.[0]?.status === "running");
			await admit(host.root, { operationId: "op-s1", text: "steer-1", mode: "steer" });
			await admit(host.root, { operationId: "op-f1", text: "follow-1" });
			await admit(host.root, { operationId: "op-f2", text: "follow-2" });
			await admit(host.root, { operationId: "op-f3", text: "follow-3" });
			// Stop the edit at the armed step; it never acknowledges.
			const at = `edit:${options.at as string}`;
			void editQueued(host.harness, host.root, EDIT, {
				at: (step) => (`edit:${step}` === at ? io.barrier(at).then(() => new Promise<never>(() => {})) : undefined),
			}).catch(() => {});
		} else if (window === "failed-run") {
			io.armed.add("request:fail");
			await admit(host.root, { operationId: "op-0", text: "fail" });
			await localFail.reached;
			await admit(host.root, { operationId: "op-f1", text: "follow-1" });
			await io.barrier("queued");
		}
		return host;
	},
	async verify(dir, options) {
		const window = options.window as string;
		const host = await pilotHost(dir);
		await host.resume();
		const evidence: Record<string, unknown> = {};
		if (window === "order") {
			for (const op of ["op-0", "op-s1", "op-f1", "op-s2", "op-f2", "op-f3"]) evidence[op] = await waitRequest(host, op);
			await host.root.waitForIdle(context);
		} else if (window === "edit") {
			evidence.afterResume = (await host.harness.snapshot(Edits, context))?.edits["edit-1"]?.status ?? "missing";
			// The client never got the acknowledgement, so it retries the same edit; resume() already rolled it forward.
			const retry = await editQueued(host.harness, host.root, EDIT);
			evidence.retry = retry;
			for (const op of ["op-0", "op-s1", "op-f1", "op-f2", "op-f3", ...Object.values(retry.moved)]) evidence[op] = await waitRequest(host, op);
			await host.root.waitForIdle(context);
			evidence.requestLabels = readLog<{ label: string }>(join(dir, "requests.log")).map((r) => r.label);
		} else if (window === "failed-run") {
			evidence.p0 = await waitRequest(host, "op-0");
			await host.root.waitForIdle(context);
			const inspection = await host.harness.inspect(context);
			evidence.queuedAfterFailure = inspection.submissions.map((s) => ({ requestId: s.requestId, status: s.status }));
			evidence.requestsBeforeNext = readLog<{ label: string }>(join(dir, "requests.log")).map((r) => r.label);
			await admit(host.root, { operationId: "op-next", text: "next" });
			evidence.f1 = await waitRequest(host, "op-f1");
			evidence.next = await waitRequest(host, "op-next");
		} else {
			if (window === "receipt") {
				try {
					await admit(host.root, { operationId: "op-1", text: "changed" });
					evidence.changedPayload = "accepted";
				} catch (error) {
					evidence.changedPayload = (error as Error).name;
				}
			}
			evidence.retryId = await admit(host.root, { operationId: "op-1", text: "hello" });
			evidence.again = await admit(host.root, { operationId: "op-1", text: "hello" });
			evidence.settled = await waitRequest(host, "op-1");
		}
		Object.assign(evidence, { transcript: await transcript(host), ...(await common(host, dir)) });
		await host.close();
		return evidence;
	},
};

/** Wait on committed state through a document watch, not a timer. */
async function until(host: Host, check: () => Promise<boolean>): Promise<void> {
	if (await check()) return;
	const watch = (await host.harness.watchDoc(LiveDoc, host.root.id, context))!;
	await new Promise<void>((resolve) => {
		watch.start(async () => {
			if (await check()) resolve();
		});
	});
	await watch.stop();
}

// ─── Unanswered questions and attention ──────────────────────────────────────

const question: Scenario = {
	async crash(dir, options, io) {
		const window = options.window as string;
		const host = await pilotHost(dir);
		await admit(host.root, { operationId: "op-1", text: "ask:Which database?" });
		if (window === "answer-undelivered" || window === "delivered-unacked") {
			await waitRequest(host, "op-1");
			const [id] = Object.keys((await host.harness.snapshot(Questions, host.root.id, context))!.questions);
			await answerQuestion(host.root, id!, 1, "postgres");
		}
		return host;
	},
	async verify(dir) {
		const host = await pilotHost(dir);
		await host.resume();
		const asked = await waitRequest(host, "op-1");
		let questions = (await host.harness.snapshot(Questions, host.root.id, context))?.questions ?? {};
		const ids = Object.keys(questions);
		const evidence: Record<string, unknown> = { asked, questionCount: ids.length };
		if (questions[ids[0]!]?.status === "open") await answerQuestion(host.root, ids[0]!, 1, "postgres");
		const delivery = (await host.root.commit((tx) => tx.scanTasks({ conversationId: host.root.id }, 100), context)).items.filter(
			(t) => t.kind === "pilot.answer-delivery",
		);
		for (const task of delivery) await host.harness.waitForTask(task.id, context);
		await host.root.waitForIdle(context);
		try {
			await answerQuestion(host.root, ids[0]!, 1, "mysql");
			evidence.staleAnswer = "accepted";
		} catch (error) {
			evidence.staleAnswer = error instanceof StaleAnswer ? "rejected" : String(error);
		}
		questions = (await host.harness.snapshot(Questions, host.root.id, context))?.questions ?? {};
		const t = await transcript(host);
		Object.assign(evidence, {
			questions: Object.values(questions),
			deliveryTasks: delivery.length,
			answers: t.users.filter((u) => u.startsWith("[answer")),
			transcript: t,
			...(await common(host, dir)),
		});
		await host.close();
		return evidence;
	},
};

const attention: Scenario = {
	async crash(dir, _options, io) {
		const host = await pilotHost(dir);
		const first = await requestAttention(host.root, "first");
		const viewed = (await host.harness.snapshot(Attention, host.root.id, context))!.latest!.id; // the viewer sees "first"
		const second = await requestAttention(host.root, "second");
		const notified = await notifyAttention(host.root);
		await io.barrier("requested", { first, second, viewed, notified });
		return host;
	},
	async verify(dir) {
		const host = await pilotHost(dir);
		const before = (await host.harness.snapshot(Attention, host.root.id, context))!;
		const staleAck = await acknowledgeAttention(host.root, "att-1");
		const afterStale = (await host.harness.snapshot(Attention, host.root.id, context))!.latest;
		const renotify = await notifyAttention(host.root);
		const ack = await acknowledgeAttention(host.root, "att-2");
		const after = (await host.harness.snapshot(Attention, host.root.id, context))!.latest;
		const evidence = { before, staleAck, afterStale, renotify: renotify ?? null, ack, after, ...(await common(host, dir)) };
		await host.close();
		return evidence;
	},
};

// ─── Ownership and storage ───────────────────────────────────────────────────

/** crash: own the store and serve the endpoint. verify: try to own it; on success serve, report, wait for close. */
const owner: Scenario = {
	async crash(dir, _options, io) {
		const host = await pilotHost(dir);
		const endpoint = await serveEndpoint(join(dir, "session.sqlite"), host.store.owner);
		await io.barrier("open", endpoint.owner);
		return { ...host, close: async () => (await endpoint.close(), host.close()) };
	},
	async verify(dir, _options, io) {
		let host: Host;
		try {
			host = await pilotHost(dir);
		} catch (error) {
			return { rejected: true, error: (error as Error).name };
		}
		const endpoint = await serveEndpoint(join(dir, "session.sqlite"), host.store.owner);
		await io.barrier("open", endpoint.owner);
		await io.closing;
		await endpoint.close();
		await host.close();
		return { rejected: false, owner: endpoint.owner };
	},
};

/** A real SQLITE_FULL: cap the database at its current size, then admit a large input. */
const diskFull: Scenario = {
	async crash(dir, _options, io) {
		const host = await pilotHost(dir);
		await admit(host.root, { operationId: "op-0", text: "warm up" });
		await waitRequest(host, "op-0");
		const { page_count } = (await host.store.database.get<{ page_count: number }>("PRAGMA page_count"))!;
		await host.store.exec(`PRAGMA max_page_count = ${page_count}`);
		let admitted: unknown = null;
		let error: string | null = null;
		try {
			admitted = await admit(host.root, { operationId: "op-big", text: `big ${"x".repeat(400_000)}` });
		} catch (failure) {
			// The facade wraps SQLITE_FULL with a failed ROLLBACK (SQLite already rolled back) in an AggregateError.
			const inner = (failure as { errors?: unknown[] }).errors ?? [];
			error = [String((failure as Error).message ?? failure), ...inner.map((e) => String((e as Error).message ?? e))].join(" | ");
		}
		// A storage error ends the Harness; wait for that end only when the admission failed.
		const end = error === null ? "open" : (await host.harness.closed).reason;
		await io.barrier("rejected", { admitted, error, end, reports: host.reports.map((r) => r.type) });
		return { ...host, close: async () => {} };
	},
	async verify(dir) {
		const host = await pilotHost(dir);
		const before = (await submissionByRequest(host, "op-big"))?.status ?? null;
		await host.resume();
		await admit(host.root, { operationId: "op-big", text: `big ${"x".repeat(400_000)}` });
		const settled = await waitRequest(host, "op-big");
		const t = await transcript(host);
		const evidence = { before, settled, bigInputs: t.users.filter((u) => u.startsWith("big ")).length, ...(await common(host, dir)) };
		await host.close();
		return evidence;
	},
};

/** Each spawn opens; a crash-looping task kills the process until the restart limit parks it. */
const parking: Scenario = {
	async crash(dir, options, io) {
		const host = await pilotHost(dir, { settings: { restartLimit: 3 } });
		if (options.first === true) await admit(host.root, { operationId: "op-1", text: "call:crasher" });
		const inspection = await host.harness.inspect(context);
		const parked = inspection.tasks.filter((t) => t.state.kind === "blocked" && t.state.reason === "restart_limit");
		await host.resume();
		if (parked.length > 0) {
			await host.harness.inspect(context);
			await io.barrier("parked", {
				parked: parked.map((t) => ({ id: t.record.id, kind: t.record.kind })),
				wake: host.harness.wake(),
				reports: host.reports.map((r) => r.type),
				runs: readLog(join(dir, "effects.log")).length,
			});
		}
		return host;
	},
	async verify() {
		return {};
	},
};

// ─── Task and document versions ──────────────────────────────────────────────

const Counter = (version: 1 | 2, migrate?: "ok" | "throw") =>
	defineDoc<{ count: number; label?: string }>({
		kind: "pilot.versioned-doc",
		version,
		scope: "conversation",
		history: "latest",
		fork: "initial",
		initial: () => ({ count: 0 }),
		checkpointWhen: () => false,
		...(migrate === undefined ? {} : { migrate: (value) => ({ count: value.count as number, label: "migrated" }) }),
	});

const Versioned = (version: 1 | 2, migrate?: "ok" | "throw") =>
	defineTask<{ n: number; label?: string }, { phase: "work" }, string>({
		name: "pilot.versioned",
		version,
		initial: () => ({ phase: "work" }),
		phases: {
			work: async (task, runtime, c) => {
				await holdIn(versionsIo!, "v1-running", runtime.signal);
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: `v${version} ${task.input.label ?? "-"}` } }), c);
			},
		},
		abort: (_t, runtime, c) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), c),
		...(migrate === undefined
			? {}
			: {
					migrate: (input: unknown, checkpoint: unknown) => {
						if (migrate === "throw") throw new Error("scripted migration failure");
						return { input: { ...(input as { n: number }), label: "migrated" }, checkpoint: checkpoint as { phase: "work" } };
					},
				}),
	});
let versionsIo: Io | undefined;

const versions: Scenario = {
	async crash(dir, _options, io) {
		versionsIo = io;
		const host = await pilotHost(dir);
		host.registry.install(defineExtension({ name: "pilot.versioned", tasks: [Versioned(1)] }));
		await host.root.commit(async (tx) => {
			(await tx.doc(Counter(1), host.root.id)).count = 7;
			await tx.createTask(Versioned(1), { n: 1 }, { ownership: { kind: "conversation" } });
		}, context);
		await host.resume();
		return host;
	},
	async verify(dir, options, io) {
		versionsIo = io;
		const variant = options.variant as "upgrade" | "missing" | "failed";
		const host = await pilotHost(dir);
		const task = variant === "upgrade" ? Versioned(2, "ok") : variant === "failed" ? Versioned(2, "throw") : undefined;
		if (task !== undefined) host.registry.install(defineExtension({ name: "pilot.versioned", tasks: [task] }));
		await host.resume();
		const id = (await host.root.commit((tx) => tx.scanTasks({ conversationId: host.root.id }, 100), context)).items.find((t) => t.kind === "pilot.versioned")!.id;
		const inspect = async () => (await host.harness.inspect(context)).tasks.find((t) => t.record.id === id)?.state ?? null;
		const evidence: Record<string, unknown> = { doc: await host.harness.snapshot(Counter(2, "ok"), host.root.id, context) };
		if (variant === "upgrade") {
			evidence.outcome = (await host.harness.waitForTask(id, context)).state.outcome;
		} else {
			evidence.blocked = await inspect();
			evidence.wake = host.harness.wake();
			if (variant === "missing") {
				host.registry.install(defineExtension({ name: "pilot.versioned", tasks: [Versioned(1)] }));
				evidence.outcome = (await host.harness.waitForTask(id, context)).state.outcome;
			}
		}
		Object.assign(evidence, { reports: host.reports.map((r) => r.type) });
		await host.close();
		return evidence;
	},
};

export const scenarios: Record<string, Scenario> = { generation, tools, child, queue, question, attention, owner, diskFull, parking, versions };
export type { SubmissionId };
