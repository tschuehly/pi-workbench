#!/usr/bin/env node
// Sends Thomas a Telegram link to the Chat whenever a Durable Chat opens an ask_user question set.
// Listens on PI WEB's global event socket (`session.attention`, kind "ask", emitted once when a set opens),
// so it needs no PI WEB or Durable host change. The link goes through the always-on Cloudflare tunnel.
// An ask missed while the socket was down, or whose send failed, is found again through PI WEB's read-only
// `/api/sessions/recent` and `/api/sessions/:id/asks` on (re)connect, and from `status.update` events' open asks.
// Run by a launchd job in tschuehly-config (hosts/mac/phone-link.nix) from this path: keep it in sync when moving.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC_BASE = "https://pi.tschuehly.de/";
const PI_WEB = `127.0.0.1:${process.env.PI_WEB_PORT ?? "8506"}`;
const EVENTS_URL = `ws://${PI_WEB}/api/sessions/events`;
const STATE_PATH = process.env.PHONE_LINK_STATE ?? join(homedir(), ".pi-workbench", "phone-link", "sent-asks.json");
const CONFIG_PATH = process.env.PING_A_HUMAN_CONFIG ?? join(homedir(), ".config", "ping-a-human", "config.json");
const MAX_REMEMBERED = 500;
/** Waits between attempts of a transiently failing send; after the last one the ask waits for a reconcile. */
const RETRY_DELAYS_MS = [2_000, 10_000, 30_000, 120_000];
/** How often asks whose send failed, and Chats whose read failed, are reconciled while the socket stays up. */
const PENDING_RETRY_MS = 10 * 60_000;
/** Clock slack when picking Chats changed since the last reconcile. */
const RECONCILE_MARGIN_MS = 5 * 60_000;
/** Without a watermark (a first run, or a state file from before), Chats changed this recently are read. */
const BOOTSTRAP_WINDOW_MS = 24 * 60 * 60_000;
/** A Chat whose ask read keeps failing (PI WEB answers HTTP 500 for a deleted Chat) is given up after this many reconciles. */
const MAX_READ_FAILURES = 6;

/** The Telegram text for an opened question set, or undefined for any other event. */
export function askMessage(event, base = PUBLIC_BASE) {
	if (event?.type !== "session.attention" || event.kind !== "ask") return undefined;
	if (typeof event.id !== "string" || event.id === "" || typeof event.sessionId !== "string" || event.sessionId === "") return undefined;
	const url = new URL(base);
	url.searchParams.set("session", event.sessionId);
	const name = typeof event.sessionName === "string" && event.sessionName !== "" ? event.sessionName : "Pi";
	const question = typeof event.detail === "string" && event.detail !== "" ? event.detail : "Needs an answer";
	return `${name}: ${question}\n${url.href}`;
}

/** Records an ask id; false when it was already sent. Keeps only the newest ids. */
export function remember(sent, id) {
	if (sent.includes(id)) return false;
	sent.push(id);
	if (sent.length > MAX_REMEMBERED) sent.splice(0, sent.length - MAX_REMEMBERED);
	return true;
}

/**
 * `delivered`: ask ids Telegram confirmed. `pending`: asks whose send failed, retried at each reconcile while still open.
 * `recheck`: Chats whose ask read failed, read again at each reconcile. `checkedAt`: when the last full reconcile read
 * PI WEB. A state file from before is a bare `delivered` array.
 */
export function loadState(path) {
	let value;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		value = undefined;
	}
	const ids = (list) => (Array.isArray(list) ? list.filter((id) => typeof id === "string") : []);
	if (Array.isArray(value)) return { delivered: ids(value), pending: [], recheck: [] };
	const pending = Array.isArray(value?.pending) ? value.pending.filter((ask) => typeof ask?.id === "string" && typeof ask.sessionId === "string") : [];
	const recheck = Array.isArray(value?.recheck) ? value.recheck.filter((chat) => typeof chat?.sessionId === "string" && typeof chat.cwd === "string") : [];
	return { delivered: ids(value?.delivered), pending, recheck, ...(typeof value?.checkedAt === "string" ? { checkedAt: value.checkedAt } : {}) };
}

/** Synchronous, so two sends finishing together never interleave their writes. */
export function saveState(path, state) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(`${path}.tmp`, JSON.stringify(state));
	renameSync(`${path}.tmp`, path);
}

/** A failure whose message is fixed text or an HTTP status, so it is safe to log. */
class SafeError extends Error {
	constructor(message, status) {
		super(message);
		this.status = status;
	}
}

/** Log text for a send failure: a SafeError's fixed text, else only an allowlisted transport code; never a raw message, which may quote the config or the bot URL. */
export function describeError(error) {
	if (error instanceof SafeError) return error.message;
	const code = error?.cause?.code ?? error?.code;
	if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/u.test(code)) return code;
	if (error?.name === "TimeoutError" || error?.name === "AbortError") return error.name;
	return "unknown error";
}

export async function sendTelegram(text, configPath = CONFIG_PATH) {
	// Read per send so a changed config needs no restart; never log its values (a JSON.parse message quotes nearby text).
	let telegram;
	try {
		({ telegram } = JSON.parse(readFileSync(configPath, "utf8")));
	} catch {
		throw new SafeError(`telegram config ${configPath} is unreadable or not valid JSON`);
	}
	if (typeof telegram?.botToken !== "string" || typeof telegram?.chatId !== "string") throw new SafeError(`no telegram.botToken/chatId in ${configPath}`);
	const response = await fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ chat_id: telegram.chatId, text, disable_web_page_preview: true }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new SafeError(`Telegram sendMessage answered HTTP ${String(response.status)}`, response.status);
}

/** Transport failures, timeouts, 429 and 5xx may pass; a config problem or another HTTP answer needs a fix first. */
export function transient(error) {
	if (!(error instanceof SafeError)) return true;
	return error.status === 429 || (error.status ?? 0) >= 500;
}

async function getJson(path) {
	const response = await fetch(`http://${PI_WEB}${path}`, { signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new SafeError(`PI WEB answered HTTP ${String(response.status)}`, response.status);
	return response.json();
}

const firstLine = (text) => (typeof text === "string" ? (text.trim().split(/\r?\n/u)[0] ?? "").slice(0, 120) : "");

/**
 * Delivers each opened ask's link once. An id counts as delivered only after Telegram confirms it; while a send runs it
 * is only in flight, so a parallel success never saves it. Effects come in: `send(text)`, `getJson(path)` on PI WEB,
 * `save(state)`, `wait(ms)`, `now()`.
 */
export function createLinker({ send, getJson, state, save, log = (_message) => {}, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, retryDelays = RETRY_DELAYS_MS }) {
	const inFlight = new Set();
	const reconciling = new Set();
	const known = (id) => state.delivered.includes(id) || inFlight.has(id) || state.pending.some((ask) => ask.id === id);

	state.recheck ??= [];

	async function deliver({ id, sessionId, cwd, name, text }) {
		if (state.delivered.includes(id) || inFlight.has(id)) return;
		inFlight.add(id);
		try {
			for (let attempt = 0; ; attempt += 1) {
				try {
					await send(text);
					break;
				} catch (error) {
					if (!transient(error) || attempt >= retryDelays.length) {
						if (!state.pending.some((ask) => ask.id === id)) {
							state.pending.push({ id, sessionId, cwd, name });
							save(state);
						}
						log(`could not send ask ${id}: ${describeError(error)}; retrying at the next reconcile`);
						return;
					}
					log(`retrying ask ${id} after ${describeError(error)}`);
					await wait(retryDelays[attempt]);
				}
			}
			remember(state.delivered, id);
			state.pending = state.pending.filter((ask) => ask.id !== id);
			save(state);
			log(`sent link for ask ${id} in Chat ${sessionId}`);
		} finally {
			inFlight.delete(id);
		}
	}

	/**
	 * Sends every still-open ask not yet delivered: of the given Chats, else of Chats with a failed send or read and of
	 * Chats changed since the last full reconcile (an ask opened while the socket was down). A Chat with a failed send or
	 * read is read by its saved id and cwd, as it may be older than the latest 500. Only those Chats are read, because
	 * reading a cold Durable Chat's asks starts its host. Resolves after the sends.
	 */
	async function reconcile(only) {
		const startedAt = now();
		const wanted = only === undefined ? undefined : new Set(only);
		const chats = new Map();
		for (const ref of [...state.pending, ...state.recheck]) {
			if (typeof ref.cwd === "string" && (wanted?.has(ref.sessionId) ?? true)) chats.set(ref.sessionId, { id: ref.sessionId, cwd: ref.cwd, name: ref.name });
		}
		if (only === undefined || only.some((id) => !chats.has(id))) {
			const sessions = await getJson("/api/sessions/recent?limit=500");
			if (!Array.isArray(sessions)) throw new SafeError("PI WEB sessions list is not an array");
			const since = only !== undefined ? Infinity : state.checkedAt === undefined ? startedAt - BOOTSTRAP_WINDOW_MS : Date.parse(state.checkedAt) - RECONCILE_MARGIN_MS;
			for (const chat of sessions) {
				if (typeof chat?.id !== "string" || typeof chat.cwd !== "string" || !(wanted?.has(chat.id) || chats.has(chat.id) || Date.parse(chat.modified) >= since)) continue;
				chats.set(chat.id, { id: chat.id, cwd: chat.cwd, name: typeof chat.name === "string" ? chat.name : chats.get(chat.id)?.name });
			}
		}
		const sends = [];
		await Promise.all([...chats.values()].map(async (chat) => {
			let open;
			try {
				const asks = await getJson(`/api/sessions/${encodeURIComponent(chat.id)}/asks?cwd=${encodeURIComponent(chat.cwd)}`);
				open = Array.isArray(asks?.pendingAsks) ? asks.pendingAsks.filter((ask) => typeof ask?.askId === "string") : [];
			} catch (error) {
				const failures = (state.recheck.find((ref) => ref.sessionId === chat.id)?.failures ?? 0) + 1;
				state.recheck = state.recheck.filter((ref) => ref.sessionId !== chat.id);
				if (failures < MAX_READ_FAILURES) {
					state.recheck.push({ sessionId: chat.id, cwd: chat.cwd, name: chat.name, failures });
					log(`could not read the open asks of Chat ${chat.id}: ${describeError(error)}; retrying at the next reconcile`);
				} else {
					state.pending = state.pending.filter((ask) => ask.sessionId !== chat.id);
					log(`could not read the open asks of Chat ${chat.id}: ${describeError(error)}; giving up after ${String(failures)} reads`);
				}
				save(state);
				return;
			}
			// A failed ask that closed meanwhile needs no link any more.
			const kept = state.pending.filter((ask) => ask.sessionId !== chat.id || open.some(({ askId }) => askId === ask.id));
			const recheck = state.recheck.filter((ref) => ref.sessionId !== chat.id);
			if (kept.length !== state.pending.length || recheck.length !== state.recheck.length) {
				state.pending = kept;
				state.recheck = recheck;
				save(state);
			}
			for (const ask of open) {
				const sessionName = typeof chat.name === "string" ? chat.name.slice(0, 120) : undefined;
				const text = askMessage({ type: "session.attention", kind: "ask", id: ask.askId, sessionId: chat.id, sessionName, detail: firstLine(ask.questions?.[0]?.question) });
				if (text !== undefined) sends.push(deliver({ id: ask.askId, sessionId: chat.id, cwd: chat.cwd, name: sessionName, text }));
			}
		}));
		// A failed read stays in `recheck`, so the watermark may pass it.
		if (only === undefined) {
			state.checkedAt = new Date(startedAt).toISOString();
			save(state);
		}
		await Promise.all(sends);
	}

	/** The work an event starts, or undefined. A live Chat's `status.update` lists its open asks: one never seen is reconciled. */
	function onEvent(event) {
		const text = askMessage(event);
		if (text !== undefined) return deliver({ id: event.id, sessionId: event.sessionId, cwd: event.cwd, name: event.sessionName, text });
		const sessionId = event?.type === "status.update" ? event.status?.sessionId : undefined;
		const asks = Array.isArray(event?.status?.pendingAsks) ? event.status.pendingAsks : [];
		if (typeof sessionId !== "string" || reconciling.has(sessionId) || !asks.some((ask) => typeof ask?.askId === "string" && !known(ask.askId))) return undefined;
		reconciling.add(sessionId);
		return reconcile([sessionId]).finally(() => reconciling.delete(sessionId));
	}

	return { deliver, reconcile, onEvent };
}

function log(message) {
	console.log(`${new Date().toISOString()} ${message}`);
}

function watch() {
	const state = loadState(STATE_PATH);
	const linker = createLinker({ send: (text) => sendTelegram(text), getJson, state, save: (next) => saveState(STATE_PATH, next), log });
	const run = (work) => void work?.catch((error) => log(`phone link work failed: ${describeError(error)}`));
	setInterval(() => {
		const retry = [...state.pending, ...state.recheck].map((ref) => ref.sessionId);
		if (retry.length > 0) run(linker.reconcile(retry));
	}, PENDING_RETRY_MS);
	let delay = 1_000;
	const connect = () => {
		const socket = new WebSocket(EVENTS_URL);
		socket.onopen = () => {
			delay = 1_000;
			log(`listening on ${EVENTS_URL}`);
			run(linker.reconcile());
		};
		socket.onmessage = ({ data }) => {
			let event;
			try { event = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8")); } catch { return; }
			run(linker.onEvent(event));
		};
		socket.onclose = () => {
			setTimeout(connect, delay);
			delay = Math.min(delay * 2, 60_000);
		};
		socket.onerror = () => {}; // onclose follows and reconnects.
	};
	connect();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) watch();
