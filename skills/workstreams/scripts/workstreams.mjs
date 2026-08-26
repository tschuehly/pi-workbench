#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { stdin, stdout, stderr } from "node:process";
import {
  createUserLocalWorkstreamStore,
  WorkstreamStoreError,
} from "../../../packages/workstream-store/src/index.js";

const usage = `Usage: workstreams.mjs <operation> [input]

Operations: create, associate, append, inspect, list, watch, close
Input:      JSON object, @path/to/request.json, or - for stdin

Examples:
  workstreams.mjs list '{}'
  workstreams.mjs inspect '{"workstreamId":"ws-example"}'
  workstreams.mjs associate '{"workstreamId":"ws-example","expectedRevision":1,"idempotencyKey":"associate-session"}'
  workstreams.mjs create @/tmp/create-workstream.json

associate reads the current session id from PI_SESSION_ID. The tool uses
PI_WORKBENCH_WORKSTREAM_DIR when set and otherwise the user-local Workstream
Store at ~/.pi-workbench/workstreams.
`;

async function main() {
  const [operation, inputArgument] = process.argv.slice(2);
  if (operation === "--help" || operation === "-h") {
    stdout.write(usage);
    return;
  }
  if (!operation || !["create", "associate", "append", "inspect", "list", "watch", "close"].includes(operation)) {
    throw new CliError("Choose one operation: create, associate, append, inspect, list, watch, or close.");
  }

  const input = await parseInput(inputArgument);
  const store = createUserLocalWorkstreamStore({
    ...(process.env.PI_WORKBENCH_WORKSTREAM_DIR === undefined
      ? {}
      : { directory: process.env.PI_WORKBENCH_WORKSTREAM_DIR }),
  });

  let value;
  switch (operation) {
    case "create": value = await store.create(requireObject(input, operation)); break;
    case "associate": value = await store.append(requireAssociation(input)); break;
    case "append": value = await store.append(requireObject(input, operation)); break;
    case "inspect": value = await store.inspect(requireWorkstreamId(input)); break;
    case "list": value = await store.list(input === undefined ? {} : requireObject(input, operation)); break;
    case "watch": value = await store.watch(input === undefined ? {} : requireObject(input, operation)); break;
    case "close": value = await store.close(requireObject(input, operation)); break;
  }
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function parseInput(argument) {
  if (argument === undefined) return undefined;
  let text;
  if (argument === "-") text = await readStream();
  else if (argument.startsWith("@")) text = await readFile(argument.slice(1), "utf8");
  else text = argument;

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`Input is not valid JSON: ${error.message}`);
  }
}

async function readStream() {
  let text = "";
  stdin.setEncoding("utf8");
  for await (const chunk of stdin) text += chunk;
  return text;
}

function requireObject(value, operation) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliError(`${operation} requires a JSON object.`);
  }
  return value;
}

function requireAssociation(input) {
  const value = requireObject(input, "associate");
  const unknown = Object.keys(value).filter((key) => !["workstreamId", "expectedRevision", "idempotencyKey"].includes(key));
  if (unknown.length) throw new CliError(`associate has unknown fields: ${unknown.join(", ")}`);
  const sessionId = process.env.PI_SESSION_ID?.trim();
  if (!sessionId) throw new CliError("associate requires PI_SESSION_ID.");
  return {
    ...value,
    records: [
      { type: "session.pending", producer: "session", sourceSessionId: sessionId, payload: { sessionId, associationKey: sessionId } },
      { type: "session.confirmed", producer: "session", sourceSessionId: sessionId, payload: { sessionId, associationKey: sessionId } },
    ],
  };
}

function requireWorkstreamId(input) {
  const value = requireObject(input, "inspect");
  if (typeof value.workstreamId !== "string") throw new CliError("inspect requires workstreamId.");
  return value.workstreamId;
}

class CliError extends Error {}

main().catch((error) => {
  const response = error instanceof WorkstreamStoreError
    ? { error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } }
    : { error: { code: "CLI_ERROR", message: error instanceof Error ? error.message : String(error) } };
  stderr.write(`${JSON.stringify(response, null, 2)}\n`);
  process.exitCode = 1;
});
