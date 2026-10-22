// Minimal child, question, attention and effect fixtures the crash matrix needs, written against the pinned 1.4.0
// types. Later phases repeat the same fixtures against production bindings.
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
	type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
	AssistantEntry,
	type Conversation,
	type ConversationId,
	configure,
	defineDoc,
	defineExtension,
	defineTask,
	defineTool,
	type EntryId,
	type Harness,
	type TaskId,
	type ToolRegistration,
} from "@earendil-works/pi-durable";
import { type Hold, logLine, readLog } from "./faux.ts";
import { context } from "./host.ts";
import { redactingTool } from "./redact.ts";

let holdFn: Hold = async () => {};
/** Install the process's barrier: a fixture calls `hold(name)` at each fault window. */
export function setHold(hold: Hold): void {
	holdFn = hold;
}
const hold: Hold = (name, signal) => holdFn(name, signal);

const text = (value: string) => [{ type: "text" as const, text: value }];

function messageText(message: AssistantMessage | undefined): string {
	return (message?.content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
}

// ─── Effect tools ────────────────────────────────────────────────────────────

/** A tool with an external effect: one line in effects.log per execution, written before any barrier. */
export function effectTool(dir: string, name: string, replay: "safe" | "unsafe"): ToolRegistration {
	return redactingTool(
		defineTool({
			name,
			description: `${name} (effect)`,
			parameters: Type.Object({ target: Type.Optional(Type.String()) }),
			replay,
			execute: async (args, api, callContext) => {
				const file = join(dir, "effects.log");
				const run = readLog(file).filter((line) => line.tool === name).length + 1;
				logLine(file, { tool: name, run, target: args.target ?? null, task: api.taskId });
				api.output(`run ${run}\n`);
				await api.details({ run }, callContext);
				await hold(`tool:${name}`, callContext.abortSignal);
				return { output: text(`${name} finished run ${run}`) };
			},
		}),
	);
}

/** Deterministically crashes its process every time it runs, to exercise crash-loop parking. */
export function crasherTool(dir: string): ToolRegistration {
	return defineTool({
		name: "crasher",
		description: "crashes the host",
		parameters: Type.Object({}),
		replay: "safe",
		execute: async (_args, api) => {
			logLine(join(dir, "effects.log"), { tool: "crasher", task: api.taskId });
			process.kill(process.pid, "SIGKILL");
			return {};
		},
	});
}

// ─── Background children: anchor, reporter, collection ──────────────────────

type ChildResult = { name: string; answer: EntryId | null; status: string; collected: boolean };
export const Subagents = defineDoc<{
	agents: Record<string, { conversationId: ConversationId; anchor: TaskId }>;
	reporters: Record<string, TaskId>;
	results: Record<string, ChildResult>;
}>({
	kind: "pilot.subagents",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ agents: {}, reporters: {}, results: {} }),
	checkpointWhen: () => false,
});

const Anchor = defineTask<null, { phase: "done" }, null>({
	name: "pilot.child-anchor",
	version: 1,
	initial: () => ({ phase: "done" }),
	phases: {
		done: (_task, runtime, c) => runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), c),
	},
	abort: (_task, runtime, c) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), c),
});

type ReporterInput = { name: string; conversationId: ConversationId; message: string };
type ReporterState = { phase: "deliver" } | { phase: "report"; report?: string };
export const Reporter = defineTask<ReporterInput, ReporterState, null>({
	name: "pilot.child-reporter",
	version: 1,
	initial: () => ({ phase: "deliver" }),
	phases: {
		deliver: async (reporter, runtime, c) => {
			const { name, conversationId, message } = reporter.input;
			await hold("child:before-admission", runtime.signal);
			const child = (await runtime.conversation(conversationId, c))!;
			const submission = await child.submit(
				{ type: "input", content: message, whenBusy: "followUp", requestId: `child:${reporter.id}` },
				c,
			);
			const settled = await submission.wait(c);
			await hold("child:after-result", runtime.signal);
			// One commit records the result for collection and moves to report, so a restart decides once.
			await runtime.commit(async (tx) => {
				const doc = await tx.doc(Subagents, runtime.conversationId);
				let report: string | undefined;
				if (settled.status === "unanswered") {
					doc.results[reporter.id] = { name, answer: null, status: settled.reason, collected: false };
					report = settled.reason === "aborted" ? undefined : `[child ${name} failed: ${settled.reason}]`;
				} else if (settled.type === "input") {
					doc.results[reporter.id] = { name, answer: settled.answer, status: "answered", collected: false };
					const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0] as AssistantMessage | undefined;
					report = `[child ${name} answered] ${messageText(answer)}`;
				}
				return { status: "running", checkpoint: { phase: "report", ...(report === undefined ? {} : { report }) } } as const;
			}, c);
		},
		report: async (reporter, runtime, c) => {
			const report = reporter.state.checkpoint.report;
			await hold("child:before-delivery", runtime.signal);
			if (report !== undefined) {
				const main = (await runtime.conversation(runtime.conversationId, c))!;
				await main.submit({ type: "input", content: report, whenBusy: "followUp", requestId: `child-report:${reporter.id}` }, c);
			}
			await hold("child:after-delivery", runtime.signal);
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), c);
		},
	},
	abort: (_task, runtime, c) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), c),
});

const subagentTool: ToolRegistration = defineTool({
	name: "subagent",
	description: "Start a background child with one bounded assignment; its answer is reported back once.",
	parameters: Type.Object({ action: Type.Literal("spawn"), name: Type.String(), message: Type.String() }),
	replay: "unsafe",
	execute: async (args, api, callContext) => {
		const result = await api.commit(async (tx) => {
			const state = await tx.doc(Subagents, api.conversationId);
			if (Object.hasOwn(state.agents, args.name)) return `${args.name} already exists`;
			const background = { ownership: { kind: "conversation" }, background: true } as const;
			const anchor = await tx.createTask(Anchor, null, background);
			const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
			// No inherited transcript; no subagents of its own.
			await configure(tx, child.id, { extensions: { remove: [ChildTools] }, instructions: `You are child ${args.name}.` });
			state.agents[args.name] = { conversationId: child.id, anchor };
			state.reporters[api.taskId] = await tx.createTask(
				Reporter,
				{ name: args.name, conversationId: child.id, message: args.message },
				background,
			);
			return `Started ${args.name}`;
		}, callContext);
		return { output: text(result) };
	},
});

/** Foreground leaf: the call owns its child; the worker's answer waits for it (pattern of example 22). */
const leafTool: ToolRegistration = defineTool({
	name: "leaf",
	description: "Delegate to a leaf and wait for its answer.",
	parameters: Type.Object({ task: Type.String() }),
	replay: "safe",
	execute: async (args, api, callContext) => {
		const child = await api.commit(async (tx) => {
			const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
			if (existing !== undefined) return existing.id;
			const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
			await configure(tx, created.id, { extensions: { remove: [ChildTools, LeafTools] } });
			return created.id;
		}, callContext);
		await api.details({ conversationId: child }, callContext);
		const conversation = (await api.conversation(child, callContext))!;
		const settled = await (await conversation.submit({ type: "input", content: args.task, requestId: `leaf:${api.taskId}` }, callContext)).wait(callContext);
		if (settled.status !== "done" || settled.type !== "input") return { output: text(`leaf ${settled.status}`) };
		const answer = await api.commit((tx) => tx.entry(AssistantEntry, settled.answer), callContext);
		return { output: text(`leaf answered: ${messageText(answer?.model?.[0] as AssistantMessage)}`) };
	},
});

export const ChildTools = defineExtension({ name: "pilot.children", tasks: [Anchor, Reporter], tools: [subagentTool] });
/** Separate so a worker keeps leaves while losing subagents (lead → worker → leaf depth). */
export const LeafTools = defineExtension({ name: "pilot.leaves", tools: [leafTool] });

/** Mark uncollected results read; returns what was collected now. */
export async function collect(conversation: Conversation, name: string): Promise<string[]> {
	return conversation.commit(async (tx) => {
		const doc = await tx.doc(Subagents, conversation.id);
		const collected: string[] = [];
		for (const [id, result] of Object.entries(doc.results)) {
			if (result.name !== name || result.collected) continue;
			result.collected = true;
			collected.push(id);
		}
		return collected;
	}, context);
}

// ─── Non-blocking questions ──────────────────────────────────────────────────

type Question = { text: string; status: "open" | "answered" | "withdrawn"; revision: number; answer?: string; delivered?: boolean };
export const Questions = defineDoc<{ questions: Record<string, Question> }>({
	kind: "pilot.questions",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ questions: {} }),
	checkpointWhen: () => false,
});

/** Question ID is keyed by the tool task, so a rerun after a crash finds the same question. */
const askTool: ToolRegistration = defineTool({
	name: "ask_user",
	description: "Ask the owner a question without waiting; the answer arrives later as input.",
	parameters: Type.Object({ question: Type.String() }),
	replay: "safe",
	execute: async (args, api, callContext) => {
		const id = `q-${api.taskId}`;
		await hold("question:before-commit", callContext.abortSignal);
		await api.commit(async (tx) => {
			const doc = await tx.doc(Questions, api.conversationId);
			doc.questions[id] ??= { text: args.question, status: "open", revision: 1 };
		}, callContext);
		await hold("question:after-commit", callContext.abortSignal);
		return { output: text(`Question ${id} posted; continue with other work.`) };
	},
});

export const AnswerDelivery = defineTask<{ question: string; answer: string }, { phase: "deliver" }, null>({
	name: "pilot.answer-delivery",
	version: 1,
	initial: () => ({ phase: "deliver" }),
	phases: {
		deliver: async (task, runtime, c) => {
			await hold("answer:before-delivery", runtime.signal);
			const main = (await runtime.conversation(runtime.conversationId, c))!;
			await main.submit(
				{ type: "input", content: `[answer ${task.input.question}] ${task.input.answer}`, whenBusy: "followUp", requestId: `answer:${task.input.question}` },
				c,
			);
			await hold("answer:after-delivery", runtime.signal);
			await runtime.commit(async (tx) => {
				(await tx.doc(Questions, runtime.conversationId)).questions[task.input.question]!.delivered = true;
				return { status: "terminal", outcome: { status: "completed", result: null } };
			}, c);
		},
	},
	abort: (_task, runtime, c) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), c),
});

export const QuestionTools = defineExtension({ name: "pilot.questions", tools: [askTool], tasks: [AnswerDelivery] });

export class StaleAnswer extends Error {}

/** Revision-checked answer; commits the answer and its delivery task together. */
export async function answerQuestion(conversation: Conversation, id: string, revision: number, answer: string): Promise<TaskId> {
	return conversation.commit(async (tx) => {
		const question = (await tx.doc(Questions, conversation.id)).questions[id];
		if (question === undefined || question.status !== "open" || question.revision !== revision)
			throw new StaleAnswer(`Answer to ${id} at revision ${revision} is stale`);
		question.status = "answered";
		question.answer = answer;
		question.revision++;
		return tx.createTask(AnswerDelivery, { question: id, answer }, { ownership: { kind: "conversation" }, background: true });
	}, context);
}

// ─── request_attention: latest request, compare-by-ID acknowledgement ───────

export const Attention = defineDoc<{ latest: { id: string; reason: string } | null; notified: string | null; next: number }>({
	kind: "pilot.attention",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ latest: null, notified: null, next: 1 }),
	checkpointWhen: () => false,
});

export async function requestAttention(conversation: Conversation, reason: string): Promise<string> {
	return conversation.commit(async (tx) => {
		const doc = await tx.doc(Attention, conversation.id);
		const id = `att-${doc.next++}`;
		doc.latest = { id, reason };
		return id;
	}, context);
}

/** Clears only the exact request the viewer saw. */
export async function acknowledgeAttention(conversation: Conversation, id: string): Promise<"cleared" | "stale"> {
	return conversation.commit(async (tx) => {
		const doc = await tx.doc(Attention, conversation.id);
		if (doc.latest?.id !== id) return "stale";
		doc.latest = null;
		return "cleared";
	}, context);
}

/** Notification downstream of committed state, deduplicated by request ID. */
export async function notifyAttention(conversation: Conversation): Promise<string | undefined> {
	return conversation.commit(async (tx) => {
		const doc = await tx.doc(Attention, conversation.id);
		if (doc.latest === null || doc.notified === doc.latest.id) return undefined;
		doc.notified = doc.latest.id;
		return doc.latest.id;
	}, context);
}

export async function entriesOf(harness: Harness, id: ConversationId) {
	const conversation = (await harness.conversation(id, context))!;
	const page = await conversation.entries({}, 1000, undefined, context);
	return [...page.items].reverse();
}
