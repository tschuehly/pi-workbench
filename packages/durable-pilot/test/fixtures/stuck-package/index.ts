// Test fixture: `stuck` never settles and ignores its abort signal, as a non-cooperative package tool would; an orderly
// close that joins it cannot end on its own.
export default function (pi: { registerTool(tool: object): void }) {
	pi.registerTool({
		name: "stuck",
		label: "Stuck",
		description: "Never returns, ignoring cancellation.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		execute: () => new Promise(() => {}),
	});
}
