// Chat backup: a checked copy of a family store, made by its owning process with SQLite's online backup on the owning
// connection (the EXCLUSIVE lock lets no other process read the file), into
// <backup root>/chats/<chat id>/session.sqlite. Inline images are image blocks in the store, so the copy holds them.
import { chmodSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import type { OpenedStore } from "./store.ts";

/** How often a changed store is copied. */
export const BACKUP_INTERVAL_MS = 5 * 60_000;

export function chatBackupPath(chatId: string): string {
	return join(process.env.PI_WORKBENCH_BACKUP_DIR ?? join(homedir(), ".pi-workbench", "backup-staging"), "chats", chatId, "session.sqlite");
}

/**
 * Run `operation` on the owning connection with no Durable statement or transaction before it settles: a backup
 * inside an open write transaction fails, and a copy must show committed state only.
 * shortcut: uses chord 1.6.0 NodeSqliteDatabase's private serial queue (`access`); if a pi-durable upgrade renames it,
 * this throws and copies fail loudly in the log until it is adapted.
 */
export function exclusively<T>(store: OpenedStore, operation: () => Promise<T>): Promise<T> {
	const access = (store.database as unknown as { access?: { runAsync<R>(operation: () => Promise<R>): Promise<R> } }).access;
	if (typeof access?.runAsync !== "function") throw new Error("No serial queue on the store connection");
	return access.runAsync(operation);
}

/** The copy is good when SQLite finds no corruption. */
export function integrityOk(copy: DatabaseSync): void {
	const result = copy.prepare("PRAGMA integrity_check").all().map((row) => String(row.integrity_check));
	if (result.join() !== "ok") throw new Error(`integrity_check: ${result.slice(0, 3).join("; ")}`);
}

/** Every table of the copy has as many rows as in the source (read on the owning connection, nothing in between). */
export function sameRowCounts(raw: DatabaseSync, copy: DatabaseSync): void {
	const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name));
	for (const table of tables) {
		const count = (db: DatabaseSync) => Number(db.prepare(`SELECT count(*) AS n FROM "${table.replaceAll('"', '""')}"`).get()!.n);
		if (count(copy) !== count(raw)) throw new Error(`row count of ${table}: copy ${count(copy)}, source ${count(raw)}`);
	}
}

/**
 * Copy `raw` (the owning connection, no transaction open) to `destination`: online backup into a temporary file, then
 * `check` on the copy, then an atomic rename. A failed backup or check leaves the previous copy in place.
 */
export async function copyStore(
	raw: DatabaseSync,
	destination: string,
	check: (copy: DatabaseSync) => void = (copy) => (integrityOk(copy), sameRowCounts(raw, copy)),
): Promise<void> {
	const directory = dirname(destination);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	chmodSync(directory, 0o700);
	const temporary = `${destination}.${process.pid}.tmp`;
	const removeTemporary = () => {
		for (const file of [temporary, `${temporary}-wal`, `${temporary}-shm`, `${temporary}-journal`]) rmSync(file, { force: true });
	};
	removeTemporary();
	try {
		// All pages in one step (Node refuses -1); the caller holds the connection, so nothing commits in between anyway.
		await backup(raw, temporary, { rate: 0x7fffffff });
		chmodSync(temporary, 0o600);
		const copy = new DatabaseSync(temporary);
		try {
			// One self-contained file: the copy inherits WAL mode, whose -wal/-shm files would sit beside it.
			copy.exec("PRAGMA journal_mode = DELETE");
			check(copy);
		} finally {
			copy.close();
		}
		renameSync(temporary, destination);
	} catch (error) {
		removeTemporary();
		throw error;
	}
}

/**
 * Copy the store every BACKUP_INTERVAL_MS while it changed, and once more when its connection closes (after Durable's
 * last close writes). Change detection: `total_changes()` on the owning connection counts every row Durable inserted,
 * updated or deleted since open; the EXCLUSIVE lock makes that connection the only writer, so an equal count means no
 * commit since the last copy (a rolled-back write only costs an extra copy). The first call always copies. A failure is
 * logged and never reaches the Chat. `copyNow` resolves true when it wrote a copy.
 */
export function startBackups(store: OpenedStore, destination: string, log: (message: string) => void): { copyNow(): Promise<boolean> } {
	let copied: number | undefined;
	let last: Promise<boolean> = Promise.resolve(false);
	const copyNow = () =>
		(last = last.then(() =>
			exclusively(store, async () => {
				const changes = Number(store.raw.prepare("SELECT total_changes() AS n").get()!.n);
				if (changes === copied) return false;
				await copyStore(store.raw, destination);
				copied = changes;
				return true;
			}).catch((error: unknown) => {
				log(`Durable host: chat backup to ${destination} failed: ${error instanceof Error ? error.message : String(error)}`);
				return false;
			}),
		));
	const timer = setInterval(() => void copyNow(), BACKUP_INTERVAL_MS).unref();
	// A first copy at open: a host that crashes within 5 min, or a Chat closed before backups existed, still has one.
	void copyNow();
	// The final copy: Durable closes the database last, after its own close writes.
	const close = store.database.close.bind(store.database);
	store.database.close = async () => {
		clearInterval(timer);
		await copyNow();
		return close();
	};
	return { copyNow };
}
