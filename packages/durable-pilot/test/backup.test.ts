// Chat backup (src/backup.ts): checked online-backup copies of a store that keeps committing, each compared with a walk
// of its source read on the owning connection at the copy's instant.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { chatBackupPath, copyStore, exclusively, startBackups } from "../src/backup.ts";
import { ChatSession } from "../src/chat-session.ts";
import { context, openHost } from "../src/host.ts";
import { ChatHost, family, live } from "./chat-proc.ts";
import { cleanup, scratch } from "./runner.ts";

after(() => {
	for (const child of live) child.kill("SIGKILL");
	cleanup();
});

/** A 1x1 PNG, as PI WEB sends an inline image. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Every table: its row count and a hash of its rows (sorted, so row order does not matter). */
function walk(db: DatabaseSync): Record<string, { rows: number; hash: string }> {
	const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => String(row.name));
	return Object.fromEntries(
		tables.map((table) => {
			const rows = db.prepare(`SELECT * FROM "${table}"`).all().map((row) => JSON.stringify(row, (_, value) => (value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value))).sort();
			return [table, { rows: rows.length, hash: createHash("sha256").update(rows.join("\n")).digest("hex") }];
		}),
	);
}

function walkFile(path: string): ReturnType<typeof walk> {
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
		return walk(db);
	} finally {
		db.close();
	}
}

test("copies taken while the store commits open, pass integrity_check and match the source walked at the same instant", async () => {
	const dir = scratch("backup-live");
	const destination = join(scratch("backup-dest"), "chats", "chat-a", "session.sqlite");
	const host = await openHost(dir, { faux: { tokensPerSecond: 2000 } });
	host.faux.setResponses(Array.from({ length: 12 }, (_, i) => fauxAssistantMessage([fauxText(`answer ${i} ${"x".repeat(2000)}`)])));
	const session = new ChatSession(host, () => undefined);
	await session.start();
	let writing = true;
	// Real Durable commits all along: prompts (one with an image), their runs and answers.
	const writer = (async () => {
		for (let i = 0; i < 12; i++) {
			const { submissionId } = await session.prompt({ operationId: `op-${i}`, text: `prompt ${i}`, ...(i === 3 ? { images: [{ type: "image" as const, data: PNG, mimeType: "image/png" }] } : {}) });
			await (await host.harness.submission(submissionId, context))!.wait(context);
		}
		writing = false;
	})();
	const seen = new Set<string>();
	let copies = 0;
	while (writing) {
		const source = await exclusively(host.store, async () => {
			const walked = walk(host.store.raw);
			await copyStore(host.store.raw, destination);
			return walked;
		});
		assert.deepEqual(walkFile(destination), source, `copy ${copies} matches its source`);
		seen.add(JSON.stringify(source));
		copies++;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	await writer;
	assert.ok(seen.size >= 3, `copies saw the store change (${seen.size} states in ${copies} copies)`);
	// The inline image is a block in the store, so the copy holds it.
	const copy = new DatabaseSync(destination, { readOnly: true });
	const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name));
	const holding = tables.filter((table) => copy.prepare(`SELECT * FROM "${table}"`).all().some((row) => JSON.stringify(row).includes(PNG)));
	copy.close();
	assert.ok(holding.length > 0, "the copy holds the image data");
	assert.equal(statSync(destination).mode & 0o777, 0o600);
	assert.equal(statSync(dirname(destination)).mode & 0o777, 0o700);
	await session.close();
});

test("an unchanged store is not copied again, a failed check keeps the previous copy, and close takes a final copy", async () => {
	const dir = scratch("backup-timer");
	const destination = join(scratch("backup-dest"), "chats", "chat-b", "session.sqlite");
	const host = await openHost(dir);
	host.faux.setResponses([fauxAssistantMessage([fauxText("one")]), fauxAssistantMessage([fauxText("two")])]);
	const session = new ChatSession(host, () => undefined);
	await session.start();
	const logs: string[] = [];
	const backups = startBackups(host.store, destination, (message) => logs.push(message));
	assert.equal(await backups.copyNow(), false, "copied at start already");
	assert.ok(existsSync(destination), "a copy exists right after start");
	const ask = async (operationId: string, text: string) => {
		const { submissionId } = await session.prompt({ operationId, text });
		await (await host.harness.submission(submissionId, context))!.wait(context);
	};
	await ask("op-1", "first");
	assert.equal(await backups.copyNow(), true, "first copy");
	const first = statSync(destination);
	const good = walkFile(destination);
	assert.equal(await backups.copyNow(), false, "nothing committed: no copy");
	assert.equal(statSync(destination).ino, first.ino, "the file was not replaced");

	await ask("op-2", "second");
	await assert.rejects(exclusively(host.store, () => copyStore(host.store.raw, destination, () => { throw new Error("check failed"); })), /check failed/);
	assert.deepEqual(walkFile(destination), good, "the previous good copy stays");
	assert.deepEqual(readdirSync(dirname(destination)), ["session.sqlite"], "no temporary file left");

	await session.close();
	const closed = walkFile(join(dir, "session.sqlite"));
	assert.deepEqual(walkFile(destination), closed, "the final copy is the closed store");
	assert.notDeepEqual(closed, good);
	assert.deepEqual(logs, []);
});

test("the chat host copies its store into PI_WORKBENCH_BACKUP_DIR/chats/<chat id> on close", async () => {
	const { store, cwd } = family("backup");
	const root = scratch("backup-root");
	const host = new ChatHost(store, cwd, { env: { PI_WORKBENCH_BACKUP_DIR: root } });
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: "look", images: [{ data: PNG, mimeType: "image/png" }] });
	await host.idle(1);
	await host.close();
	assert.equal(await host.exited, 0);
	const destination = join(root, "chats", "family", "session.sqlite");
	assert.ok(existsSync(destination), host.stderr);
	assert.deepEqual(walkFile(destination), walkFile(join(store, "session.sqlite")));
	const prior = process.env.PI_WORKBENCH_BACKUP_DIR;
	process.env.PI_WORKBENCH_BACKUP_DIR = root;
	assert.equal(chatBackupPath("family"), destination);
	process.env.PI_WORKBENCH_BACKUP_DIR = prior;
});

test("a Chat end that fails on unconfirmed job cleanup still takes the final copy", async () => {
	const { store, cwd } = family("backup-end");
	const root = scratch("backup-end-root");
	const jobs = join(scratch("backup-end-jobs"), "jobs");
	// An owned job of this Chat whose runner recorded a surviving process: ending the Chat cannot confirm its cleanup.
	const job = join(jobs, "stuck");
	mkdirSync(job, { recursive: true });
	const now = Date.now();
	writeFileSync(join(job, "job.json"), JSON.stringify({ sessionId: store, owned: true, command: "true", cwd, startedAt: now, expiresAt: now + 60_000 }));
	writeFileSync(join(job, "exit"), JSON.stringify({ exitCode: 0, finishedAt: now, cleanup: { survivors: [1] } }));
	const host = new ChatHost(store, cwd, { env: { PI_WORKBENCH_BACKUP_DIR: root, PI_BACKGROUND_BASH_ROOT: jobs } });
	await host.ready;
	await host.call("prompt", { operationId: "op-1", text: "after the open copy" });
	await host.idle(1);
	await assert.rejects(host.call("close", { end: true }), /cleanup could not be confirmed/);
	host.child.kill("SIGTERM");
	assert.equal(await host.exited, 1);
	const destination = join(root, "chats", "family", "session.sqlite");
	assert.deepEqual(walkFile(destination), walkFile(join(store, "session.sqlite")), host.stderr);
	assert.doesNotMatch(host.stderr, /chat backup .* failed/);
});
