// The store schema this host code writes: every Workbench document and task kind at its version, declared in
// `../store-schema.json`. PI WEB reads that file next to the host's pi-durable to decide whether Upgrade now may
// restart a family onto other host code with a rollback to the old (same Pi Durable version and same schema; see
// pi-web `durableChatService.ts` `restartRefusal`). Definitions go through these wrappers, so a document or task
// added or bumped without updating the file fails as it is defined instead of slipping past that check.
import { readFileSync } from "node:fs";
import { defineDoc as durableDefineDoc, defineTask as durableDefineTask } from "@earendil-works/pi-durable";

const SCHEMA = JSON.parse(readFileSync(new URL("../store-schema.json", import.meta.url), "utf8")) as { documents: Record<string, number>; tasks: Record<string, number> };

function declared(section: "documents" | "tasks", name: string, version: number): void {
	if (SCHEMA[section][name] !== version) throw new Error(`${section === "documents" ? "Document" : "Task"} ${name} version ${String(version)} is not declared in store-schema.json; declare it there`);
}

export const defineDoc = ((definition: { kind: string; version: number }) => {
	declared("documents", definition.kind, definition.version);
	return (durableDefineDoc as (definition: unknown) => unknown)(definition);
}) as typeof durableDefineDoc;

export const defineTask = ((definition: { name: string; version: number }) => {
	declared("tasks", definition.name, definition.version);
	return (durableDefineTask as (definition: unknown) => unknown)(definition);
}) as typeof durableDefineTask;
