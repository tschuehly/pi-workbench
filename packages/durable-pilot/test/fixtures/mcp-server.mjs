// Local MCP fixture server (stdio, newline-delimited JSON-RPC) for the Durable Chat MCP tests. Tools:
// - lookup {query}: read-only; `query: "secret"` answers with $MCP_FIXTURE_TOKEN (a redaction positive control);
// - deploy {target}: an external effect, one line per call in $MCP_FIXTURE_EFFECTS; `target: "slow"` then waits;
// - broken: an invalid input schema (not an object schema), which the host must refuse to register.
// Every call is appended to $MCP_FIXTURE_LOG.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const log = (line) => process.env.MCP_FIXTURE_LOG && appendFileSync(process.env.MCP_FIXTURE_LOG, `${JSON.stringify(line)}\n`);
const text = (value) => ({ content: [{ type: "text", text: value }] });

const tools = [
	{ name: "lookup", description: "Look a term up (read-only).", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
	{ name: "deploy", description: "Deploy to a target (changes the world).", inputSchema: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } },
	{ name: "broken", description: "A tool whose schema is not an object schema.", inputSchema: { type: "string" } },
];

createInterface({ input: process.stdin }).on("line", async (line) => {
	const message = JSON.parse(line);
	if (message.id === undefined) return; // notifications
	if (message.method === "initialize")
		return send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" }, instructions: "Fixture server for Durable Chat tests." } });
	if (message.method === "tools/list") return send({ id: message.id, result: { tools } });
	if (message.method === "ping") return send({ id: message.id, result: {} });
	if (message.method === "tools/call") {
		const { name, arguments: args = {} } = message.params;
		log({ name, args });
		if (name === "lookup") return send({ id: message.id, result: text(args.query === "secret" ? `the token is ${process.env.MCP_FIXTURE_TOKEN}` : `found ${args.query}`) });
		if (name === "deploy") {
			appendFileSync(process.env.MCP_FIXTURE_EFFECTS, `deploy ${args.target}\n`);
			if (args.target === "slow") await new Promise((resolve) => setTimeout(resolve, 30_000));
			return send({ id: message.id, result: text(`deployed ${args.target}`) });
		}
		return send({ id: message.id, result: { ...text(`unknown tool ${name}`), isError: true } });
	}
	send({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
});
