// Matrix row "Ownership/storage/security": concurrent Claude credential refresh. Two pilot host processes and a
// stand-in for the installed Pi (its own AuthStorage, loaded from the installed package) find the same expired login
// at the same moment and refresh it against a fake OAuth endpoint. Pi's auth.json lock must serialize them.
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { PiAuthStore } from "../src/claude.ts";
import { cleanup, ITERATIONS, PACKAGE, scratch } from "./runner.ts";

type E = Record<string, any>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** The installed Pi's credential store module (unbundled build of the same source its CLI bundles). */
function installedPiAuthStorage(): string {
	const cli = realpathSync(execFileSync("which", ["pi"]).toString().trim()); // …/pi-coding-agent/dist/bundle/cli.js
	const module = join(dirname(cli), "..", "core", "auth-storage.js");
	if (!existsSync(module)) throw new Error(`Installed Pi has no ${module}; cannot stand in for it`);
	return module;
}

/** Fake OAuth token endpoint with rotating refresh tokens: a reused refresh token is rejected, as a real one would be. */
async function fakeOAuth(initialRefresh: string) {
	let valid = initialRefresh;
	const state = { requests: 0, rejected: 0, issued: [] as { access: string; refresh: string }[] };
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => {
			state.requests++;
			const grant = JSON.parse(body) as { grant_type: string; refresh_token: string };
			if (grant.grant_type !== "refresh_token" || grant.refresh_token !== valid) {
				state.rejected++;
				response.writeHead(400, { "content-type": "application/json" }).end('{"error":"invalid_grant"}');
				return;
			}
			const issued = { access: `fake-oat-${randomBytes(12).toString("hex")}`, refresh: `fake-ort-${randomBytes(12).toString("hex")}` };
			valid = issued.refresh;
			state.issued.push(issued);
			// Hold the response so the other processes are already waiting on the lock.
			setTimeout(() => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: issued.access, refresh_token: issued.refresh, expires_in: 3600 })), 300);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	return { state, endpoint: `http://127.0.0.1:${port}/v1/oauth/token`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function race(piModule: string, kinds = ["host", "host", "pi"]): Promise<E> {
	const dir = scratch("refresh");
	const authPath = join(dir, "agent", "auth.json");
	mkdirSync(dirname(authPath), { recursive: true, mode: 0o700 });
	const initialRefresh = `fake-ort-${randomBytes(12).toString("hex")}`;
	writeFileSync(
		authPath,
		JSON.stringify({ anthropic: { type: "oauth", access: "fake-oat-expired", refresh: initialRefresh, expires: Date.now() - 60_000 }, other: { type: "api_key", key: "fake-other-key" } }, null, 2),
		{ mode: 0o600 },
	);
	const oauth = await fakeOAuth(initialRefresh);
	const children: ChildProcess[] = kinds.map((kind, i) =>
		fork(join(PACKAGE, "test", "refresher.ts"), [kind, authPath, oauth.endpoint, piModule, join(dir, `host-${i}`)], { stdio: ["ignore", "ignore", "pipe", "ipc"] }),
	);
	const next = (child: ChildProcess, type: string) =>
		new Promise<E>((resolve, reject) => {
			child.on("message", (m: E) => m.type === type && resolve(m));
			child.on("exit", (code) => reject(new Error(`refresher exited (${code}) before ${type}`)));
		});
	try {
		await Promise.all(children.map((c) => next(c, "ready")));
		const results = children.map((c) => next(c, "result"));
		// Readers that follow the same lock protocol must never see a torn file while the race runs.
		const reader = new PiAuthStore(authPath);
		let reads = 0;
		let torn = 0;
		let polling = true;
		const poll = (async () => {
			while (polling) {
				try {
					await reader.read("anthropic");
					reads++;
				} catch {
					torn++;
				}
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
		})();
		for (const child of children) child.send("go");
		const evidence = (await Promise.all(results)).map((m) => m.evidence as E);
		polling = false;
		await poll;
		const final = JSON.parse(readFileSync(authPath, "utf8")) as E;
		const issued = oauth.state.issued[0];
		return {
			refreshRequests: oauth.state.requests,
			rejected: oauth.state.rejected,
			processes: evidence,
			issuedAccess: issued === undefined ? null : hash(issued.access),
			finalAccess: hash(final.anthropic.access),
			finalRefreshIsIssued: issued !== undefined && final.anthropic.refresh === issued.refresh,
			finalExpiresInFuture: final.anthropic.expires > Date.now(),
			otherKept: final.other?.key === "fake-other-key",
			mode: (statSync(authPath).mode & 0o777).toString(8),
			lockLeft: existsSync(`${authPath}.lock`),
			lockedReads: reads,
			torn,
		};
	} finally {
		for (const child of children) child.kill("SIGKILL");
		await oauth.close();
	}
}

describe("concurrent credential refresh", () => {
	it("control: the same race without the lock sends more than one refresh request", async () => {
		const e = await race(installedPiAuthStorage(), ["unlocked", "unlocked", "unlocked"]);
		writeFileSync(join(PACKAGE, "results", "evidence", "ownership.concurrent-refresh-control.jsonl"), `${JSON.stringify({ ...e, pass: e.refreshRequests > 1 })}\n`);
		assert.ok(e.refreshRequests > 1, `unlocked processes all refresh: ${e.refreshRequests} requests, ${e.rejected} rejected`);
	});

	it("two hosts and the installed Pi refresh one expired login: one request, one token, intact owner-only file", async () => {
		const piModule = installedPiAuthStorage();
		const file = join(PACKAGE, "results", "evidence", "ownership.concurrent-refresh.jsonl");
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, "");
		for (let iteration = 0; iteration < ITERATIONS; iteration++) {
			const e = await race(piModule);
			let failure: unknown;
			try {
				assert.equal(e.refreshRequests, 1, "exactly one refresh request");
				assert.equal(e.rejected, 0);
				for (const p of e.processes) {
					assert.equal(p.error, undefined, `${p.kind} failed: ${p.error}`);
					assert.equal(p.access, e.issuedAccess, `${p.kind} ends with the refreshed token`);
					assert.equal(p.expiresInFuture, true);
				}
				for (const p of e.processes.filter((p: E) => p.kind === "host")) {
					assert.deepEqual(p.blocked.map((b: E) => b.host), ["api.anthropic.com"], "the turn went on to the (blocked) Messages API");
					assert.equal(p.blocked[0].authorization, e.issuedAccess, "with the refreshed token");
				}
				assert.deepEqual(e.processes.find((p: E) => p.kind === "pi").blocked, [], "the Pi stand-in only resolved auth");
				assert.equal(e.finalAccess, e.issuedAccess);
				assert.equal(e.finalRefreshIsIssued, true, "the rotated refresh token is stored");
				assert.equal(e.finalExpiresInFuture, true);
				assert.equal(e.otherKept, true, "other credentials survive the write");
				assert.equal(e.mode, "600", "auth.json stays owner-only");
				assert.equal(e.lockLeft, false, "lock released");
				assert.equal(e.torn, 0, "no locked reader saw a torn file");
				assert.ok(e.lockedReads > 0);
			} catch (error) {
				failure = error;
			}
			appendFileSync(file, `${JSON.stringify({ iteration, ...e, pass: failure === undefined, ...(failure === undefined ? {} : { failure: String(failure) }) })}\n`);
			if (failure !== undefined) throw failure;
		}
	});
});

after(cleanup);
