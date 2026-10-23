// Matrix row "Ownership/storage/security": concurrent Claude credential refresh. Two pilot host processes and a
// stand-in for the installed Pi (its own AuthStorage, loaded from the installed package) find the same expired login
// at the same moment and refresh it against a fake OAuth endpoint. Pi's auth.json lock must serialize them.
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import lockfile from "proper-lockfile";
import { PiAuthStore } from "../src/claude.ts";
import { type E, installedPiAuthStorage, race } from "./refresh-race.ts";
import { cleanup, ITERATIONS, PACKAGE, scratch } from "./runner.ts";

// Fleet flake "SIGKILL worker child:after-delivery": every credential read took auth.json's lock, so a host killed
// mid-read left it held until it went stale (30 s), and the reopened host's next model request waited it out.
describe("auth.json lock left by a killed host", () => {
	it("reads of an unchanged auth.json never wait for the lock; a changed one and every write still take it", async () => {
		const path = join(scratch("auth-lock"), "auth.json");
		const login = (access: string) => JSON.stringify({ anthropic: { type: "oauth", access, refresh: "fake-ort", expires: Date.now() + 3_600_000 } });
		writeFileSync(path, login("fake-oat-1"), { mode: 0o600 });
		const store = new PiAuthStore(path);
		const access = async (options?: { signal: AbortSignal }) => ((await store.read("anthropic", options)) as { access?: string } | undefined)?.access;
		assert.equal(await access(), "fake-oat-1", "the host's first read");
		// What a host killed mid-read leaves behind: a held lock nobody releases until it is stale.
		const release = await lockfile.lock(path, { realpath: false, stale: 30_000 });
		try {
			const quick = () => ({ signal: AbortSignal.timeout(1_000) });
			assert.equal(await access(quick()), "fake-oat-1", "a read of the unchanged file does not wait");
			assert.deepEqual((await store.list(quick())).map((c) => c.providerId), ["anthropic"]);
			await assert.rejects(store.modify("anthropic", async () => undefined, { signal: AbortSignal.timeout(300) }), "a write still waits for the lock");
			writeFileSync(path, login("fake-oat-2-changed"));
			await assert.rejects(store.read("anthropic", { signal: AbortSignal.timeout(300) }), "a changed file is read under the lock only");
		} finally {
			await release();
		}
		assert.equal(await access(), "fake-oat-2-changed", "the change is read once the lock is free");
	});
});

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
