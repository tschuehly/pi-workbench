// Workbench behavior of a Durable Chat, as PI WEB's legacy Chats have it: Working Mode (the extension's rules, state in
// a rewindable document, the block delivered as recorded conversation input), the non-blocking `ask_user` and
// `request_attention` tools with PI WEB's client contract (questions and answers survive a restart; answers are
// delivered once as a follow-up), and the resources PI WEB resolves with Pi's own loader (AGENTS.md, APPEND_SYSTEM.md,
// the skill catalog) as system-prompt sections in Pi's order.
import { createHash } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/chord";
import { type Conversation, type JsonObject, defineDoc, defineExtension, defineTask, defineTool, type EntryRecord, GenerationTask, type Harness, hook, type ToolRegistration } from "@earendil-works/pi-durable";
import {
	ALIGNMENT_RESET_TOOL,
	ALIGNMENT_TOOL,
	afkPending,
	alignmentReachedText,
	alignmentResetText,
	alignmentResetTool,
	alignmentTool,
	CUSTOM_TYPE,
	defaults,
	isSelection,
	renderBlock,
	same,
	selectFromArgs,
	usage,
	type WorkingModeDetails,
	type WorkingModeState,
} from "../../../extensions/working-mode/rules.mts";
import { context } from "./host.ts";

// ─── Entry kinds the browser projection recognises ───────────────────────────

/**
 * A user prompt with blocks around the user's own text: a Working Mode block before it (`data.workingMode`) and/or the
 * open-questions reminder as its last block (`data.askReminder`).
 */
export const PROMPT_ENTRY = "workbench.prompt";
/** A Working Mode block alone, sent with `/mode send`. */
export const MODE_ENTRY = "workbench.working-mode";
/** Answers to a closed question set (`data` is PI WEB's `AskUserOutcome`). */
export const ANSWERS_ENTRY = "workbench.ask-answers";
/** The owner's resolution of an uncertain tool effect. */
export const RECONCILE_ENTRY = "workbench.reconciliation";

/** PI WEB custom types the client renders (`working-mode`, `pi-web.ask.answers`). */
export const ASK_ANSWERS_CUSTOM_TYPE = "pi-web.ask.answers";
export { CUSTOM_TYPE as WORKING_MODE_CUSTOM_TYPE };

// ─── Working Mode ────────────────────────────────────────────────────────────

type ModeState = { selected: WorkingModeState; applied: WorkingModeState | null; aligned: boolean; phase: "selected" | "applied"; seq: number };
/** Selection and alignment, rewindable so a fork starts with the mode as of its fork point. */
export const WorkingModeDoc = defineDoc<ModeState>({
	kind: "workbench.working-mode",
	version: 1,
	scope: "conversation",
	history: "rewindable",
	fork: "asOf",
	initial: () => ({ selected: { ...defaults }, applied: null, aligned: false, phase: "selected", seq: 0 }),
	checkpointWhen: () => false,
});

export type WorkingModeSnapshot = { schemaVersion: 2; phase: "selected" | "applied"; selected: WorkingModeState; applied: WorkingModeState | null; aligned: boolean };

export async function workingModeSnapshot(harness: Harness, conversation: Conversation): Promise<WorkingModeSnapshot> {
	const doc = (await harness.snapshot(WorkingModeDoc, conversation.id, context)) ?? WorkingModeDoc.definition.initial();
	return { schemaVersion: 2, phase: doc.phase, selected: doc.selected, applied: doc.applied, aligned: doc.aligned };
}

/** The Working Mode block an entry delivered to the model, if any. */
export function entryWorkingMode(entry: EntryRecord): WorkingModeDetails | undefined {
	const data = entry.data as { workingMode?: WorkingModeDetails } | undefined;
	return (entry.kind === PROMPT_ENTRY || entry.kind === MODE_ENTRY || entry.kind === "workbench.context-checkpoint") && isSelection(data?.workingMode?.selection) ? data!.workingMode : undefined;
}

/**
 * The block to deliver now, or undefined when the model still sees the selection: compared with the latest block in the
 * active context, so a block compaction summarized away is attached again. Commits the next sequence number and marks
 * the selection applied.
 */
export async function pendingBlock(harness: Harness, conversation: Conversation, sent: boolean): Promise<{ text: string; details: WorkingModeDetails } | undefined> {
	const view = await conversation.context(context);
	let seen: WorkingModeDetails | undefined;
	for (const entry of view.entries) seen = entryWorkingMode(entry) ?? seen;
	return conversation.commit(async (tx) => {
		const doc = await tx.doc(WorkingModeDoc, conversation.id);
		doc.applied = { ...doc.selected };
		doc.phase = "applied";
		if (same(seen?.selection ?? defaults, doc.selected) && (seen?.aligned ?? false) === doc.aligned) return undefined;
		doc.seq = Math.max(doc.seq, seen?.seq ?? 0) + 1;
		const details: WorkingModeDetails = { schemaVersion: 2, seq: doc.seq, selection: { ...doc.selected }, aligned: doc.aligned };
		return { text: renderBlock(doc.selected, doc.seq, doc.aligned, sent), details: JSON.parse(JSON.stringify(details)) as WorkingModeDetails };
	}, context);
}

/** Durable's framing of a placed compaction summary (pi-durable `SUMMARY_PREFIX`), as model context carries it. */
const SUMMARY_PREFIX = "The conversation history before this point was compacted into the following summary:";
const BLOCK = /<working-mode seq="\d+">/;
const partsOf = (content: unknown): { type: string; text?: string }[] => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []);
const textOf = (content: unknown) => partsOf(content).map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");

/**
 * The applied Working Mode block for requests whose context starts at a compaction summary that took the last block
 * with it. Legacy Pi compacts before a prompt, so `before_agent_start` attaches the block to that prompt; a Durable
 * threshold compaction runs after the prompt was admitted, so the requests that follow the summary carry the block
 * right after it, memoized per generation (a retried or recovered request sends the same text). The next prompt
 * delivers it again as recorded input (`pendingBlock`), after which nothing is added here.
 */
const reattachMode = hook(GenerationTask, {
	beforeRequest: async ({ messages }, api, c) => {
		const at = messages.findLastIndex((m) => m.role === "user" && textOf(m.content).startsWith(SUMMARY_PREFIX));
		if (at < 0 || messages.slice(at + 1).some((m) => m.role === "user" && BLOCK.test(textOf(m.content)))) return undefined;
		const doc = await api.snapshot(WorkingModeDoc, api.conversationId, c);
		if (doc?.applied == null || (same(doc.applied, defaults) && !doc.aligned)) return undefined;
		const block = await api.memo<string>("workbench.working-mode-reattach", renderBlock(doc.applied, doc.seq, doc.aligned, false), c);
		const summary = messages[at]!;
		return { messages: messages.map((m, i) => (i === at ? ({ ...summary, content: [...partsOf(summary.content), { type: "text", text: block }] } as typeof m) : m)) };
	},
});

/** `/mode <axis> <value>`: change the selection for the next prompt; a usage message for invalid arguments. */
export async function selectMode(conversation: Conversation, args: string): Promise<{ ok: boolean; message: string }> {
	return conversation.commit(async (tx) => {
		const doc = await tx.doc(WorkingModeDoc, conversation.id);
		const next = selectFromArgs(doc.selected, doc.aligned, args);
		if (next === undefined) return { ok: false, message: usage };
		doc.selected = next.selection;
		doc.aligned = next.aligned;
		doc.phase = "selected";
		return { ok: true, message: "Working Mode applies with the next prompt." };
	}, context);
}

const text = (value: string) => [{ type: "text" as const, text: value }];

const alignmentTools: ToolRegistration[] = [
	defineTool({
		name: ALIGNMENT_TOOL,
		description: alignmentTool.description,
		parameters: Type.Object({ agreement: Type.String({ minLength: 1, description: alignmentTool.agreement }) }),
		replay: "safe",
		execute: async (args, api, c) => {
			const result = await api.commit(async (tx) => {
				const doc = await tx.doc(WorkingModeDoc, api.conversationId);
				const wasPending = afkPending(doc.selected, doc.aligned);
				doc.aligned = true;
				return { text: alignmentReachedText(wasPending), alignment: doc.selected.alignment };
			}, c);
			return { output: text(result.text), details: { alignment: result.alignment, agreement: args.agreement } };
		},
	}),
	defineTool({
		name: ALIGNMENT_RESET_TOOL,
		description: alignmentResetTool.description,
		parameters: Type.Object({ reason: Type.String({ minLength: 1, description: alignmentResetTool.reason }) }),
		replay: "safe",
		execute: async (args, api, c) => {
			const result = await api.commit(async (tx) => {
				const doc = await tx.doc(WorkingModeDoc, api.conversationId);
				doc.aligned = false;
				return { text: alignmentResetText(doc.selected), alignment: doc.selected.alignment };
			}, c);
			return { output: text(result.text), details: { alignment: result.alignment, reason: args.reason } };
		},
	}),
];

// ─── ask_user and request_attention (PI WEB's client contract) ──────────────

// PI WEB `src/shared/apiTypes.ts` limits and shapes; the browser and daemon validate against the same numbers.
const QUESTION_LIMIT = 20;
const OPTION_LIMIT = 12;
const ID_MAX = 128;
const TEXT_MAX = 1_000;
const CONTEXT_MAX = 4_000;

type Option = { value: string; label: string; detail?: string; recommended?: boolean };
type Question = { id: string; question: string; detail?: string; options: Option[]; multiple?: boolean };
export type PendingAsk = { askId: string; askedAt: string; updatedAt: string; revision: string; turnsSinceUpdate: number; context?: string; questions: Question[] };
type Outcome = JsonObject & { askId: string; reason: string };
type Closed = { outcome: Outcome; operationId?: string; delivered: boolean };
export type Attention = { id: string; reason: string };

type QuestionsState = {
	open: Record<string, PendingAsk>;
	/** Ask by the tool task that posted or revised it, so a rerun after a restart finds its own result. */
	byTask: Record<string, string>;
	closed: Record<string, Closed>;
	attention: Attention | null;
	/** Latest attention request (or ask) a notification went out for: reconnect never re-notifies. */
	notified: string[];
};
/** Open questions, closed outcomes and the attention request; a new Chat fork starts without them. */
export const QuestionsDoc = defineDoc<QuestionsState>({
	kind: "workbench.questions",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ open: {}, byTask: {}, closed: {}, attention: null, notified: [] }),
	checkpointWhen: () => false,
});

class AskError extends Error {}

function requireId(value: string, field: string): string {
	if (value.trim() === "") throw new AskError(`${field} must not be empty`);
	if (value.length > ID_MAX) throw new AskError(`${field} exceeds its length limit`);
	return value;
}
function requireText(value: string, field: string): string {
	if (value.trim() === "") throw new AskError(`${field} must not be empty`);
	if (value.length > TEXT_MAX) throw new AskError(`${field} exceeds its length limit`);
	return value;
}

/** PI WEB `pendingAskStore.ts` validation of a question set (ids, duplicates, limits, required prose). */
function validateQuestions(questions: readonly Question[]): Question[] {
	if (questions.length === 0) throw new AskError("An ask must contain at least one question");
	if (questions.length > QUESTION_LIMIT) throw new AskError(`An ask must not contain more than ${QUESTION_LIMIT} questions`);
	const ids = new Set<string>();
	return questions.map((question) => {
		const id = requireId(question.id, "question id");
		if (ids.has(id)) throw new AskError(`Duplicate question id ${id}`);
		ids.add(id);
		if (question.options.length > OPTION_LIMIT) throw new AskError(`Question ${id} must not offer more than ${OPTION_LIMIT} options`);
		const values = new Set<string>();
		const options = question.options.map((option) => {
			const value = requireId(option.value, `option value of question ${id}`);
			if (values.has(value)) throw new AskError(`Duplicate option value ${value} in question ${id}`);
			values.add(value);
			return {
				value,
				label: requireText(option.label, `label of option ${value} in question ${id}`),
				...(option.detail === undefined ? {} : { detail: requireText(option.detail, `detail of option ${value} in question ${id}`) }),
				...(option.recommended === true ? { recommended: true } : {}),
			};
		});
		return {
			id,
			question: requireText(question.question, `text of question ${id}`),
			...(question.detail === undefined ? {} : { detail: requireText(question.detail, `detail of question ${id}`) }),
			options,
			...(question.multiple === true ? { multiple: true } : {}),
		};
	});
}

function validateContext(value: string | undefined): string | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	if (value.length > CONTEXT_MAX) throw new AskError("context exceeds its length limit");
	return value;
}

/** A UUID-shaped ID derived from the Chat and tool task, so a rerun of the same call gets the same ID. */
function stableId(...parts: string[]): string {
	const hex = createHash("sha256").update(parts.join("\0")).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const questionRef = (askId: string, questionId: string) => `${askId.slice(0, 3)}.${questionId}`;
const refs = (ask: PendingAsk) => ask.questions.map((q) => questionRef(ask.askId, q.id)).join(", ");

const OptionParams = Type.Object({
	value: Type.String({ maxLength: ID_MAX, description: "Stable machine value reported back to you when the user picks this option." }),
	label: Type.String({ maxLength: TEXT_MAX, description: "Short label the user reads, ideally a few words." }),
	detail: Type.Optional(Type.String({ maxLength: TEXT_MAX, description: "Optional clarification shown under the label." })),
	recommended: Type.Optional(Type.Boolean({ description: "Mark the option you recommend." })),
});
const QuestionParams = Type.Object({
	id: Type.String({ maxLength: ID_MAX, description: "Unique within this call; used as the answer key reported back to you." }),
	question: Type.String({ maxLength: TEXT_MAX, description: "The question itself, as one plain-text line." }),
	detail: Type.Optional(Type.String({ maxLength: TEXT_MAX, description: "Optional supporting context shown under the question." })),
	options: Type.Optional(Type.Array(OptionParams, { maxItems: OPTION_LIMIT, description: "Options to choose from. Omit when free text is the whole answer; the browser always adds a Custom choice." })),
	multiple: Type.Optional(Type.Boolean({ description: "Allow several options at once. Default: one answer per question." })),
});
const AskParams = Type.Object({
	context: Type.Optional(Type.String({ maxLength: CONTEXT_MAX, description: "Required for a new set. Markdown shown above the questions, at most five short lines: only the finding the decision rests on, so the user can answer without reading the Chat. Put each option's consequence in its `detail` and mark the recommended option there; do not restate the options, the history, or check results here." })),
	questions: Type.Optional(Type.Array(QuestionParams, { minItems: 1, maxItems: QUESTION_LIMIT, description: "Required for a new set: the questions in reading order. Every question may be left unanswered." })),
	update: Type.Optional(Type.String({ maxLength: ID_MAX, description: "askId of an open set to revise in place. Given context/questions replace the old ones; send neither to confirm the set is still current." })),
	withdraw: Type.Optional(Type.String({ maxLength: ID_MAX, description: "askId of an open set to withdraw because it no longer matters. Send nothing else." })),
});

// PI WEB askUserTool.ts description and prompt guidelines (Durable tools carry no separate guideline field).
const ASK_DESCRIPTION = [
	"Post a self-contained question set, shown as question chips above the user's composer, and return immediately. Answers arrive later as a follow-up message; the user may leave any question unanswered. Pass update: <askId> to revise or confirm an open set, or withdraw: <askId> to drop one.",
	"Use ask_user to batch the decisions you need from the user into one question set rather than asking in prose. It returns immediately: keep working on anything that does not depend on the answers, and end your turn if nothing does. The answers come back as a follow-up message that wakes you; do not poll or repost.",
	"Keep each ask_user set self-contained and short: context is at most five short lines with only the finding the decision rests on; each option states its own consequence in `detail`, and the recommended option is marked. The user must be able to answer without reading the Chat.",
	"Keep open ask_user sets current: when the facts change, call ask_user with update: <askId> (no other fields just confirms it) or withdraw: <askId>.",
].join("\n\n");

const ATTENTION_DESCRIPTION = [
	"Notify the user that this Chat needs them and mark it until they look, then return immediately. Use when you need the user but have no decision to ask: finished work that needs their review, a login or credential, a manual check only they can do, or being blocked. Decisions go to ask_user instead.",
	"Do not call request_attention for routine progress or after every turn. Write the reason so the user can act without reading the Chat: what you need from them and why, in one short line.",
].join("\n\n");

/** Host-side events for PI WEB, emitted after the commit they describe. */
export type WorkbenchSignal =
	| { type: "ask.opened"; ask: PendingAsk }
	| { type: "ask.closed"; askId: string; reason: string }
	| { type: "attention"; kind: "ask" | "attention"; id: string; detail: string };

type Signal = (signal: WorkbenchSignal) => void;

function toQuestion(param: { id: string; question: string; detail?: string; options?: Option[]; multiple?: boolean }): Question {
	return {
		id: param.id,
		question: param.question,
		...(param.detail === undefined ? {} : { detail: param.detail }),
		options: (param.options ?? []).map((o) => ({ value: o.value, label: o.label, ...(o.detail === undefined ? {} : { detail: o.detail }), ...(o.recommended === true ? { recommended: true } : {}) })),
		...(param.multiple === undefined ? {} : { multiple: param.multiple }),
	};
}

function askTools(chatId: string, signal: Signal): ToolRegistration[] {
	const ask = defineTool({
		name: "ask_user",
		description: ASK_DESCRIPTION,
		parameters: AskParams,
		// Keyed by the tool task: a rerun after a restart finds the set it already posted instead of posting another.
		replay: "safe",
		execute: async (args, api, c) => {
			const now = new Date(api.now()).toISOString();
			const questions = args.questions?.map(toQuestion);
			const result = await api.commit(async (tx) => {
				const doc = await tx.doc(QuestionsDoc, api.conversationId);
				const task = String(api.taskId);
				if (args.withdraw !== undefined) {
					if (args.update !== undefined || args.context !== undefined || questions !== undefined) throw new AskError("withdraw takes no other parameters");
					const open = doc.open[args.withdraw];
					const closed = doc.closed[args.withdraw];
					if (open === undefined) {
						if (closed?.outcome.reason === "withdrawn" && doc.byTask[task] === args.withdraw) return { kind: "withdrawn" as const, askId: args.withdraw, rerun: true };
						throw new AskError(`No open question set ${args.withdraw}: it was already answered, withdrawn, or closed.`);
					}
					delete doc.open[args.withdraw];
					doc.byTask[task] = args.withdraw;
					doc.closed[args.withdraw] = { outcome: unansweredOutcome(open, "withdrawn", now), delivered: true };
					return { kind: "withdrawn" as const, askId: args.withdraw, rerun: false };
				}
				const known = doc.byTask[task];
				if (known !== undefined && doc.open[known] !== undefined) return { kind: args.update === undefined ? ("opened" as const) : ("updated" as const), ask: doc.open[known]!, rerun: true };
				const context = validateContext(args.context);
				if (args.update !== undefined) {
					const current = doc.open[args.update];
					if (current === undefined) throw new AskError(`No open question set ${args.update}: it was already answered, withdrawn, or closed.`);
					const updated: PendingAsk = {
						...current,
						updatedAt: now,
						revision: stableId(chatId, task, "revision"),
						turnsSinceUpdate: 0,
						...(context === undefined ? {} : { context }),
						questions: questions === undefined ? current.questions : validateQuestions(questions),
					};
					doc.open[args.update] = updated;
					doc.byTask[task] = args.update;
					return { kind: "updated" as const, ask: updated, rerun: false };
				}
				if (context === undefined)
					throw new AskError("context is required: explain the finding, the options, their consequences, and your recommendation so the user can answer without reading the Chat");
				if (questions === undefined) throw new AskError("questions are required for a new question set");
				const validated = validateQuestions(questions);
				// A fresh ID whose 3-character question-ref prefix no open set shares, as PI WEB's store picks one.
				const taken = new Set(Object.keys(doc.open).map((id) => id.slice(0, 3)));
				let askId = stableId(chatId, task);
				for (let n = 1; n < 20 && taken.has(askId.slice(0, 3)); n++) askId = stableId(chatId, task, String(n));
				const opened: PendingAsk = { askId, askedAt: now, updatedAt: now, revision: stableId(chatId, task, "revision"), turnsSinceUpdate: 0, context, questions: validated };
				doc.open[askId] = opened;
				doc.byTask[task] = askId;
				return { kind: "opened" as const, ask: opened, rerun: false };
			}, c);
			if (result.kind === "withdrawn") {
				if (!result.rerun) signal({ type: "ask.closed", askId: result.askId, reason: "withdrawn" });
				// As PI WEB's tool: the result names the withdrawn set, so a branch rebuilt from history closes it too.
				return { output: text(`Withdrew question set ${result.askId}; its question chips are gone from the user's composer.`), details: { withdrawn: { askId: result.askId }, sessionId: chatId } as JsonObject };
			}
			const posted = JSON.parse(JSON.stringify(result.ask)) as PendingAsk;
			if (!result.rerun) {
				signal({ type: "ask.opened", ask: posted });
				if (result.kind === "opened") signal({ type: "attention", kind: "ask", id: posted.askId, detail: posted.questions[0]?.question ?? "Needs an answer" });
			}
			const count = posted.questions.length;
			const message = result.kind === "updated"
				? `Updated open question set ${posted.askId} (${refs(posted)}). The answers still arrive later as a follow-up message.`
				: `Posted ${count} question${count === 1 ? "" : "s"} to the user as question chips above their composer, ask ${posted.askId} (${refs(posted)}). You are not paused: keep working on whatever does not depend on the answers, and end your turn if nothing does. The answers arrive later as a follow-up message. Do not repost these questions; revise them with update or drop them with withdraw.`;
			return { output: text(message), details: { ask: posted, sessionId: chatId } };
		},
	});
	const attention = defineTool({
		name: "request_attention",
		description: ATTENTION_DESCRIPTION,
		parameters: Type.Object({ reason: Type.String({ description: "One short, self-contained line: what you need from the user and why, readable without the Chat." }) }),
		replay: "safe",
		execute: async (args, api, c) => {
			const reason = args.reason.trim().slice(0, TEXT_MAX);
			if (reason === "") throw new Error("request_attention needs a reason: what you need from the user and why");
			const request: Attention = { id: stableId(chatId, String(api.taskId), "attention"), reason };
			const fresh = await api.commit(async (tx) => {
				const doc = await tx.doc(QuestionsDoc, api.conversationId);
				if (doc.notified.includes(request.id)) return false;
				doc.attention = request;
				doc.notified = [...doc.notified.slice(-49), request.id];
				return true;
			}, c);
			if (fresh) signal({ type: "attention", kind: "attention", id: request.id, detail: reason });
			return {
				output: text("Notified the user that this Chat needs them. This does not wait for a reply: keep working on anything that does not need them, or end your turn."),
				details: { request, sessionId: chatId },
			};
		},
	});
	return [ask, attention];
}

function unansweredOutcome(ask: PendingAsk, reason: string, closedAt: string): Outcome {
	const questions = ask.questions.map((question) => ({ question, answered: false, values: [] }));
	const ids = ask.questions.map((q) => q.id);
	return {
		askId: ask.askId,
		reason,
		askedAt: ask.askedAt,
		closedAt,
		...(ask.context === undefined ? {} : { context: ask.context }),
		questions,
		answeredCount: 0,
		unansweredIds: ids,
		summary: `Answered 0 of ${ids.length}; unanswered: ${ids.join(", ")}`,
	};
}

/** Delivers one closed set's answers to the model, once, as a follow-up keyed by the ask. */
export const AnswerDelivery = defineTask<{ askId: string; content: string }, { phase: "deliver" }, null>({
	name: "workbench.answer-delivery",
	version: 1,
	initial: () => ({ phase: "deliver" }),
	phases: {
		deliver: async (task, runtime, c) => {
			const doc = await runtime.snapshot(QuestionsDoc, runtime.conversationId, c);
			const outcome = doc?.closed[task.input.askId]?.outcome;
			const main = (await runtime.conversation(runtime.conversationId, c))!;
			await main.submit(
				{
					type: "input",
					content: task.input.content,
					whenBusy: "followUp",
					requestId: `answers:${task.input.askId}`,
					entry: { kind: ANSWERS_ENTRY, data: JSON.parse(JSON.stringify(outcome ?? null)) },
				},
				c,
			);
			await runtime.commit(async (tx) => {
				const closed = (await tx.doc(QuestionsDoc, runtime.conversationId)).closed[task.input.askId];
				if (closed !== undefined) closed.delivered = true;
				return { status: "terminal", outcome: { status: "completed", result: null } };
			}, c);
		},
	},
	abort: (_task, runtime, c) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), c),
});

export type CloseAsk = {
	readonly askId: string;
	/** The revision the user answered; a cancel names none. */
	readonly revision?: string;
	readonly operationId: string;
	/** PI WEB's validated outcome and the model-facing text it rendered from it (with its open-asks reminder). */
	readonly outcome: Closed["outcome"];
	readonly content: string;
};

/**
 * Close an open set with the user's answers (or a cancel) and commit its delivery in the same transaction, before the
 * browser hears it closed. A retry under the same operation ID returns the same outcome; any other close of a set that
 * is gone, or of an older revision, is stale.
 */
export async function closeAsk(conversation: Conversation, request: CloseAsk): Promise<{ result: "closed"; outcome: Closed["outcome"]; retried: boolean } | { result: "stale" }> {
	return conversation.commit(async (tx) => {
		const doc = await tx.doc(QuestionsDoc, conversation.id);
		const closed = doc.closed[request.askId];
		if (closed?.operationId === request.operationId) return { result: "closed" as const, outcome: JSON.parse(JSON.stringify(closed.outcome)), retried: true };
		const open = doc.open[request.askId];
		if (open === undefined || (request.revision !== undefined && request.revision !== open.revision)) return { result: "stale" as const };
		delete doc.open[request.askId];
		doc.closed[request.askId] = { outcome: request.outcome, operationId: request.operationId, delivered: false };
		await tx.createTask(AnswerDelivery, { askId: request.askId, content: request.content }, { ownership: { kind: "conversation" }, background: true });
		return { result: "closed" as const, outcome: request.outcome, retried: false };
	}, context);
}

export async function questionsState(harness: Harness, conversation: Conversation): Promise<QuestionsState> {
	return (await harness.snapshot(QuestionsDoc, conversation.id, context)) ?? QuestionsDoc.definition.initial();
}

/**
 * PI WEB `pendingAskStore.ts` `renderOpenAsksReminder`: one line per open set, so the model keeps them current. Empty
 * when nothing is open. A legacy Chat sends it hidden with every plain prompt; a Durable Chat commits it with the prompt.
 */
export function openAsksReminder(open: Record<string, PendingAsk>): string {
	const asks = Object.values(open).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
	if (asks.length === 0) return "";
	return [
		"Question sets still open for the user (answers arrive as a follow-up message):",
		...asks.map((ask) => `- ${ask.askId} (${refs(ask)}; updated ${ask.updatedAt}, ${String(ask.turnsSinceUpdate)} turns ago): ${ask.questions[0]?.question ?? ""}`),
		"If one no longer matches the situation and ask_user is available, update or withdraw it; otherwise leave it.",
	].join("\n");
}

/** Count one started run against every open set ("may be stale" after several). */
export async function countTurn(conversation: Conversation, c: Context = context): Promise<boolean> {
	return conversation.commit(async (tx) => {
		const doc = await tx.doc(QuestionsDoc, conversation.id);
		const open = Object.values(doc.open);
		for (const ask of open) ask.turnsSinceUpdate += 1;
		return open.length > 0;
	}, c);
}

/** Clears only the exact request the viewer saw; a newer one stays. Sending a message clears any. */
export async function acknowledgeAttention(conversation: Conversation, id: string | undefined): Promise<boolean> {
	return conversation.commit(async (tx) => {
		const doc = await tx.doc(QuestionsDoc, conversation.id);
		if (doc.attention === null || (id !== undefined && doc.attention.id !== id)) return false;
		doc.attention = null;
		return true;
	}, context);
}

// ─── Resources from PI WEB (Pi's resource loader) ────────────────────────────

/** System-prompt sections PI WEB rendered with Pi's own loader and formatters, and their sources. */
export type Resources = {
	readonly addendum?: string;
	readonly projectContext?: string;
	readonly skills?: string;
	readonly sources?: readonly { readonly path: string; readonly sha256: string }[];
};

export const ResourcesDoc = defineDoc<{ sources: { path: string; sha256: string }[] }>({
	kind: "workbench.resources",
	version: 1,
	scope: "session",
	initial: () => ({ sources: [] }),
	checkpointWhen: () => false,
});

// ─── The extension ──────────────────────────────────────────────────────────

export type WorkbenchOptions = { readonly chatId: string; readonly resources: () => Resources; readonly signal: Signal };

/** Workbench tools and tasks of a Durable Chat; its prompt sections are in `chat.ts`, in Pi's order. */
export function workbenchExtension(options: Omit<WorkbenchOptions, "resources">) {
	return defineExtension({
		name: "workbench.chat-behaviors",
		tools: [...alignmentTools, ...askTools(options.chatId, options.signal)],
		tasks: [AnswerDelivery],
		hooks: [reattachMode],
	});
}
