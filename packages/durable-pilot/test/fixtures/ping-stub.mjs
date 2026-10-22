// Stub ping-a-human MCP server (newline-delimited JSON-RPC on stdio): the tools ping-a-human-pi expects, no Telegram.
// Every tools/call is appended to the log in argv[2] before any reply, so a kill after the call still shows it was sent.
// ask_human questions containing "hold" are never answered (a human who has not replied yet).
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.argv[2];
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const tools = [
	{ name: "notify_human", description: "Send a one-way notification to the human.", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } },
	{ name: "ask_human", description: "Ask the human.", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
];
for await (const line of createInterface({ input: process.stdin })) {
	if (line.trim() === "") continue;
	const message = JSON.parse(line);
	if (message.method === "initialize") reply(message.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "ping-stub", version: "0" } });
	else if (message.method === "tools/list") reply(message.id, { tools });
	else if (message.method === "tools/call") {
		const { name, arguments: args } = message.params;
		appendFileSync(log, `${JSON.stringify({ pid: process.pid, name, args })}\n`);
		if (name === "ask_human" && String(args.question).includes("hold")) continue;
		// A reply carrying a secret-shaped token: what reaches the Chat must be redacted.
		reply(message.id, { content: [{ type: "text", text: name === "ask_human" ? "yes" : `sent (receipt ghp_${"r".repeat(36)})` }] });
	}
}
