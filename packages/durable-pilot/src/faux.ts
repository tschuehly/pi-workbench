// Scripted model shared by every pilot process: it answers by the last message, so a reopened process continues the
// same script, and it appends every provider request to requests.log so counts survive a SIGKILL.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	type DeferredHandle,
	type FauxResponseStep,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	getSystemMessageText,
	type Message,
	type Model,
	type Provider,
} from "@earendil-works/pi-ai";

export type Hold = (name: string, signal: AbortSignal | undefined) => Promise<void>;

export function textOfMessage(message: Message | undefined): string {
	if (message === undefined || message.role === "system") return "";
	if (typeof message.content === "string") return message.content;
	return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function logLine(file: string, record: object): void {
	appendFileSync(file, `${JSON.stringify({ pid: process.pid, ...record })}\n`);
}

export function readLog<T = Record<string, unknown>>(file: string): T[] {
	try {
		return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
	} catch {
		return [];
	}
}

const LONG = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");

/**
 * Script, by the last non-system message:
 * - `gen` → a long answer (stream slowly to observe partials);
 * - `call:<tool> <json args>` → call that tool;
 * - `spawn:<name> <message>` → call subagent spawn; `leaf:<message>` → call leaf;
 * - `ask:<text>` → call ask_user;
 * - `fail` → a non-retryable provider error;
 * - a tool result → `done`, unless `repropose` and the result says the tool was interrupted: then call it again;
 * - anything else → `ok: <text>`.
 * `hold(label)` lets a process stop a request at a barrier until it is cancelled.
 */
export function router(dir: string, options: { readonly hold?: Hold; readonly holdOn?: string; readonly repropose?: boolean } = {}): FauxResponseStep {
	return async (context, streamOptions) => {
		const messages = context.messages.filter((message) => message.role !== "system");
		const system = context.messages.flatMap((message) => (message.role === "system" ? [getSystemMessageText(message)] : [])).join("\n");
		const last = messages.at(-1);
		// A Working Mode block delivered with a prompt comes first; the script reads the user's text after it.
		const raw = textOfMessage(last);
		const text = raw.replace(/^<working-mode seq="\d+">[\s\S]*?<\/working-mode>/, "");
		const block = text !== raw ? /^<working-mode seq="(\d+)">/.exec(raw)![1] : undefined;
		const label = last?.role === "toolResult" ? `result:${last.toolName}` : text.slice(0, 40);
		const sections = [...system.matchAll(/<(addendum|project_context|skills)>/g)].map((match) => match[1]);
		logLine(join(dir, "requests.log"), { label, messages: messages.length, ...(block === undefined ? {} : { workingMode: Number(block) }), ...(sections.length === 0 ? {} : { sections }) });
		if (options.hold !== undefined && options.holdOn !== undefined && text.startsWith(options.holdOn))
			await options.hold(`request:${options.holdOn}`, streamOptions?.signal);
		if (last?.role === "toolResult") {
			const interrupted = textOfMessage(last).includes("interrupted");
			const calls = messages.filter((m) => m.role === "assistant").flatMap((m) =>
				(m as AssistantMessage).content.filter((c) => c.type === "toolCall" && c.name === last.toolName),
			);
			if (options.repropose === true && interrupted && calls.length < 2) {
				const previous = calls.at(-1) as { arguments: Record<string, unknown> } | undefined;
				return fauxAssistantMessage([fauxToolCall(last.toolName, (previous?.arguments ?? {}) as never)], { stopReason: "toolUse" });
			}
			return fauxAssistantMessage([fauxText(`done after ${last.toolName}`)]);
		}
		if (text === "gen") return fauxAssistantMessage([fauxText(LONG)]);
		if (text === "fail") return fauxAssistantMessage([], { stopReason: "error", errorMessage: "400 invalid request (scripted)" });
		const call = /^call:(\S+)(?: (.*))?$/s.exec(text);
		if (call !== null)
			return fauxAssistantMessage([fauxToolCall(call[1]!, call[2] === undefined ? {} : JSON.parse(call[2]))], { stopReason: "toolUse" });
		const spawn = /^spawn:(\S+) (.*)$/s.exec(text);
		if (spawn !== null)
			return fauxAssistantMessage([fauxToolCall("subagent", { action: "spawn", name: spawn[1]!, message: spawn[2]! })], {
				stopReason: "toolUse",
			});
		const leaf = /^leaf:(.*)$/s.exec(text);
		if (leaf !== null) return fauxAssistantMessage([fauxToolCall("leaf", { task: leaf[1]! })], { stopReason: "toolUse" });
		const ask = /^ask:(.*)$/s.exec(text);
		if (ask !== null) return fauxAssistantMessage([fauxToolCall("ask_user", { question: ask[1]! })], { stopReason: "toolUse" });
		return fauxAssistantMessage([fauxText(`ok: ${text}`)]);
	};
}

/**
 * Provider-side deferred jobs that outlive the host process (the faux provider keeps them in memory): a deferred
 * request writes a job file and returns its handle; a fetch reads the job and answers. Counts go to requests.log as
 * `deferred-submit` and `deferred-fetch`.
 */
export function fileDeferred(inner: Provider, dir: string): Provider {
	const jobs = join(dir, "deferred");
	mkdirSync(jobs, { recursive: true });
	const answer = (model: Model<Api>, text: string, handle?: DeferredHandle): AssistantMessage => ({
		...fauxAssistantMessage(handle === undefined ? [fauxText(text)] : [], handle === undefined ? {} : { stopReason: "deferred", deferred: handle }),
		api: model.api,
		provider: model.provider,
		model: model.id,
	});
	const emit = (message: AssistantMessage) => {
		const out = createAssistantMessageEventStream();
		queueMicrotask(() => {
			out.push({ type: "start", partial: { ...message, content: [] } });
			out.push({ type: "done", reason: message.stopReason as "stop", message });
			out.end();
		});
		return out;
	};
	const submit: Provider["streamSimple"] = (model, context, options) => {
		if (options?.deferred !== true) return inner.streamSimple(model, context, options);
		const handle: DeferredHandle = { provider: model.provider, modelId: model.id, api: model.api, id: `job-${process.pid}-${Date.now()}`, pollAfterMs: 60_000 };
		writeFileSync(join(jobs, `${handle.id}.json`), JSON.stringify({ last: textOfMessage(context.messages.at(-1)) }));
		logLine(join(dir, "requests.log"), { label: "deferred-submit" });
		return emit(answer(model, "", handle));
	};
	return {
		...inner,
		getModels: () => inner.getModels(),
		stream: submit as Provider["stream"],
		streamSimple: submit,
		fetchDeferred: (model, handle) => {
			logLine(join(dir, "requests.log"), { label: "deferred-fetch" });
			const job = JSON.parse(readFileSync(join(jobs, `${handle.id}.json`), "utf8")) as { last: string };
			return emit(answer(model, `deferred answer to ${job.last}`));
		},
	};
}
