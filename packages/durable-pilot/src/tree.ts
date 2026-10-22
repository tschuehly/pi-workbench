// History navigation of a Durable Chat (legacy `/tree` and "Go back to this message"). A Chat's history is a tree of
// conversations in its family store: the root and the branches navigation forked from it (`BranchesDoc`). Navigating
// selects the branch that already ends where the user wants to continue, or forks a new one there; nothing is erased.
// The tree goes to PI WEB as Pi-shaped session entries, which PI WEB projects with its legacy `projectSessionTree`.
import { AgentDoc, type Conversation, type ConversationId, type EntryId, type EntryRecord, type Harness, type Tx } from "@earendil-works/pi-durable";
import { browserMessages } from "./chat-session.ts";
import { BranchesDoc, context } from "./host.ts";
import { redact, sanitizeDeep, sealed } from "./redact.ts";
import { ToolGroupsDoc } from "./tool-groups.ts";
import { ANSWERS_ENTRY, type PendingAsk, QuestionsDoc, WorkingModeDoc } from "./workbench.ts";

/** A visible history entry, shaped as Pi's session entry so PI WEB's tree projection reads it. */
export type TreeEntry = { id: string; parentId: string | null; timestamp: string; type: string } & Record<string, unknown>;
export type Tree = { nodes: TreeEntry[]; activeLeafId: string | null };

type Branch = {
	readonly conversation: Conversation;
	/** Every entry of the branch's history, oldest first (fork-aware). */
	readonly path: readonly EntryRecord[];
	/** The entries the browser shows, as Pi-shaped entries. */
	readonly visible: readonly TreeEntry[];
};

export const STALE = "The session changed since /tree was opened. Reopen /tree and try again.";

/** The entry as Pi records it: the last browser message it shows (a prompt after its Working Mode block). */
function piEntry(entry: EntryRecord, parentId: string | null): TreeEntry | undefined {
	const message = browserMessages(entry).at(-1) as (Record<string, unknown> & { role: string; timestamp?: unknown }) | undefined;
	if (message === undefined) return undefined;
	const base = { id: String(entry.id), parentId, timestamp: new Date(typeof message.timestamp === "number" ? message.timestamp : 0).toISOString() };
	const { entryId: _entryId, streamId: _streamId, ...rest } = message;
	if (message.role === "custom") return { ...base, type: "custom_message", customType: message.customType, content: message.content, display: true, details: message.details };
	if (message.role === "system") return { ...base, type: "compaction", summary: String(message.content ?? "") };
	return { ...base, type: "message", message: rest };
}

async function entries(conversation: Conversation): Promise<EntryRecord[]> {
	const found: EntryRecord[] = [];
	let cursor: Parameters<Conversation["entries"]>[2];
	do {
		const page = await conversation.entries({ order: "ascending" }, 500, cursor, context);
		found.push(...page.items);
		cursor = page.next;
	} while (cursor !== undefined);
	return found;
}

/** Every branch of the Chat, the root first. */
async function branches(harness: Harness): Promise<Branch[]> {
	const root = await harness.root(context);
	const ids = [root.id, ...((await harness.snapshot(BranchesDoc, context))?.branches ?? [])];
	// ponytail: reads every branch's whole history per request; index parents in a document if trees grow large.
	return Promise.all(ids.map(async (id) => {
		const conversation = id === root.id ? root : (await harness.conversation(id, context))!;
		const path = await entries(conversation);
		const visible: TreeEntry[] = [];
		for (const entry of path) {
			const shown = piEntry(entry, visible.at(-1)?.id ?? null);
			if (shown !== undefined) visible.push(shown);
		}
		return { conversation, path, visible };
	}));
}

/** The Chat's history tree: every retained branch's entries, once, and the active branch's leaf. */
export async function historyTree(harness: Harness, active: Conversation): Promise<Tree> {
	const all = await branches(harness);
	const nodes = new Map<string, TreeEntry>();
	for (const branch of all) for (const entry of branch.visible) nodes.set(entry.id, entry);
	return { nodes: [...nodes.values()].sort((a, b) => Number(a.id) - Number(b.id)), activeLeafId: all.find((b) => b.conversation.id === active.id)?.visible.at(-1)?.id ?? null };
}

export type Navigation = {
	/** The branch to continue on: an existing one, or one to fork. */
	readonly select?: ConversationId;
	readonly fork?: { readonly from: Conversation; readonly at: EntryId | undefined; readonly history: readonly EntryRecord[] };
	readonly editorText?: string;
	readonly oldLeafId: string | null;
	readonly newLeafId: string | null;
};

/**
 * Where navigating to `targetId` continues, as Pi's `navigateTree`: a user message (and, from the tree, a custom
 * message) continues from before it and returns its text to the editor; any other entry continues after it. A message
 * shortcut (`retainCheckpoint`) first widens the target as PI WEB's `messageHistoryTargetId` does.
 */
export async function planNavigation(harness: Harness, active: Conversation, request: { targetId: string; expectedLeafId: string | null; retainCheckpoint?: boolean }): Promise<Navigation> {
	const all = await branches(harness);
	const current = all.find((b) => b.conversation.id === active.id)!;
	const oldLeafId = current.visible.at(-1)?.id ?? null;
	if (oldLeafId !== request.expectedLeafId) throw new Error(STALE);
	const targetId = request.retainCheckpoint === true ? messageHistoryTargetId(current.visible, request.targetId) : request.targetId;
	const owner = [current, ...all].find((b) => b.visible.some((entry) => entry.id === targetId));
	if (owner === undefined) throw new Error("This entry is no longer in the session tree. Reopen /tree and try again.");
	const index = owner.visible.findIndex((entry) => entry.id === targetId);
	const target = owner.visible[index]!;
	const user = target.type === "message" && (target.message as { role: string }).role === "user";
	const editable = user || (request.retainCheckpoint !== true && target.type === "custom_message");
	const newLeafId = editable ? (owner.visible[index - 1]?.id ?? null) : targetId;
	const editorText = editable ? textOf(user ? (target.message as { content: unknown }).content : target.content) : undefined;
	const result = { oldLeafId, newLeafId, ...(editorText === undefined ? {} : { editorText }) };
	if (newLeafId === oldLeafId) return result;
	// The newest retained branch that already ends there; otherwise a new one from the entry before it (or empty).
	const retained = all.filter((b) => (b.visible.at(-1)?.id ?? null) === newLeafId).at(-1);
	if (retained !== undefined) return { ...result, select: retained.conversation.id };
	const at = owner.path.findIndex((entry) => String(entry.id) === targetId) - (editable ? 1 : 0);
	return { ...result, fork: { from: owner.conversation, at: owner.path[at]?.id, history: owner.path.slice(0, at + 1) } };
}

/**
 * Commit the navigation: the branch map's new active branch, and for a fork the new conversation with the questions
 * open as of its fork point, in one commit. Revision-checked against the active branch the plan was made on.
 */
export async function commitNavigation(harness: Harness, active: Conversation, plan: Navigation): Promise<Conversation> {
	const rootId = (await harness.root(context)).id;
	const record = async (tx: Tx, id: ConversationId) => {
		const doc = await tx.doc(BranchesDoc);
		if ((doc.active ?? rootId) !== active.id) throw new Error(STALE);
		doc.active = id;
		if (plan.fork !== undefined) doc.branches.push(id);
	};
	if (plan.select !== undefined) {
		await harness.commit((tx) => record(tx, plan.select!), context);
		return (await harness.conversation(plan.select, context))!;
	}
	const { from, at, history } = plan.fork!;
	const init = async (tx: Tx, id: ConversationId) => {
		await record(tx, id);
		// A new copy of sets whose text came verbatim from tool-call arguments: sanitized before it commits.
		Object.assign(await tx.doc(QuestionsDoc, id), { open: sanitizeDeep(branchQuestions(history), sealed(redact)) });
	};
	if (at !== undefined) return from.fork(at, { ownership: { kind: "ownerless" }, init }, context);
	// Before the first entry: a new conversation with the agent, Working Mode and tool groups of the Chat's start.
	const first = (await entries(from))[0]!.id;
	const [agent, mode, groups] = await Promise.all([
		harness.snapshotAsOf(AgentDoc, from.id, first, context),
		harness.snapshotAsOf(WorkingModeDoc, from.id, first, context),
		harness.snapshotAsOf(ToolGroupsDoc, from.id, first, context),
	]);
	return harness.createConversation({
		ownership: { kind: "ownerless" },
		init: async (tx, id) => {
			await init(tx, id);
			if (agent !== undefined) Object.assign(await tx.doc(AgentDoc, id), structuredClone(agent));
			if (mode !== undefined) Object.assign(await tx.doc(WorkingModeDoc, id), structuredClone(mode));
			if (groups !== undefined) Object.assign(await tx.doc(ToolGroupsDoc, id), structuredClone(groups));
		},
	}, context);
}

/**
 * The question sets open at the end of a branch's history, by PI WEB's `openAsksFromTranscript` rules: posted or
 * revised by an `ask_user` result, gone once withdrawn or answered on that branch.
 */
export function branchQuestions(history: readonly EntryRecord[]): Record<string, PendingAsk> {
	const open: Record<string, PendingAsk> = {};
	for (const entry of history) {
		const message = entry.model?.[0] as { role?: string; toolName?: string; isError?: boolean; details?: { ask?: PendingAsk; withdrawn?: { askId?: string } } } | undefined;
		if (message?.role === "assistant") for (const ask of Object.values(open)) ask.turnsSinceUpdate += 1;
		else if (message?.role === "toolResult" && message.toolName === "ask_user" && message.isError !== true) {
			const ask = message.details?.ask;
			if (ask !== undefined) open[ask.askId] = { ...structuredClone(ask), turnsSinceUpdate: 0 };
			if (message.details?.withdrawn?.askId !== undefined) delete open[message.details.withdrawn.askId];
		} else if (entry.kind === ANSWERS_ENTRY) delete open[(entry.data as { askId?: string } | null)?.askId ?? ""];
	}
	return open;
}

/** PI WEB's `messageHistoryTargetId` (messageHistoryTarget.ts) over the active branch's visible entries. */
export function messageHistoryTargetId(branch: readonly TreeEntry[], entryId: string): string {
	const index = branch.findIndex((entry) => entry.id === entryId);
	if (index < 0) throw new Error("This message is no longer available on the active session branch.");
	const entry = branch[index]!;
	if (isQuestionResult(entry)) return entryId;
	if (entry.type === "message" && (entry.message as { role?: string }).role === "user") return entryId;
	let targetId = entryId;
	for (const next of branch.slice(index + 1)) {
		if (isConversationCheckpoint(next)) break;
		targetId = next.id;
		if (isQuestionResult(next)) break;
	}
	return targetId;
}

function isQuestionResult(entry: TreeEntry): boolean {
	const message = entry.message as { role?: string; toolName?: string; isError?: boolean; details?: { ask?: unknown } } | undefined;
	return entry.type === "message" && message?.role === "toolResult" && message.toolName === "ask_user" && message.isError === false
		&& typeof message.details?.ask === "object" && message.details.ask !== null;
}

function isConversationCheckpoint(entry: TreeEntry): boolean {
	if (entry.type !== "message") return false;
	const message = entry.message as { role?: string; content?: unknown };
	if (message.role === "user") return true;
	if (message.role !== "assistant") return false;
	if (typeof message.content === "string") return message.content !== "";
	if (!Array.isArray(message.content)) return message.content != null;
	return message.content.some((part: { type?: string; text?: string; thinking?: string }) => {
		if (part.type === "toolCall") return false;
		if (part.type === "text") return typeof part.text === "string" && part.text !== "";
		if (part.type === "thinking") return typeof (part.thinking ?? part.text) === "string" && (part.thinking ?? part.text) !== "";
		return true;
	});
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.flatMap((part: { type?: string; text?: string }) => (part.type === "text" ? [part.text ?? ""] : [])).join("\n");
}
