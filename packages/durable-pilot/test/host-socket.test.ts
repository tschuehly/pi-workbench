// The Durable Chat host on its owner-only Unix socket (Phase C1): PI WEB's session daemon reaches a launchd-owned host
// there instead of over a fork's IPC pipe. The handshake names protocol, host revision, store ID, owner epoch and PID;
// a dropped connection leaves the host and its running turn alone, and the next connection reattaches to them.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { readLog } from "../src/faux.ts";
import { fakeAgentDir } from "./chat-proc.ts";
import { cleanup, PACKAGE, scratch } from "./runner.ts";

type UiEvent = { type: string; [key: string]: unknown };
type Ready = { protocol: number; revision: string; storeId: string; ownerEpoch: number; pid: number };
type Line = { id?: number; result?: unknown; error?: { message: string }; event?: UiEvent; ready?: Ready };

process.env.PI_TELEMETRY_DIR = scratch("socket-telemetry");
process.env.PI_STORAGE_GUARD_FREE_GB = "1000";
process.env.PI_TMP_ROOT = scratch("socket-pi-tmp");
process.env.PI_CODING_AGENT_DIR = fakeAgentDir("socket-agent");

const live = new Set<ChildProcess>();
// macOS caps a Unix socket path at 104 bytes; a session-scoped TMPDIR is longer, so sockets go to a short owner-only dir.
const SOCKETS = mkdtempSync(join(tmpdir().length <= 60 ? tmpdir() : join(homedir(), ".pi-workbench", "tmp"), "dps-"));
after(() => {
	for (const child of live) child.kill("SIGKILL");
	rmSync(SOCKETS, { recursive: true, force: true });
	cleanup();
});

function start(label: string, socket: string, tps = 40, args: string[] = []): { child: ChildProcess; store: string; exited: Promise<number | null>; stderr: () => string } {
	const dir = scratch(`socket-${label}`);
	const cwd = join(dir, "workspace");
	mkdirSync(cwd);
	const store = join(dir, "family");
	// No IPC channel: the host owns its life, as under launchd.
	const child = spawn(process.execPath, [join(PACKAGE, "src", "chat-host-main.ts"), "--store", store, "--cwd", cwd, "--model", "faux", "--faux-tps", String(tps), "--socket", socket, ...args], { stdio: ["ignore", "ignore", "pipe"] });
	live.add(child);
	let stderr = "";
	child.stderr!.on("data", (data) => (stderr += data.toString()));
	const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => (live.delete(child), resolve(code))));
	return { child, store, exited, stderr: () => stderr };
}

/** One daemon-side connection: newline-delimited JSON both ways. */
class Client {
	readonly lines: Line[] = [];
	readonly ready: Promise<Ready>;
	readonly socket: Socket;
	#next = 1;
	#wake: (() => void)[] = [];

	constructor(path: string) {
		this.socket = connect({ path });
		let buffer = "";
		this.socket.on("data", (chunk) => {
			buffer += chunk.toString();
			for (let end = buffer.indexOf("\n"); end !== -1; end = buffer.indexOf("\n")) {
				this.lines.push(JSON.parse(buffer.slice(0, end)) as Line);
				buffer = buffer.slice(end + 1);
				for (const wake of this.#wake.splice(0)) wake();
			}
		});
		this.socket.on("error", () => undefined);
		this.ready = this.until((line) => line.ready !== undefined).then((line) => line.ready!);
	}

	async until(match: (line: Line) => boolean): Promise<Line> {
		for (;;) {
			const found = this.lines.find(match);
			if (found !== undefined) return found;
			await new Promise<void>((resolve) => this.#wake.push(resolve));
		}
	}

	async call<T = unknown>(method: string, params?: object): Promise<T> {
		const id = this.#next++;
		this.socket.write(`${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`);
		const reply = await this.until((line) => line.id === id);
		if (reply.error !== undefined) throw new Error(reply.error.message);
		return reply.result as T;
	}
}

async function connected(path: string, host: { child: ChildProcess; stderr: () => string }): Promise<Client> {
	for (;;) {
		if (existsSync(path)) return new Client(path);
		if (host.child.exitCode !== null) throw new Error(`host exited: ${host.stderr()}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

test("handshake names protocol, revision, store, owner epoch and PID; a dropped connection leaves the running turn alone", async () => {
	const dir = mkdtempSync(join(SOCKETS, "h-"));
	const path = join(dir, "host.sock");
	const host = start("reattach", path);
	const first = await connected(path, host);
	const ready = await first.ready;
	assert.equal(ready.protocol, 2);
	assert.equal(ready.storeId, basename(host.store));
	assert.equal(ready.revision, realpathSync(join(PACKAGE, "..", "..")), "the revision folder the host runs from");
	assert.equal(ready.pid, host.child.pid);
	assert.equal(typeof ready.ownerEpoch, "number");
	assert.equal(lstatSync(path).mode & 0o777, 0o600, "owner-only socket");

	await first.call("prompt", { operationId: "op-1", text: "gen" });
	await first.until((line) => line.event?.type === "assistant.delta");
	first.socket.destroy();

	// The daemon is gone; the host streams on. A new daemon connects and gets the same host and owner.
	const second = await connected(path, host);
	const again = await second.ready;
	assert.deepEqual(again, ready);
	await second.until((line) => line.event?.type === "agent.end");
	const transcript = await second.call<{ messages: { role: string }[] }>("transcript");
	assert.deepEqual(transcript.messages.map((m) => m.role), ["user", "assistant"]);
	assert.deepEqual(readLog<{ label: string }>(join(host.store, "requests.log")).map((l) => l.label), ["gen"], "one provider request, never resent");

	await second.call("close");
	assert.equal(await host.exited, 0, host.stderr());
	assert.equal(existsSync(path), false, "the host removes its socket on an orderly exit");
});

test("a daemon lost mid-grant recovers the same Chat OFF, even if the grant reached the host but its acknowledgement was lost", { skip: process.platform !== "darwin" }, async () => {
	for (const applied of [false, true]) {
		const path = join(mkdtempSync(join(SOCKETS, "g-")), "host.sock");
		const nonce = randomBytes(16).toString("hex");
		const digest = createHash("sha256").update(nonce).digest("hex");
		const host = start("upgrade", path, 40, ["--full-access-sha256", digest]);
		const first = await connected(path, host);
		await first.ready;
		const access = async (peer: Client) => (await peer.call<{ extensionStatuses: Record<string, string> }>("status")).extensionStatuses["workbench.full-access"];
		await assert.rejects(first.call("resume", { reason: "upgrade-restart" }), /not this launch's upgrade nonce/);
		await assert.rejects(first.call("resume", { reason: "upgrade-restart", fullAccess: digest }), /not this launch's upgrade nonce/);
		if (applied) {
			await first.call("resume", { reason: "upgrade-restart", fullAccess: nonce });
			assert.equal(await access(first), "on");
		}
		first.socket.destroy();
		const next = await connected(path, host);
		await next.ready;
		await next.call("resume", { reason: "upgrade-restart", discardFullAccess: true });
		assert.equal(await access(next), "off");
		await next.call("resume", { reason: "upgrade-restart", fullAccess: nonce });
		assert.equal(await access(next), "off", "a late or replayed grant cannot re-enable it");
		await next.call("close");
		assert.equal(await host.exited, 0, host.stderr());
	}
});

test("P064 a spawn_session request made while no daemon is connected is re-sent to the next daemon: one Chat, one result", async () => {
	const dir = mkdtempSync(join(SOCKETS, "s-"));
	const path = join(dir, "host.sock");
	const host = start("spawn-reconnect", path, 10_000);
	const first = await connected(path, host);
	await first.ready;
	await first.call("configure", { resources: {}, spawnSessions: true });
	// The daemon goes away (promotion, kill) right as the lead asks for the Chat: the request has nobody to reach.
	first.socket.end(`${JSON.stringify({ id: 99, method: "prompt", params: { operationId: "op-1", text: `call:spawn_session ${JSON.stringify({ prompt: "Fix the build" })}` } })}\n`);
	const log = join(host.store, "requests.log");
	while (!existsSync(log) || readLog(log).length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
	await new Promise((resolve) => setTimeout(resolve, 500));
	assert.ok(!first.lines.some((line) => line.event?.type === "durable.spawn"), "the request was emitted while disconnected");

	const second = await connected(path, host);
	await second.ready;
	const request = (await second.until((line) => line.event?.type === "durable.spawn")).event!;
	assert.equal(request.prompt, "Fix the build");
	await second.call("spawned", { requestId: request.requestId, result: { sessionId: "chat-2", cwd: "/repo" } });
	const isResult = (line: Line) => line.event?.type === "message.end" && (line.event.message as { role?: string }).role === "toolResult";
	const result = (await second.until(isResult)).event!.message as { isError?: boolean; content: { text: string }[] };
	assert.notEqual(result.isError, true);
	assert.equal(result.content[0]?.text, "Started independent session chat-2 in /repo.");
	await second.until((line) => line.event?.type === "agent.end");
	assert.equal(second.lines.filter((line) => line.event?.type === "durable.spawn").length, 1, "asked once per connection");
	assert.equal(second.lines.filter(isResult).length, 1);

	// A third daemon hears nothing more: the answered request is no longer pending.
	second.socket.destroy();
	const third = await connected(path, host);
	await third.ready;
	await third.call("status");
	assert.ok(!third.lines.some((line) => line.event?.type === "durable.spawn"));
	await third.call("close");
	assert.equal(await host.exited, 0, host.stderr());
});

test("viewed: a closed or replaced daemon connection resets it to false; the next daemon sets it again", async () => {
	const dir = mkdtempSync(join(SOCKETS, "v-"));
	const path = join(dir, "host.sock");
	const host = start("viewed", path);
	const first = await connected(path, host);
	await first.ready;
	assert.deepEqual(await first.call("setViewed", { viewed: true }), { was: false });
	first.socket.destroy();

	const second = await connected(path, host);
	await second.ready;
	assert.deepEqual(await second.call("setViewed", { viewed: true }), { was: false }, "the closed connection's true is gone");
	// A third daemon replaces the second while it is still connected.
	const third = await connected(path, host);
	await third.ready;
	assert.deepEqual(await third.call("setViewed", { viewed: false }), { was: false }, "the replaced connection's true is gone");
	await third.call("close");
	assert.equal(await host.exited, 0, host.stderr());
});

test("refuses a socket folder others can reach", async () => {
	const dir = mkdtempSync(join(SOCKETS, "o-"));
	chmodSync(dir, 0o755);
	const host = start("open-dir", join(dir, "host.sock"));
	assert.notEqual(await host.exited, 0);
	assert.match(host.stderr(), /owner-only/);
});
