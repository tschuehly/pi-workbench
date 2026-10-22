// One Durable store per family: SQLite WAL + synchronous=FULL through the public Node facade, owned by exactly one
// process. Ownership is a kernel file lock (SQLite EXCLUSIVE locking mode), so a dead owner never leaves a stale lock
// and a reused PID proves nothing either way. owner.json is runtime metadata (epoch, nonce, endpoint), written only by
// the lock holder; it is never proof of liveness.
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase, SqliteExecutor } from "@earendil-works/pi-durable/storage/sqlite";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { NodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";

export class StoreOwnedElsewhere extends Error {
	constructor(path: string, cause: unknown) {
		super(`Store ${path} is owned by another process`, { cause });
		this.name = "StoreOwnedElsewhere";
	}
}

export type Synchronous = "FULL" | "NORMAL";

export type OwnerRecord = {
	readonly epoch: number;
	readonly nonce: string;
	readonly pid: number;
	readonly startedAt: number;
	readonly endpoint?: { readonly host: string; readonly port: number };
};

/** Test-only fault injection at the SQLite facade; production hosts pass none. */
export type Faults = {
	/**
	 * Called inside every write transaction after Durable's statements ran and before COMMIT, with the tables it
	 * touched. A never-settling promise holds the commit open (a kill then loses it); a throw fails it.
	 */
	beforeCommit?: (tables: ReadonlySet<string>) => Promise<void> | void;
};

export type OpenedStore = {
	readonly storage: SqliteStorage;
	readonly database: NodeSqliteDatabase;
	readonly raw: DatabaseSync;
	readonly owner: OwnerRecord;
	readonly pragmas: { readonly journal_mode: string; readonly synchronous: number; readonly locking_mode: string };
	/** Run a pragma or query on the owned connection (for diagnostics such as max_page_count). */
	exec(sql: string): Promise<void>;
};

const SYNC_CODE: Record<Synchronous, number> = { NORMAL: 1, FULL: 2 };

export function ownerPath(storePath: string): string {
	return join(dirname(storePath), "owner.json");
}

export function readOwner(storePath: string): OwnerRecord | undefined {
	try {
		return JSON.parse(readFileSync(ownerPath(storePath), "utf8")) as OwnerRecord;
	} catch {
		return undefined;
	}
}

export function writeOwner(storePath: string, owner: OwnerRecord): void {
	const path = ownerPath(storePath);
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(owner), { mode: 0o600 });
	renameSync(temporary, path);
}

function tablesOf(sql: string, into: Set<string>): void {
	for (const match of sql.matchAll(/\b(?:INTO|UPDATE|FROM)\s+"?([A-Za-z_][A-Za-z0-9_]*)/gi)) into.add(match[1]!.toLowerCase());
}

function faulty(inner: NodeSqliteDatabase, faults: Faults): SqliteDatabase {
	return {
		exec: (sql) => inner.exec(sql),
		run: (sql, ...params) => inner.run(sql, ...params),
		get: (sql, ...params) => inner.get(sql, ...params),
		all: (sql, ...params) => inner.all(sql, ...params),
		close: () => inner.close(),
		transaction: (callback) =>
			inner.transaction(async (transaction) => {
				const tables = new Set<string>();
				const tracked: SqliteExecutor = {
					exec: (sql) => (tablesOf(sql, tables), transaction.exec(sql)),
					run: (sql, ...params) => (tablesOf(sql, tables), transaction.run(sql, ...params)),
					get: (sql, ...params) => transaction.get(sql, ...params),
					all: (sql, ...params) => transaction.all(sql, ...params),
				};
				const result = await callback(tracked);
				await faults.beforeCommit?.(tables);
				return result;
			}),
	};
}

/**
 * Open a store as its single owner: EXCLUSIVE locking (taken before Durable reads anything), WAL, synchronous as
 * asked (FULL by default), each verified before Durable sees the database. Throws StoreOwnedElsewhere when another
 * live process holds it.
 */
export async function openStore(
	path: string,
	options: { readonly synchronous?: Synchronous; readonly faults?: Faults; readonly busyTimeoutMs?: number } = {},
): Promise<OpenedStore> {
	const synchronous = options.synchronous ?? "FULL";
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const raw = new DatabaseSync(path, { timeout: options.busyTimeoutMs ?? 200 });
	const database = new NodeSqliteDatabase(raw);
	try {
		await database.exec("PRAGMA locking_mode = EXCLUSIVE");
		try {
			await database.exec("PRAGMA journal_mode = WAL");
			// Take the exclusive lock now, before any Durable read.
			await database.exec("BEGIN IMMEDIATE; COMMIT");
		} catch (error) {
			throw new StoreOwnedElsewhere(path, error);
		}
		await database.exec(`PRAGMA synchronous = ${synchronous}`);
		await database.exec("PRAGMA wal_autocheckpoint = 1000");
		const pragmas = {
			journal_mode: (await database.get<{ journal_mode: string }>("PRAGMA journal_mode"))!.journal_mode,
			synchronous: (await database.get<{ synchronous: number }>("PRAGMA synchronous"))!.synchronous,
			locking_mode: (await database.get<{ locking_mode: string }>("PRAGMA locking_mode"))!.locking_mode,
		};
		if (pragmas.journal_mode !== "wal" || pragmas.synchronous !== SYNC_CODE[synchronous] || pragmas.locking_mode !== "exclusive")
			throw new Error(`Store ${path} refused: unexpected pragmas ${JSON.stringify(pragmas)}`);
		chmodSync(path, 0o600);
		const previous = readOwner(path);
		const owner: OwnerRecord = { epoch: (previous?.epoch ?? 0) + 1, nonce: randomUUID(), pid: process.pid, startedAt: Date.now() };
		writeOwner(path, owner);
		const storage = await SqliteStorage.open(options.faults === undefined ? database : faulty(database, options.faults));
		return { storage, database, raw, owner, pragmas, exec: (sql) => database.exec(sql) };
	} catch (error) {
		try {
			raw.close();
		} catch {
			// Keep the open failure.
		}
		throw error;
	}
}

/**
 * Loopback endpoint that answers only clients presenting the current owner's nonce. A client holding owner.json
 * from an earlier owner gets "stale"; a dead endpoint refuses connections. Neither says anything about the store lock.
 */
export async function serveEndpoint(path: string, owner: OwnerRecord): Promise<{ readonly owner: OwnerRecord; close(): Promise<void> }> {
	const server: Server = createServer((socket) => {
		socket.once("data", (data) => socket.end(data.toString().trim() === owner.nonce ? `ok ${owner.epoch}\n` : "stale\n"));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("No endpoint address");
	const published: OwnerRecord = { ...owner, endpoint: { host: "127.0.0.1", port: address.port } };
	writeOwner(path, published);
	return { owner: published, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** Client side: connect with the nonce from owner.json. */
export async function probeEndpoint(owner: OwnerRecord): Promise<"ok" | "stale" | "unreachable"> {
	if (owner.endpoint === undefined) return "unreachable";
	const { connect } = await import("node:net");
	return new Promise((resolve) => {
		const socket = connect(owner.endpoint!.port, owner.endpoint!.host);
		let reply = "";
		socket.on("connect", () => socket.write(`${owner.nonce}\n`));
		socket.on("data", (data) => (reply += data.toString()));
		socket.on("end", () => resolve(reply.startsWith("ok") ? "ok" : "stale"));
		socket.on("error", () => resolve("unreachable"));
	});
}
