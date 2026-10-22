// Matrix row "Ownership/storage/security": concurrent Claude credential refresh. Two pilot host processes and a
// stand-in for the installed Pi (its own AuthStorage, loaded from the installed package) find the same expired login
// at the same moment and refresh it against a fake OAuth endpoint. Pi's auth.json lock must serialize them.
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { type E, installedPiAuthStorage, race } from "./refresh-race.ts";
import { cleanup, ITERATIONS, PACKAGE } from "./runner.ts";

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
