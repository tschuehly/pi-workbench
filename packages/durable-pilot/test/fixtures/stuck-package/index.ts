// Test fixture: `stuck` never settles and ignores its abort signal, as a non-cooperative package tool would; an orderly
// close that joins it cannot end on its own. With STUCK_SHUTDOWN=1 its session_shutdown handler never settles either,
// so a host's close hangs with no tool running.
export default function (pi: { registerTool(tool: object): void; on(event: string, handler: () => Promise<void>): void }) {
	if (process.env.STUCK_SHUTDOWN === "1") pi.on("session_shutdown", () => new Promise(() => {}));
	pi.registerTool({
		name: "stuck",
		label: "Stuck",
		description: "Never returns, ignoring cancellation.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		execute: () => new Promise(() => {}),
	});
}
