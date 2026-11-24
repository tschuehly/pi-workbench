#!/usr/bin/env node
// Sends Thomas a Telegram link to the Chat whenever a Durable Chat opens an ask_user question set.
// Listens on PI WEB's global event socket (`session.attention`, kind "ask", emitted once when a set opens),
// so it needs no PI WEB or Durable host change. The link goes through the always-on Cloudflare tunnel.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC_BASE = "https://pi.tschuehly.de/";
const EVENTS_URL = `ws://127.0.0.1:${process.env.PI_WEB_PORT ?? "8506"}/api/sessions/events`;
const STATE_PATH = process.env.PHONE_LINK_STATE ?? join(homedir(), ".pi-workbench", "phone-link", "sent-asks.json");
const CONFIG_PATH = process.env.PING_A_HUMAN_CONFIG ?? join(homedir(), ".config", "ping-a-human", "config.json");
const MAX_REMEMBERED = 500;

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

function loadSent() {
	try {
		const value = JSON.parse(readFileSync(STATE_PATH, "utf8"));
		return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
	} catch {
		return [];
	}
}

function saveSent(sent) {
	mkdirSync(dirname(STATE_PATH), { recursive: true });
	writeFileSync(`${STATE_PATH}.tmp`, JSON.stringify(sent));
	renameSync(`${STATE_PATH}.tmp`, STATE_PATH);
}

async function sendTelegram(text) {
	// Read per send so a changed config needs no restart; never log its values.
	const { telegram } = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
	if (typeof telegram?.botToken !== "string" || typeof telegram?.chatId !== "string") throw new Error(`no telegram.botToken/chatId in ${CONFIG_PATH}`);
	const response = await fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ chat_id: telegram.chatId, text, disable_web_page_preview: true }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error(`Telegram sendMessage answered HTTP ${response.status}`);
}

function log(message) {
	console.log(`${new Date().toISOString()} ${message}`);
}

function watch() {
	const sent = loadSent();
	let delay = 1_000;
	const connect = () => {
		const socket = new WebSocket(EVENTS_URL);
		socket.onopen = () => { delay = 1_000; log(`listening on ${EVENTS_URL}`); };
		socket.onmessage = async ({ data }) => {
			let event;
			try { event = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8")); } catch { return; }
			const text = askMessage(event);
			if (text === undefined || !remember(sent, event.id)) return;
			try {
				await sendTelegram(text);
				saveSent(sent);
				log(`sent link for ask ${event.id} in Chat ${event.sessionId}`);
			} catch (error) {
				// Not saved, so the id is retried if the event comes again; the message names no secret.
				sent.splice(sent.indexOf(event.id), 1);
				log(`could not send ask ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
			}
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
