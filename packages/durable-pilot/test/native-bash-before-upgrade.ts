// Disposable old-native-bash host for the issue #18 upgrade guard. Never loads credentials or installed code.
import { defineExtension } from "@earendil-works/pi-durable";
import { createBashTool } from "@earendil-works/pi-durable/tools";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openHost, context } from "../src/host.ts";
import { router } from "../src/faux.ts";

const [store, cwd] = process.argv.slice(2) as [string, string];
const host = await openHost(store, {
	extensions: [defineExtension({ name: "workbench.native-bash", tools: [createBashTool()] })],
	env: () => new NodeExecutionEnv({ cwd }),
});
const step = router(store);
host.faux.setResponses(Array.from({ length: 100 }, () => step));
await host.resume();
await host.root.submit({ type: "input", content: `call:bash ${JSON.stringify({ command: "echo old >> writes; echo $$ > native.pid; sleep 30" })}`, whenBusy: "followUp" }, context);
