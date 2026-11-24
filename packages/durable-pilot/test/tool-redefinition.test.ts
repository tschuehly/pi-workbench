import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// planSystemEntries is internal to pi-durable; patches/@earendil-works__pi-durable@1.6.0.patch changes it.
const dist = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-durable")));
const { planSystemEntries } = await import(pathToFileURL(join(dist, "harness/prompt.js")).href);

test("a changed tool description is redefined in place, not by re-adding every tool (keeps the prompt cache)", () => {
	const tool = (name: string, description = name) => ({ name, description, parameters: { type: "object", properties: {} } });
	const offered = [tool("a"), tool("b"), tool("c")];
	const view = { entries: [], messages: [{ role: "system", content: "", toolsAdded: offered, timestamp: 0 }] };
	const entries = planSystemEntries(view, new Map(), [tool("a"), tool("b", "changed"), tool("c")], 1);
	const changes = JSON.stringify(entries);
	assert.doesNotMatch(changes, /"toolsRemoved":\[\{/, changes);
	assert.equal((changes.match(/"name":"/g) ?? []).length, 1, changes);
	assert.match(changes, /"description":"changed"/);
});
