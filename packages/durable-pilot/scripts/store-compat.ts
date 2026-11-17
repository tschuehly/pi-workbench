// Store compatibility across a Durable upgrade: a Chat store written by an older build of this host (`--old`, its
// packages/durable-pilot, with its own node_modules) must open, replay and continue under this build with the scripted
// model: transcript intact, a queued follow-up and an unfinished background bash job carried over. Then the rollback
// direction: what the older build does with a store this build last opened (reported, not asserted).
// Usage: node scripts/store-compat.ts --old <old durable-pilot dir> [--out evidence.json]
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BACKGROUND_BASH_STATUS } from "../src/background-bash.ts";
import { ChatHost, family, integrity, logged, type Status, textOf, type Transcript } from "../test/chat-proc.ts";
import { cleanup } from "../test/runner.ts";

const { values } = parseArgs({ options: { old: { type: "string" }, out: { type: "string" } } });
if (values.old === undefined) throw new Error("--old <older durable-pilot dir> is required");
const OLD = join(values.old, "src", "chat-host-main.ts");
const call = (tool: string, args: object) => `call:${tool} ${JSON.stringify(args)}`;
const users = (t: Transcript) => t.messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
const runningJobs = (status: Status) => (JSON.parse(status.extensionStatuses?.[BACKGROUND_BASH_STATUS] ?? '{"jobs":[]}') as { jobs: { id: string }[] }).jobs.map((job) => job.id);
const evidence: Record<string, unknown> = {};

try {
	const { store, cwd } = family("store-compat");
	// 1. The older build: an answer, a background job still running, a long answer cut off by a kill, a queued follow-up.
	const old = new ChatHost(store, cwd, { main: OLD, tps: 40 });
	evidence.oldReady = await old.ready;
	await old.call("prompt", { operationId: "op-hi", text: "hi" });
	await old.idle(1);
	await old.call("prompt", { operationId: "op-bg", text: call("bash", { description: "Carried job", command: "sleep 6; echo carried-output" }) });
	await old.idle(2);
	await old.call("prompt", { operationId: "op-gen", text: "gen" });
	await old.until(() => old.events.filter((e) => e.type === "assistant.delta").map((e) => e.text).join("").includes("word2"), "a committed partial");
	await old.call("prompt", { operationId: "op-follow", text: "queued across the upgrade" });
	const before = await old.call<Transcript>("transcript");
	await old.kill();
	evidence.before = { users: users(before), messages: before.messages.length, queued: before.status.queuedMessages, jobs: runningJobs(before.status) };
	assert.equal(runningJobs(before.status).length, 1, "the background job was running when the older build died");

	// 2. This build opens it: replay, then continue.
	const host = new ChatHost(store, cwd);
	evidence.newReady = await host.ready;
	const replayed = await host.call<Transcript>("transcript");
	evidence.replayed = { users: users(replayed), messages: replayed.messages.length, queued: replayed.status.queuedMessages, jobs: runningJobs(replayed.status), warnings: replayed.status.warnings };
	assert.deepEqual(replayed.messages.slice(0, before.messages.length).map((m) => m.entryId), before.messages.map((m) => m.entryId), "transcript intact");
	assert.deepEqual(users(replayed), ["hi", call("bash", { description: "Carried job", command: "sleep 6; echo carried-output" }), "gen"]);
	assert.deepEqual(replayed.status.queuedMessages.map((q) => q.text), ["queued across the upgrade"], "the queued follow-up carried over");
	assert.deepEqual(runningJobs(replayed.status), runningJobs(before.status), "the unfinished background job carried over, still running");
	await host.call("prompt", { operationId: "op-next", text: "next" });
	await host.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: queued across the upgrade", "the queued follow-up's answer");
	await host.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: next", "the next answer");
	await host.until(() => logged(store).some((l) => l.label.startsWith("Background bash")), "the carried job's completion reaching the model");
	const after = await host.call<Transcript>("transcript");
	const completion = after.messages.find((m) => m.customType === "background-bash");
	assert.match(textOf(completion?.content), /carried-output/, "the carried job's completion delivered");
	evidence.continued = { users: users(after), messages: after.messages.length, completion: textOf(completion?.content).slice(0, 200), requests: logged(store).map((l) => l.label.slice(0, 60)) };
	await host.close();
	evidence.integrityAfterNew = integrity(store);
	assert.equal(evidence.integrityAfterNew, "ok");

	// 3. Rollback: the older build opens the store this build last closed. Reported, not asserted.
	const back = new ChatHost(store, cwd, { main: OLD });
	const outcome = await Promise.race([back.ready.then((ready) => ({ ready })), back.exited.then((code) => ({ exited: code }))]);
	const rollback: Record<string, unknown> = { outcome };
	if ("ready" in outcome) {
		try {
			const t = await back.call<Transcript>("transcript");
			rollback.transcript = { users: users(t), messages: t.messages.length, warnings: t.status.warnings };
			await back.call("prompt", { operationId: "op-rollback", text: "after rollback" });
			await Promise.race([
				back.until((e) => e.type === "message.end" && textOf((e.message as { content?: unknown }).content) === "ok: after rollback", "the rollback answer").then(() => (rollback.answered = true)),
				new Promise((resolve) => setTimeout(resolve, 15_000)).then(() => (rollback.answered = false)),
			]);
			rollback.diagnostics = back.events.filter((e) => e.type === "session.diagnostic").map((e) => e.message);
		} catch (error) {
			rollback.error = error instanceof Error ? error.message : String(error);
		}
		await back.kill();
	}
	rollback.stderr = back.stderr.slice(-2000);
	evidence.rollback = rollback;
	evidence.integrityAfterRollback = integrity(store);
	evidence.result = "pass";
	console.log("store-compat: PASS");
} catch (error) {
	evidence.result = "fail";
	evidence.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
	console.log(`store-compat: FAIL ${String(evidence.error)}`);
	process.exitCode = 1;
} finally {
	if (values.out !== undefined) writeFileSync(values.out, `${JSON.stringify(evidence, null, 2)}\n`);
	cleanup();
	setTimeout(() => process.exit(), 500).unref();
}
