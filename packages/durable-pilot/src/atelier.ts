// The Workbench Atelier (extensions/atelier) in a Durable Chat: the `atelier` tool and the Page server/kernel of
// extensions/atelier/host.ts, with a durable Delivery. The Page file and its Event Log stay the authority for human
// input; Durable records which Pages this Chat receives (to reopen them) and, before admitting a delivery, the request ID
// each of its events is admitted under, so every event is admitted once whatever the kill point:
// - kill after a human event's append, before its delivery: the reopened host reclaims the Page (a dead process's
//   receiver lock is stale; the new generation is checked as in legacy), and delivers it after its undo window;
// - kill after admission, before the Event Log records it: the replay finds each event's admitted submission and only
//   records it, even when the kernel batches it with events that fell due while the host was down (those are batched anew);
// - kill after the receipt: nothing is due.
// Receiver takeover stays the kernel's: generation-checked, inside one process. A Durable Chat host is its own process,
// so another Chat's live receiver refuses an open or takeover here with the kernel's "another process" reason.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Context } from "@earendil-works/chord";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { type Conversation, type ConversationId, defineDoc, defineExtension, defineTool, type DocumentReader, type Harness } from "@earendil-works/pi-durable";
import { DESCRIPTION } from "../../../extensions/atelier/description.mjs";
import { derive, REQUEST_STATES } from "../../../extensions/atelier/kernel/atelier.js";
import { piTmpDir } from "../../../extensions/pi-tmp/pitmp.mjs";
import { crashPoint } from "./background-bash.ts";
import { context } from "./host.ts";
import { PACKAGE_MESSAGE_ENTRY } from "./packages.ts";
import { redact, sanitizeDeep } from "./redact.ts";

/**
 * Pages this Chat opened, reopened with the host; the page server's port, asked for again so open tabs reconnect; and the
 * request ID of each event being delivered (`<page hash>:<seq>`), until the Event Log records its receipt.
 */
export const AtelierDoc = defineDoc<{ pages: string[]; port?: number; admitting?: Record<string, string> }>({
	kind: "workbench.atelier",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ pages: [] }),
	checkpointWhen: () => false,
});

type Entry = { seq: number; op?: string; [field: string]: unknown };
type Message = { customType: string; content: string; display: true; details: { page: string; seqs: number[]; replay: boolean; generation?: number } };
type Opened = { url: string; kernel: { file: string; outcome: string }[]; replayed: number; generation: number; unfinished: string[] };
/** The part of extensions/atelier/host.ts `createHost` this binding uses. */
type PageHost = {
	readonly root: string;
	port(): number;
	rel(page: string): string;
	open(page: string): Promise<Opened>;
	takeover(page: string, generation: number): Promise<Opened>;
	isOpen(page: string): boolean;
	agent(page: string, entry: Record<string, unknown>): Entry;
	update(page: string, note?: string, fields?: Record<string, unknown>): number;
	current(details: Message["details"]): boolean;
	receipt(details: Message["details"]): void;
	deliverDue(page: string, replay?: boolean): number;
	stop(): void;
};
type Kernel = {
	createHost(options: { root: string; sessionId: string; label: string; send: (message: Message, done: (idle: boolean) => void, failed: () => void) => void; handoff: (message: Message) => void; idle: () => boolean; port?: number }): PageHost;
	readLog(page: string): Entry[];
};
type Check = { checkPage(page: string, options: { root: string; source?: Buffer; signal?: AbortSignal; tmp?: string }): Promise<unknown>; formatCheck(check: unknown): string };
// tsc would check the Workbench extension's .ts files as CommonJS (no package type there), so the kernel host and the
// Page check (which imports it) are loaded by URL and typed by the facades above; Node runs them as the modules they are.
const { createHost, readLog } = (await import(new URL("../../../extensions/atelier/host.ts", import.meta.url).href)) as Kernel;
const { checkPage, formatCheck } = (await import(new URL("../../../extensions/atelier/check-page.mjs", import.meta.url).href)) as Check;

const text = (value: string) => [{ type: "text" as const, text: value }];
const pageHash = (page: string) => createHash("sha256").update(page).digest("hex").slice(0, 16);
export type AtelierOptions = { readonly chatId: string; readonly cwd: string; readonly rootId: () => ConversationId | undefined };

export class Atelier {
	readonly #options: AtelierOptions;
	#host: PageHost | undefined;
	/** The lead: the Chat's active branch at each use (history navigation may select another). */
	#conversation: (() => Conversation) | undefined;
	#reader: DocumentReader | undefined;
	#deliver: <T>(work: () => Promise<T>) => Promise<T> = (work) => work();
	/** Deliveries in Event Log order, one at a time. */
	#queue: Promise<void> = Promise.resolve();
	#closed = false;

	constructor(options: AtelierOptions) {
		this.#options = options;
	}

	/** The page server, created on first use with the port this Chat served on before. */
	async #pages(c: Context = context): Promise<PageHost> {
		if (this.#host !== undefined) return this.#host;
		const port = (await this.#reader!.snapshot(AtelierDoc, this.#conversation!().id, c))?.port;
		this.#host = createHost({
			root: this.#options.cwd,
			sessionId: this.#options.chatId,
			label: `Chat ${this.#options.chatId.slice(0, 8)}`,
			send: (message, done, failed) => this.#send(message, done, failed),
			// A takeover into another session of this process: the note reaches this Chat without starting a turn.
			handoff: (message) => void this.#write(message),
			// The only session of this process: no takeover from here waits for it.
			idle: () => true,
			...(port === undefined ? {} : { port }),
		});
		return this.#host;
	}

	#send(message: Message, done: (idle: boolean) => void, failed: () => void): void {
		this.#queue = this.#queue.then(async () => {
			try {
				await this.#deliver(async () => {
					const host = this.#host;
					if (this.#closed || host === undefined || !host.current(message.details)) return failed();
					const { page, seqs } = message.details;
					const conversation = this.#conversation!();
					const key = (seq: number) => `${pageHash(page)}:${seq}`;
					// The kernel batches what is due now, so a batch is no receipt: each event's request ID is committed before
					// admission, and an event whose submission exists was admitted, whatever batch it came in.
					const { admitted, requestId } = await conversation.commit(async (tx) => {
						const doc = await tx.doc(AtelierDoc, conversation.id);
						const admitted: number[] = [];
						for (const seq of seqs) {
							const id = doc.admitting?.[key(seq)];
							if (id !== undefined && (await tx.submissionByRequest(conversation.id, id)) !== undefined) admitted.push(seq);
						}
						const requestId = `atelier:${pageHash(page)}:${seqs.join(",")}`;
						if (admitted.length === 0) {
							doc.admitting ??= {};
							for (const seq of seqs) doc.admitting[key(seq)] = requestId;
						}
						return { admitted, requestId };
					}, context);
					if (admitted.length > 0) {
						// Admitted before a kill: only its receipt is missing. The rest of the batch is composed and delivered anew.
						host.receipt({ ...message.details, seqs: admitted });
						failed();
						if (admitted.length < seqs.length) host.deliverDue(page, message.details.replay);
						return;
					}
					// Human input is new committed content: redacted before it is admitted.
					await conversation.submit({
						type: "input",
						content: redact(message.content),
						whenBusy: "followUp",
						requestId,
						entry: { kind: PACKAGE_MESSAGE_ENTRY, data: { customType: message.customType, display: true, details: sanitizeDeep(JSON.parse(JSON.stringify(message.details)), redact) } },
					}, context);
					crashPoint("atelier.admitted");
					// Admitted is held: the Event Log records the send and its receipt only now.
					done(true);
					host.receipt(message.details);
					// Received: the Event Log never offers these events again, so their request IDs are no longer needed.
					await conversation.commit(async (tx) => {
						const doc = await tx.doc(AtelierDoc, conversation.id);
						for (const seq of seqs) delete doc.admitting?.[key(seq)];
					}, context);
					crashPoint("atelier.received");
				});
			} catch {
				failed();
			}
		});
	}

	/** A note the model reads with its next turn: a submission, so it waits for the delivery barrier too. */
	async #write(message: Message): Promise<void> {
		await this.#deliver(async () => this.#conversation?.().submit({ type: "write", entry: { kind: PACKAGE_MESSAGE_ENTRY, data: { customType: message.customType, display: true, details: sanitizeDeep(JSON.parse(JSON.stringify(message.details)), redact) }, model: [{ role: "user", content: redact(message.content), timestamp: Date.now() }] } }, context));
	}

	/**
	 * Reopen the lead's Pages: reclaim each receiver and deliver what is due. `deliver` runs a delivery once the Chat may
	 * take new input (a paused restore, a checkpoint and history navigation hold it).
	 */
	async start(conversation: () => Conversation, reader: Harness, hooks: { deliver: <T>(work: () => Promise<T>) => Promise<T> }): Promise<void> {
		this.#conversation = conversation;
		this.#reader = reader;
		this.#deliver = hooks.deliver;
		const doc = await reader.snapshot(AtelierDoc, conversation().id, context);
		for (const page of doc?.pages ?? []) {
			try {
				await (await this.#pages()).open(page);
			} catch {
				// Another live receiver holds it now, or it is gone: the tool says why when the agent opens it again.
			}
		}
	}

	close(): void {
		this.#closed = true;
		this.#host?.stop();
	}

	extension() {
		const atelier = defineTool({
			name: "atelier",
			description: DESCRIPTION,
			parameters: Type.Object({
				action: StringEnum(["open", "takeover", "update", "ask", "answer", "status", "check"]),
				page: Type.String({ description: "Page path, relative to the project or absolute" }),
				decision: Type.Optional(Type.Object({
					id: Type.String(),
					question: Type.String(),
					options: Type.Array(Type.Object({ label: Type.String(), consequence: Type.String(), recommended: Type.Optional(Type.Boolean()) }), { minItems: 2 }),
					key: Type.Optional(Type.String({ description: "Key it sits on" })),
					material: Type.Optional(Type.String({ description: "Key whose opening counts as opened" })),
					detail: Type.Optional(Type.String()),
				})),
				comment: Type.Optional(Type.Number({ description: "answer: Comment #" })),
				request: Type.Optional(Type.Number({ description: "status: Request #" })),
				state: Type.Optional(StringEnum(REQUEST_STATES as string[])),
				text: Type.Optional(Type.String({ description: "answer text, status note, or update note" })),
				generation: Type.Optional(Type.Number({ description: "takeover: receiver generation" })),
			}),
			executionMode: "sequential",
			// Agent events carry the tool task as `op`, so a rerun after a kill finds its event instead of appending again.
			replay: "safe",
			execute: async (params, api, c) => {
				if (api.conversationId !== this.#options.rootId()) throw new Error("Atelier Pages belong to the lead Chat.");
				const host = await this.#pages(c);
				const root = host.root;
				let page: string | undefined;
				try {
					page = realpathSync(path.resolve(root, params.page));
				} catch {
					// missing
				}
				if (page === undefined || !statSync(page).isFile()) throw new Error(`No Page file at ${params.page}.`);
				const op = String(api.taskId);
				const result = (t: string, details: Record<string, unknown> = {}) => ({ output: text(t), details: JSON.parse(JSON.stringify({ action: params.action, page: host.rel(page!), ...details })) });
				// The Page check (check-page.mjs) on a test copy; ATELIER_PAGE_CHECK=off skips it. It never fails the action.
				// Its screenshots go to the Chat's PI_TMP (toolEnv's), not the process's: the host clears inherited identity.
				const checked = async (t: string, details: Record<string, unknown> = {}, source?: Buffer) => {
					if (process.env.ATELIER_PAGE_CHECK === "off") return result(t, details);
					const check = await checkPage(page!, { root, source, signal: c.abortSignal, tmp: piTmpDir(this.#options.cwd, this.#options.chatId) }).catch((error: unknown) => ({ status: "unchecked", viewport: "", revision: null, checks: [], views: [], unchecked: [redact(String(error)).slice(0, 300)], report: null }));
					return result([t, formatCheck(check)].filter(Boolean).join("\n\n"), { ...details, check });
				};
				if (params.action === "check") return checked("");

				if (params.action === "open" || params.action === "takeover") {
					if (params.action === "takeover" && !Number.isInteger(params.generation)) throw new Error("takeover needs the generation open named.");
					const opened = params.action === "open" ? await host.open(page) : await host.takeover(page, params.generation!);
					await api.commit(async (tx) => {
						const doc = await tx.doc(AtelierDoc, api.conversationId);
						if (!doc.pages.includes(page!)) doc.pages.push(page!);
						doc.port = host.port();
					}, c);
					const notes = opened.kernel.flatMap(({ file, outcome }: { file: string; outcome: string }) =>
						outcome === "changed" ? [`${file} beside the Page was changed locally and was not overwritten. It is a Contribution candidate: raise a pull request against pi-workbench (decision 136).`]
						: outcome === "behind" ? [`${file} beside the Page is an older Kernel; offer the owner the diff before replacing it (decision 136).`]
						: outcome === "symlink" ? [`${file} beside the Page is a symlink and was left alone.`] : []);
					return checked([
						`Page open: ${opened.url}`,
						params.action === "takeover" ? `Its human input now goes to this session (generation ${opened.generation}), handed over within this process, so the link and open tabs stay.` : "Link it in the Chat.",
						...(opened.unfinished.length ? ["Unfinished, left by the earlier receiver; check their state before repeating work:", ...opened.unfinished.map((u: string) => `- ${u}`)] : []),
						...notes,
						opened.replayed ? `${opened.replayed} message(s) of undelivered human events from an earlier session follow.` : "",
					].filter(Boolean).join("\n"), { url: opened.url, kernel: opened.kernel, replayed: opened.replayed, generation: opened.generation });
				}
				if (!host.isOpen(page)) throw new Error(`Open ${params.page} first (action open).`);
				const entries = readLog(page);
				const earlier = entries.find((e) => e.op === op);

				if (params.action === "update") {
					const source = readFileSync(page);
					const tabs = earlier === undefined ? host.update(page, params.text, { op }) : host.update(page);
					return checked(tabs ? `Update sent to ${tabs} connected tab(s); the owner sees this revision now.` : "No tab is connected; the Page shows this version when it is next opened.", { tabs }, source);
				}
				if (params.action === "ask") {
					const d = params.decision;
					if (!d) throw new Error("ask needs decision.");
					if (d.options.filter((o) => o.recommended === true).length > 1) throw new Error("A Decision recommends at most one option (decision 155).");
					const entry = earlier ?? host.agent(page, { type: "ask", decision: d, op });
					return result(`Decision ${d.id} posted (#${entry.seq}). End your turn; the answer arrives as a message after its 3-second undo window.`, { seq: entry.seq });
				}
				if (params.action === "answer") {
					const target = entries.find((e) => e.seq === params.comment && e.type === "comment" && e.origin === "human");
					if (!target || !params.text) throw new Error(`answer needs the #number of a Comment and text.`);
					const entry = earlier ?? host.agent(page, { type: "answer", target: target.seq, text: params.text, op });
					return result(`Answered Comment #${target.seq} in its thread (#${entry.seq}).`, { seq: entry.seq });
				}
				// status
				const request = derive(entries).requests.find((r: { req: { seq: number } }) => r.req.seq === params.request);
				if (!request || !params.state) throw new Error("status needs the #number of a Request and a state.");
				const entry = earlier ?? host.agent(page, { type: "status", target: params.request, state: params.state, note: params.text, revision: request.revision, op });
				return result(`Request #${params.request} is ${params.state} (revision ${request.revision}, #${entry.seq}).`, { seq: entry.seq, revision: request.revision });
			},
		});
		return defineExtension({ name: "workbench.atelier", tools: [atelier] });
	}
}
