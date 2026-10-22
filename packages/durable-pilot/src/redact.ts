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
import { knownValues, redact as workbenchRedact } from "../../../extensions/secret-redaction/redact.mjs";

export type Sanitize = (text: string) => string;
export const redact: Sanitize = (text) => workbenchRedact(text) as string;

const UNTERMINATED_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----(?![\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/;
// A PEM opening header still being written: it contains spaces, so the trailing-token rule alone would release it.
const PARTIAL_HEADER = /-----BEGIN[A-Z ]*-{0,4}$/;

/**
 * The part of a growing text that can be sanitized now. Secrets never contain whitespace, so a trailing
 * non-whitespace run may still be the start of one; an unterminated private-key block, or an opening header that may
 * become one, may still grow.
 */
export function completePrefix(text: string): string {
	const key = UNTERMINATED_KEY.exec(text) ?? PARTIAL_HEADER.exec(text);
	const head = key === null ? text : text.slice(0, key.index);
	const tail = /\S+$/.exec(head);
	return tail === null ? head : head.slice(0, tail.index);
}

/** For text that will not grow: mask a private-key block that never ended (the redactor only matches whole blocks). */
export function sealed(sanitize: Sanitize): Sanitize {
	return (text) => sanitize(text).replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/, "[REDACTED:private-key]");
}

const SECRET_START = /^(?:sk-|gh[opsur]_|github_pat_|eyJ|tid=|-----BEGIN)/;
/** Shortest leading fragment of a known credential value that is masked; shorter ones are too common to tell apart. */
const MIN_FRAGMENT = 6;

/**
 * Mask the end of `text` when it is the leading fragment of a known credential value (auth.json or a secret-named env
 * variable): such a value has no recognisable shape, so only the known-value list can tell.
 */
export function maskKnownFragment(text: string, values: readonly string[] = knownValues() as string[]): string {
	let longest = 0;
	for (const value of values)
		for (let k = Math.min(value.length - 1, text.length); k >= MIN_FRAGMENT && k > longest; k--)
			if (text.endsWith(value.slice(0, k))) {
				longest = k;
				break;
			}
	return longest === 0 ? text : `${text.slice(0, text.length - longest)}[REDACTED:partial]`;
}

/**
 * For whole values a tool may replace while it streams (details, diagnostics): sanitize the complete part and mask a
 * trailing fragment that starts like a secret or like a known credential value, since no pattern can recognise half a
 * secret.
 */
export function strict(sanitize: Sanitize): Sanitize {
	return (text) => {
		const complete = completePrefix(text);
		const rest = text.slice(complete.length);
		return sanitize(complete) + (SECRET_START.test(rest.trimStart()) || rest.includes("-----BEGIN") ? "[REDACTED:partial]" : maskKnownFragment(sanitize(rest)));
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
function sanitizeMessage(message: AssistantMessage, sanitize: Sanitize, partial: boolean, rename?: (name: string) => string): AssistantMessage {
	return {
		...message,
		content: message.content.map((block) =>
			block.type === "text"
				? { ...block, text: sanitize(partial ? completePrefix(block.text) : block.text) }
				: block.type === "toolCall" && rename !== undefined
					? { ...block, name: rename(block.name) }
					: block,
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
	rename?: (name: string) => string,
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
				if (event.type === "done") next = { ...event, message: sanitizeMessage(event.message, sanitize, false, rename) };
				else if (event.type === "error") next = { ...event, error: sanitizeMessage(event.error, sanitize, false, rename) };
				else {
					const partial = sanitizeMessage(event.partial, sanitize, true, rename);
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
	options: {
		readonly sanitize?: Sanitize;
		/** Outbound payload rewrite (pi-ai `onPayload`), e.g. the Claude subscription rules. */
		readonly onPayload?: (payload: unknown, model: { provider: string; id: string }) => unknown;
		/** Observe response status and headers (pi-ai `onResponse`). */
		readonly onResponse?: (response: { status: number; headers: Record<string, string> }) => void;
		/** Canonical tool name for a name the provider returned (alias → flat), applied before Durable sees the call. */
		readonly canonicalToolName?: (name: string) => string;
	} = {},
): Provider {
	const sanitize = sealed(options.sanitize ?? redact);
	const rename = options.canonicalToolName;
	type Options = { signal?: AbortSignal; onPayload?: (payload: unknown, model: never) => unknown; onResponse?: (r: never, m: never) => unknown } | undefined;
	const withPayload = (o: Options, signal: AbortSignal): Options => {
		const previous = o?.onPayload;
		const transform = options.onPayload;
		const observe = options.onResponse;
		return {
			...o,
			signal,
			...(transform === undefined
				? {}
				: { onPayload: async (payload: unknown, model: never) => transform((await previous?.(payload, model)) ?? payload, model) }),
			...(observe === undefined
				? {}
				: { onResponse: async (response: never, model: never) => (observe(response), o?.onResponse?.(response, model)) }),
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
			sanitizeEvents((signal) => inner.stream(model, context, withPayload(o, signal) as never), o?.signal, model, sanitize, rename),
		streamSimple: (model, context, o) =>
			sanitizeEvents((signal) => inner.streamSimple(model, context, withPayload(o, signal) as never), o?.signal, model, sanitize, rename),
		...(inner.getAllModels === undefined ? {} : { getAllModels: () => inner.getAllModels!() }),
		...(inner.refreshModels === undefined ? {} : { refreshModels: (c) => inner.refreshModels!(c) }),
		...(inner.filterModels === undefined ? {} : { filterModels: (m, c) => inner.filterModels!(m, c) }),
		...(inner.filterAllModels === undefined ? {} : { filterAllModels: (m, c) => inner.filterAllModels!(m, c) }),
		...(inner.fetchDeferred === undefined
			? {}
			: {
					fetchDeferred: (model, handle, o) =>
						sanitizeEvents((signal) => inner.fetchDeferred!(model, handle, { ...o, signal }), o?.signal, model, sanitize, rename),
				}),
		...(inner.cancelDeferred === undefined ? {} : { cancelDeferred: (m, h, o) => inner.cancelDeferred!(m, h, o) }),
	};
}

const FAILED = "Secret redaction failed; tool output withheld";

type Env = NonNullable<ToolExecutionApi["env"]>;
type ExecOptions = NonNullable<Parameters<Env["exec"]>[1]>;

/**
 * An environment whose shell spill files hold sanitized text. The environment would write the complete raw output to
 * its spill file itself, outside every tool wrapper; instead the command runs without `spill` (and without `window`, so
 * every chunk arrives), and this wrapper writes the sanitized stream to its own spill file once the same thresholds are
 * crossed, holding back a tail that may still become a secret. The tool's `onOutput` still gets the raw chunks, which
 * the wrapped `api.output` sanitizes.
 */
export function sanitizingEnv(env: Env, sanitize: Sanitize): Env {
	return new Proxy(env, {
		get(target, property) {
			if (property !== "exec") {
				const value = Reflect.get(target, property, target) as unknown;
				return typeof value === "function" ? value.bind(target) : value;
			}
			return async (command: Parameters<Env["exec"]>[0], options: ExecOptions | undefined, context: Parameters<Env["exec"]>[2]) => {
				if (options?.spill === undefined) return target.exec(command, options, context);
				const { spill, window: _window, ...rest } = options;
				let bytes = 0;
				let lines = 0;
				let pending = "";
				let head = "";
				let path: string | undefined;
				let writes: Promise<void> = Promise.resolve();
				let failure: unknown;
				const write = (text: string) => {
					if (text === "") return;
					if (path === undefined && bytes <= spill.afterBytes && lines <= spill.afterLines) {
						head += text;
						return;
					}
					const chunk = head + text;
					head = "";
					writes = writes.then(async () => {
						if (path === undefined) {
							const created = await target.createTempFile({ prefix: "pi-output-", suffix: ".log" }, context);
							if (!created.ok) throw created.error;
							path = created.value;
						}
						const appended = await target.appendFile(path, chunk, context);
						if (!appended.ok) throw appended.error;
					}).catch((error: unknown) => void (failure ??= error));
				};
				const result = await target.exec(
					command,
					{
						...rest,
						onOutput: (text, c, info) => {
							bytes += Buffer.byteLength(text);
							for (const char of text) if (char === "\n") lines++;
							pending += text;
							const ready = completePrefix(pending);
							pending = pending.slice(ready.length);
							write(sanitize(ready));
							rest.onOutput?.(text, c, info);
						},
					},
					context,
				);
				if (path !== undefined || bytes > spill.afterBytes || lines > spill.afterLines) write(sanitize(pending));
				await writes;
				if (failure !== undefined) throw new Error("Failed to preserve complete shell output", { cause: failure });
				if (path === undefined) return result;
				return result.ok ? { ...result, value: { ...result.value, spillPath: path } } : { ...result, error: Object.assign(result.error, { spillPath: path }) };
			};
		},
	});
}

/** Wrap one tool so nothing it streams or returns reaches Durable unsanitized. */
export function redactingTool<T extends ToolRegistration>(tool: T, inner: Sanitize = redact): T {
	const sanitize = sealed(inner);
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
		// Only when the tool has returned: the held tail can no longer grow.
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
				// Never flushes: the held tail may be half a secret. The tool sees it masked; nothing is committed.
				if (property === "retainedOutput")
					return () => {
						const retained = target.retainedOutput();
						let tail = "";
						try {
							tail = strict(sanitize)(pending);
						} catch {
							failed = true;
						}
						return { ...retained, text: retained.text + tail };
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
				// Output is transformed here, so an environment must not omit text outside a window this wrapper never sees.
				if (property === "outputWindow") return undefined;
				if (property === "env") return target.env === undefined ? undefined : sanitizingEnv(target.env, sanitize);
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
			const { details, ...rest } = result;
			return { ...sanitizeDeep(rest, sanitize), ...(details === undefined ? {} : { details: sanitizeDeep(details, strict(sanitize)) }) };
		} catch {
			throw new Error(FAILED);
		}
	};
	return { ...tool, execute } as T;
}
