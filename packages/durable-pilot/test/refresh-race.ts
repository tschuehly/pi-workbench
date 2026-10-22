// The concurrent-refresh race of Phase A, shared by the Claude matrix row (credentials.test.ts) and the OpenAI
// provider row (providers.test.ts): pilot host processes and a stand-in for the installed Pi (its own AuthStorage,
// loaded from the installed package) find the same expired login at the same moment and refresh it against a fake
// OAuth endpoint with rotating refresh tokens. Pi's auth.json lock must serialize them.
import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { PiAuthStore } from "../src/claude.ts";
import { PACKAGE, scratch } from "./runner.ts";

export type Provider = "anthropic" | "openai-codex";

/** A ChatGPT-shaped access token (unsigned JWT): pi-ai reads the account ID from its auth claim on refresh. */
export const codexToken = (tag: string) =>
	["e30", Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: `acct-${tag}` } })).toString("base64url"), "sig"].join(".");

export type E = Record<string, any>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** The installed Pi's credential store module (unbundled build of the same source its CLI bundles). */
export function installedPiAuthStorage(): string {
	const cli = realpathSync(execFileSync("which", ["pi"]).toString().trim()); // …/pi-coding-agent/dist/bundle/cli.js
	const module = join(dirname(cli), "..", "core", "auth-storage.js");
	if (!existsSync(module)) throw new Error(`Installed Pi has no ${module}; cannot stand in for it`);
	return module;
}

/** Fake OAuth token endpoint with rotating refresh tokens: a reused refresh token is rejected, as a real one would be. */
async function fakeOAuth(initialRefresh: string, provider: Provider) {
	let valid = initialRefresh;
	const state = { requests: 0, rejected: 0, issued: [] as { access: string; refresh: string }[] };
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => {
			state.requests++;
			// Claude posts JSON, Codex a form body.
			const grant = (provider === "anthropic" ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body))) as { grant_type: string; refresh_token: string };
			if (grant.grant_type !== "refresh_token" || grant.refresh_token !== valid) {
				state.rejected++;
				response.writeHead(400, { "content-type": "application/json" }).end('{"error":"invalid_grant"}');
				return;
			}
			const tag = randomBytes(12).toString("hex");
			const issued = { access: provider === "anthropic" ? `fake-oat-${tag}` : codexToken(tag), refresh: `fake-ort-${randomBytes(12).toString("hex")}` };
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

export async function race(piModule: string, kinds = ["host", "host", "pi"], provider: Provider = "anthropic"): Promise<E> {
	const dir = scratch("refresh");
	const authPath = join(dir, "agent", "auth.json");
	mkdirSync(dirname(authPath), { recursive: true, mode: 0o700 });
	const initialRefresh = `fake-ort-${randomBytes(12).toString("hex")}`;
	writeFileSync(
		authPath,
		JSON.stringify({ [provider]: { type: "oauth", access: "fake-oat-expired", refresh: initialRefresh, expires: Date.now() - 60_000, ...(provider === "openai-codex" ? { accountId: "acct-expired" } : {}) }, other: { type: "api_key", key: "fake-other-key" } }, null, 2),
		{ mode: 0o600 },
	);
	const oauth = await fakeOAuth(initialRefresh, provider);
	const children: ChildProcess[] = kinds.map((kind, i) =>
		fork(join(PACKAGE, "test", "refresher.ts"), [kind, authPath, oauth.endpoint, piModule, join(dir, `host-${i}`), provider], { stdio: ["ignore", "ignore", "pipe", "ipc"] }),
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
					await reader.read(provider);
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
			finalAccess: hash(final[provider].access),
			finalRefreshIsIssued: issued !== undefined && final[provider].refresh === issued.refresh,
			finalExpiresInFuture: final[provider].expires > Date.now(),
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
