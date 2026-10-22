// Disposable Durable 1.3.0 host for the schema upgrade/rollback test. Modes:
//   start <dir>   — create a store, admit "op-1", hold its model request (barrier "pending"), wait to be killed
//   resume <dir>  — open, resume, wait for "op-1", report status
//   open <dir>    — only open, report success or the error (used against an upgraded copy)
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { readFileSync } from "node:fs";

const [mode, dir] = process.argv.slice(2);
const send = (message) => new Promise((resolve) => process.send(message, resolve));
const version = JSON.parse(readFileSync(new URL("./node_modules/@earendil-works/pi-durable/package.json", import.meta.url), "utf8")).version;

try {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([
		mode === "start"
			? async (_c, options) => {
					await send({ type: "barrier", name: "pending" });
					return new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason)));
				}
			: fauxAssistantMessage([fauxText("answered under 1.3")]),
	]);
	const harness = await Harness.open(await openNodeSqliteStorage(join(dir, "session.sqlite")), { models, registry: createRegistry() }, context);
	const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" } } });
	if (mode === "start") {
		await root.submit({ type: "input", content: "hello from 1.3", requestId: "op-1" }, context);
		await new Promise(() => {});
	}
	if (mode === "open") {
		await harness.close(context);
		await send({ type: "result", evidence: { version, opened: true } });
	} else {
		const record = await root.commit((tx) => tx.submissionByRequest(root.id, "op-1"), context);
		harness.resume();
		const settled = await (await harness.submission(record.id, context)).wait(context);
		await harness.close(context);
		await send({ type: "result", evidence: { version, opened: true, status: settled.status } });
	}
	process.exit(0);
} catch (error) {
	await send({ type: "result", evidence: { version, opened: false, error: String(error?.message ?? error) } });
	process.exit(0);
}
