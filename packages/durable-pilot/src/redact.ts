// Pre-persistence secret redaction on Durable's two streaming boundaries, using only public seams:
// - model output: a pi-ai Provider wrapper, so every partial Durable copies into pi.live and the final message are
//   already sanitized when Durable sees them;
// - tool output: a tool wrapper whose api proxy sanitizes output chunks, details and diagnostics before forwarding,
//   and the returned result before Durable commits it.
// Both fail closed: a sanitizer throw ends the model response as an error, or the tool call with a fixed error, and
// never forwards the unsanitized text. Hooks are not used: Durable skips a throwing afterTool hook (README "Errors").
// Not covered (documented boundary): user input, tool-call arguments and provider-signed thinking are stored
// verbatim, as with the current Workbench extension; bash spill files are written by the environment itself.
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	type Provider,
} from "@earendil-works/pi-ai";
import type { ToolExecutionApi, ToolExecutionResult, ToolRegistration } from "@earendil-works/pi-durable";
// Reuse the Workbench redactor (patterns, auth.json and env values) rather than a second copy.
import { redact as workbenchRedact } from "../../../extensions/secret-redaction/redact.mjs";

export type Sanitize = (text: string) => string;
export const redact: Sanitize = (text) => workbenchRedact(text) as string;

const UNTERMINATED_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----(?![\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/;

/**
 * The part of a growing text that can be sanitized now. Secrets never contain whitespace, so a trailing
 * non-whitespace run may still be the start of one; an unterminated private-key block may still grow.
 */
export function completePrefix(text: string): string {
	const key = UNTERMINATED_KEY.exec(text);
	const head = key === null ? text : text.slice(0, key.index);
	const tail = /\S+$/.exec(head);
	return tail === null ? head : head.slice(0, tail.index);
}

const SECRET_START = /^(?:sk-|gh[opsur]_|github_pat_|eyJ|tid=|-----BEGIN)/;

/**
 * For whole values a tool may replace while it streams (details, diagnostics): sanitize the complete part and mask a
 * trailing fragment that starts like a secret, since no pattern can recognise half a secret.
 */
export function strict(sanitize: Sanitize): Sanitize {
	return (text) => {
		const complete = completePrefix(text);
		const rest = text.slice(complete.length);
		return sanitize(complete) + (SECRET_START.test(rest.trimStart()) ? "[REDACTED:partial]" : sanitize(rest));
	};
}

const SKIP = new Set(["image", "thinking", "redacted_thinking"]);

/** Deep-sanitize strings; throws if the sanitizer throws. */
export function sanitizeDeep<T>(value: T, sanitize: Sanitize): T {
	if (typeof value === "string") return sanitize(value) as T;
	if (value === null || typeof value !== "object") return value;
	if (SKIP.has((value as { type?: string }).type ?? "")) return value;
	if (Array.isArray(value)) return value.map((item) => sanitizeDeep(item, sanitize)) as T;
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeDeep(item, sanitize)])) as T;
}

/** Sanitize the text blocks of an assistant message; `partial` withholds what may still become a secret. */
function sanitizeMessage(message: AssistantMessage, sanitize: Sanitize, partial: boolean): AssistantMessage {
	return {
		...message,
		content: message.content.map((block) =>
			block.type === "text" ? { ...block, text: sanitize(partial ? completePrefix(block.text) : block.text) } : block,
		),
		...(message.errorMessage === undefined ? {} : { errorMessage: sanitize(message.errorMessage) }),
	};
}

function failedMessage(model: { api: string; provider: string; id: string }): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "error",
		errorMessage: "Secret redaction failed; response withheld",
		timestamp: Date.now(),
	};
}

/** Re-emit a provider stream with sanitized partials and final message; abort upstream and fail closed on a throw. */
function sanitizeEvents(
	open: (signal: AbortSignal) => AssistantMessageEventStream,
	upstream: AbortSignal | undefined,
	model: { api: string; provider: string; id: string },
	sanitize: Sanitize,
): AssistantMessageEventStream {
	const controller = new AbortController();
	if (upstream !== undefined) {
		if (upstream.aborted) controller.abort(upstream.reason);
		else upstream.addEventListener("abort", () => controller.abort(upstream.reason), { once: true });
	}
	const source = open(controller.signal);
	const out = createAssistantMessageEventStream();
	void (async () => {
		try {
			for await (const event of source) {
				let next: AssistantMessageEvent;
				if (event.type === "done") next = { ...event, message: sanitizeMessage(event.message, sanitize, false) };
				else if (event.type === "error") next = { ...event, error: sanitizeMessage(event.error, sanitize, false) };
				else {
					const partial = sanitizeMessage(event.partial, sanitize, true);
					// Deltas would carry raw text; consumers read the sanitized partial instead.
					next = { ...event, partial, ...("delta" in event ? { delta: "" } : {}), ...("content" in event ? { content: "" } : {}) } as AssistantMessageEvent;
				}
				out.push(next);
			}
			out.end();
		} catch {
			controller.abort(new Error("Secret redaction failed"));
			out.push({ type: "error", reason: "error", error: failedMessage(model) });
			out.end();
		}
	})();
	return out;
}

/** A provider whose model output reaches its caller only sanitized, optionally rewriting the outbound payload. */
export function wrapProvider(
	inner: Provider,
	options: { readonly sanitize?: Sanitize; readonly onPayload?: (payload: unknown) => unknown } = {},
): Provider {
	const sanitize = options.sanitize ?? redact;
	type Options = { signal?: AbortSignal; onPayload?: (payload: unknown, model: never) => unknown } | undefined;
	const withPayload = (o: Options, signal: AbortSignal): Options => {
		const previous = o?.onPayload;
		const transform = options.onPayload;
		return {
			...o,
			signal,
			...(transform === undefined
				? {}
				: { onPayload: async (payload: unknown, model: never) => transform((await previous?.(payload, model)) ?? payload) }),
		};
	};
	return {
		id: inner.id,
		name: inner.name,
		...(inner.baseUrl === undefined ? {} : { baseUrl: inner.baseUrl }),
		...(inner.headers === undefined ? {} : { headers: inner.headers }),
		auth: inner.auth,
		getModels: () => inner.getModels(),
		stream: (model, context, o) =>
			sanitizeEvents((signal) => inner.stream(model, context, withPayload(o, signal) as never), o?.signal, model, sanitize),
		streamSimple: (model, context, o) =>
			sanitizeEvents((signal) => inner.streamSimple(model, context, withPayload(o, signal) as never), o?.signal, model, sanitize),
		...(inner.getAllModels === undefined ? {} : { getAllModels: () => inner.getAllModels!() }),
		...(inner.refreshModels === undefined ? {} : { refreshModels: (c) => inner.refreshModels!(c) }),
		...(inner.filterModels === undefined ? {} : { filterModels: (m, c) => inner.filterModels!(m, c) }),
		...(inner.filterAllModels === undefined ? {} : { filterAllModels: (m, c) => inner.filterAllModels!(m, c) }),
		...(inner.fetchDeferred === undefined
			? {}
			: {
					fetchDeferred: (model, handle, o) =>
						sanitizeEvents((signal) => inner.fetchDeferred!(model, handle, { ...o, signal }), o?.signal, model, sanitize),
				}),
		...(inner.cancelDeferred === undefined ? {} : { cancelDeferred: (m, h, o) => inner.cancelDeferred!(m, h, o) }),
	};
}

const FAILED = "Secret redaction failed; tool output withheld";

/** Wrap one tool so nothing it streams or returns reaches Durable unsanitized. */
export function redactingTool<T extends ToolRegistration>(tool: T, sanitize: Sanitize = redact): T {
	const execute: ToolRegistration["execute"] = async (args, api, context) => {
		const decoder = new TextDecoder();
		let pending = "";
		let failed = false;
		const forward = (text: string, skipped?: Parameters<ToolExecutionApi["output"]>[1]) => {
			if (failed) return;
			try {
				if (text !== "") api.output(sanitize(text), skipped);
			} catch {
				failed = true;
			}
		};
		const flush = () => {
			const rest = pending;
			pending = "";
			forward(rest);
		};
		const proxy = new Proxy(api, {
			get(target, property) {
				if (property === "output")
					return (chunk: string | Uint8Array, skipped?: Parameters<ToolExecutionApi["output"]>[1]) => {
						pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
						const ready = completePrefix(pending);
						pending = pending.slice(ready.length);
						forward(ready, skipped);
					};
				if (property === "retainedOutput")
					return () => {
						flush();
						return target.retainedOutput();
					};
				if (property === "diagnostic")
					return (diagnostic: Parameters<ToolExecutionApi["diagnostic"]>[0]) => {
						try {
							target.diagnostic({ ...diagnostic, message: strict(sanitize)(diagnostic.message) });
						} catch {
							failed = true;
						}
					};
				if (property === "details") return (value: never, c: never) => target.details(sanitizeDeep(value, strict(sanitize)), c);
				const value = Reflect.get(target, property, target) as unknown;
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		let result: ToolExecutionResult;
		try {
			result = await tool.execute(args as never, proxy as never, context);
		} catch (error) {
			let message = FAILED;
			try {
				message = sanitize(error instanceof Error ? error.message : String(error));
			} catch {
				// Keep the fixed message.
			}
			throw new Error(message);
		}
		flush();
		if (failed) throw new Error(FAILED);
		try {
			return sanitizeDeep(result, sanitize);
		} catch {
			throw new Error(FAILED);
		}
	};
	return { ...tool, execute } as T;
}
