// Scripted model shared by every pilot process: it answers by the last message, so a reopened process continues the
// same script, and it appends every provider request to requests.log so counts survive a SIGKILL.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** Tools a request offers: the transcript's system messages replayed in order (Durable sends only tool changes). */
function offered(context: { messages: readonly Message[]; tools?: readonly { name: string }[] }): string[] {
	const names = new Set((context.tools ?? []).map((tool) => tool.name));
	for (const message of context.messages) {
		if (message.role !== "system") continue;
		for (const tool of (message as { toolsRemoved?: { name: string }[] }).toolsRemoved ?? []) names.delete(tool.name);
		for (const tool of (message as { toolsAdded?: { name: string }[] }).toolsAdded ?? []) names.add(tool.name);
	}
	return [...names].sort();
}

const LONG = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");

/**
 * Script, by the last non-system message:
 * - `gen` → a long answer (stream slowly to observe partials);
 * - `call:<tool> <json args>` → call that tool;
 * - `spawn:<name> <message>` → call subagent spawn; `leaf:<message>` → call leaf;
 * - `ask:<text>` → call ask_user;
 * - `fail` → a non-retryable provider error;
 * - a compaction summary request → `Summary of <n> earlier messages.`, logged as `summarize` with its focus; a focus
 *   containing `slow` streams a long summary, one containing `fail` is a non-retryable error;
 * - a tool result → `done`, unless `repropose` and the result says the tool was interrupted: then call it again;
 * - a child's assignment (profile text, then `Assignment:\n<script>`) → the script after it; a completion wake or a
 *   Worker's settle reminder → `subagent_collect`; `long:<n>` → an answer of n characters; a summary focus with
 *   `gate:<file>` waits until that file exists;
 * - a request to a routed (non-faux) model is logged with its `model`;
 * - PI WEB's Chat title request → `Scripted title`, or the text after `echo-title:` in it (prompt `fail`: a provider error), not logged;
 * - anything else → `ok: <text>`.
 * `hold(label)` lets a process stop a request at a barrier until it is cancelled.
 */
export function router(dir: string, options: { readonly hold?: Hold; readonly holdOn?: string; readonly repropose?: boolean } = {}): FauxResponseStep {
	return async (context, streamOptions, _state, requestModel) => {
		const messages = context.messages.filter((message) => message.role !== "system");
		const system = context.messages.flatMap((message) => (message.role === "system" ? [getSystemMessageText(message)] : [])).join("\n");
		const last = messages.at(-1);
		// A Working Mode block delivered with a prompt comes first; the script reads the user's text after it.
		const raw = textOfMessage(last);
		const withReminder = raw.replace(/^<working-mode seq="\d+">[\s\S]*?<\/working-mode>/, "");
		const block = withReminder !== raw ? /^<working-mode seq="(\d+)">/.exec(raw)![1] : undefined;
		// An open-questions reminder rides last in a plain prompt; the script reads the user's text before it.
		const reminder = last?.role === "user" ? /Question sets still open for the user[\s\S]*$/.exec(withReminder)?.[0] : undefined;
		const prompt = reminder === undefined ? withReminder : withReminder.slice(0, -reminder.length);
		const assignment = prompt.lastIndexOf("Assignment:\n");
		// A steer that asks for an update carries the legacy request after the script.
		const text = (assignment < 0 ? prompt : prompt.slice(assignment + "Assignment:\n".length)).split("\n\nThe lead asks for a progress update")[0]!;
		const routed = requestModel !== undefined && requestModel.provider !== "faux" ? { model: `${requestModel.provider}/${requestModel.id}` } : {};
		const label = last?.role === "toolResult" ? `result:${last.toolName}` : text.slice(0, 40);
		if (system.includes("context summarization assistant")) {
			const focus = /\n\nAdditional focus: ([\s\S]*)$/.exec(raw)?.[1];
			const count = (raw.match(/^\[(?:User|Assistant|Tool result)\]/gm) ?? []).length;
			logLine(join(dir, "requests.log"), { label: "summarize", ...(focus === undefined ? {} : { focus }) });
			const gate = /gate:(\S+)/.exec(focus ?? "")?.[1];
			while (gate !== undefined && !existsSync(gate)) await new Promise((resolve) => setTimeout(resolve, 20));
			if (focus?.includes("fail") === true) return fauxAssistantMessage([], { stopReason: "error", errorMessage: "400 summarizer rejected (scripted)" });
			return fauxAssistantMessage([fauxText(`Summary of ${count} earlier messages.${focus?.includes("slow") === true ? ` ${LONG}` : ""}`)]);
		}
		// PI WEB's Chat title request (its sessionNameGenerator prompt): not a turn, so not counted.
		if (system.includes("Generate a concise title for a coding-agent chat session"))
			return text === "fail" ? fauxAssistantMessage([], { stopReason: "error", errorMessage: "400 title rejected (scripted)" }) : fauxAssistantMessage([fauxText(/echo-title:(.*)/.exec(raw)?.[1] ?? "Scripted title")]);
		const sections = [...system.matchAll(/<(addendum|project_context|skills)>/g)].map((match) => match[1]);
		// What the composer adds to a request: images in context, the thinking level, `!` commands the model sees.
		const images = messages.flatMap((m) => (m.role === "user" && Array.isArray(m.content) ? m.content.filter((part) => part.type === "image") : [])).length;
		const ran = messages.flatMap((m) => (m.role === "user" ? [/^Ran `([^`]*)`/.exec(textOfMessage(m))?.[1]] : [])).filter((c) => c !== undefined);
		const reasoning = (streamOptions as { reasoning?: string } | undefined)?.reasoning;
		// Every Working Mode block the request carries, anywhere in its messages (seq numbers, in order).
		const modes = messages.flatMap((m) => [...textOfMessage(m).matchAll(/<working-mode seq="(\d+)">/g)].map((match) => Number(match[1])));
		logLine(join(dir, "requests.log"), {
			label,
			...routed,
			messages: messages.length,
			...(block === undefined ? {} : { workingMode: Number(block) }),
			...(reminder === undefined ? {} : { reminder }),
			...(sections.length === 0 ? {} : { sections }),
			...(images === 0 ? {} : { images }),
			...(ran.length === 0 ? {} : { ran }),
			...(reasoning === undefined ? {} : { reasoning }),
			...(modes.length === 0 ? {} : { modes }),
			tools: offered(context),
		});
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
		if (text.startsWith("Background children finished") || text.startsWith("Your background Subagent"))
			return fauxAssistantMessage([fauxToolCall("subagent_collect", {})], { stopReason: "toolUse" });
		if (text === "cancel:last") {
			// Cancel the newest child this conversation launched, by the ID its launch result named.
			const launched = messages.flatMap((m) => (m.role === "toolResult" ? [/Launched subagent (\S+)/.exec(textOfMessage(m))?.[1]] : [])).filter((id) => id !== undefined).at(-1);
			return fauxAssistantMessage([fauxToolCall("subagent_cancel", { executionId: launched ?? "none" })], { stopReason: "toolUse" });
		}
		const long = /^long:(\d+)$/.exec(text);
		if (long !== null) return fauxAssistantMessage([fauxText("x".repeat(Number(long[1])))]);
		if (text === "fail") return fauxAssistantMessage([], { stopReason: "error", errorMessage: "400 invalid request (scripted)" });
		const batch = /^calls:(\[.*\])$/s.exec(text);
		if (batch !== null)
			return fauxAssistantMessage((JSON.parse(batch[1]!) as { name: string; arguments?: object }[]).map((c) => fauxToolCall(c.name, (c.arguments ?? {}) as never)), { stopReason: "toolUse" });
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
