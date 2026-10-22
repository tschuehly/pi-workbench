// One pilot host process. The test runner starts it for a scenario phase:
//   crash  — open, start work, report barriers; then either SIGKILL (from the runner) or a graceful close request.
//   verify — reopen paused, resume explicitly, report evidence.
// Barriers are explicit messages sent after the relevant state is committed; nothing waits on timing.
import { setHold } from "../src/pilot.ts";
import { type Io, scenarios } from "./scenarios.ts";

const [name, phase, dir, json] = process.argv.slice(2) as [string, "crash" | "verify", string, string | undefined];
const options = JSON.parse(json ?? "{}") as Record<string, unknown> & { armed?: string[] };
const armed = new Set<string>(options.armed ?? []);
const send = (message: object) => new Promise<void>((resolve) => process.send!(message, () => resolve()));

let requestClose!: () => void;
const closing = new Promise<void>((resolve) => (requestClose = resolve));
process.on("message", (message: { type?: string }) => {
	if (message.type === "close") requestClose();
});

setHold(async (barrier, signal) => {
	if (!armed.delete(barrier)) return;
	await send({ type: "barrier", name: barrier });
	// Hold until the invocation is cancelled (graceful close); a kill ends the process here.
	await new Promise<never>((_, reject) => {
		if (signal === undefined) return;
		if (signal.aborted) reject(signal.reason);
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
});

const io: Io = { armed, closing, barrier: (barrier, data) => send({ type: "barrier", name: barrier, data }) };
const scenario = scenarios[name];
try {
	if (scenario === undefined) throw new Error(`Unknown scenario ${name}`);
	if (phase === "crash") {
		const host = await scenario.crash(dir, options, io);
		await closing;
		try {
			await host.close();
		} catch (error) {
			await send({ type: "close-error", message: String(error) });
		}
		await send({ type: "closed" });
	} else {
		const evidence = await scenario.verify(dir, options, io);
		await send({ type: "result", evidence });
	}
	process.exit(0);
} catch (error) {
	await send({ type: "error", message: error instanceof Error ? (error.stack ?? error.message) : String(error) });
	process.exit(1);
}
