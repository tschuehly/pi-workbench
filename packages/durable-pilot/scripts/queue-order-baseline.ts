// No-crash baseline for the queue.order window: the same admissions in one process, nothing interrupted.
// Prints the placement order the crash runs must reproduce.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { admit, context } from "../src/host.ts";
import { setHold } from "../src/pilot.ts";
import { pilotHost, transcript } from "../test/scenarios.ts";

const dir = mkdtempSync(join(process.env.PI_TMP ?? join(import.meta.dirname, "..", ".runs"), "dp-baseline-"));
let release!: () => void;
const released = new Promise<void>((resolve) => (release = resolve));
let running!: () => void;
const isRunning = new Promise<void>((resolve) => (running = resolve));
setHold(async (name) => {
	if (name !== "tool:wait_tool") return;
	running();
	await released;
});
const host = await pilotHost(dir);
await admit(host.root, { operationId: "op-0", text: "call:wait_tool" });
await isRunning;
await admit(host.root, { operationId: "op-s1", text: "steer-1", mode: "steer" });
await admit(host.root, { operationId: "op-f1", text: "follow-1" });
await admit(host.root, { operationId: "op-s2", text: "steer-2", mode: "steer" });
await admit(host.root, { operationId: "op-f2", text: "follow-2" });
const withdrawn = await admit(host.root, { operationId: "op-f3", text: "follow-3" });
await host.harness.abortSubmission(withdrawn, context);
release();
await host.harness.waitForIdle(context);
await host.root.waitForIdle(context);
console.log(JSON.stringify((await transcript(host)).users));
await host.close();
rmSync(dir, { recursive: true, force: true });
