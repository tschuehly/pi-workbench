import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const data = JSON.parse(fs.readFileSync(path.join(dir, "dashboard-data.json"), "utf8"));
const store = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pi-workbench/workstreams/workstreams.json"), "utf8"));
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const rawCheckpoints = Object.values(store.workstreams).flatMap(({ ledger }) => ledger.filter(({ type }) => type === "checkpoint.replaced"));

if (data.items.length !== Object.keys(store.workstreams).length) throw new Error("Workstream count differs from Store");
if (data.items.flatMap(({ checkpoints }) => checkpoints).length !== rawCheckpoints.length) throw new Error("Checkpoint count differs from Store");
if (data.items.some(({ group, status, explainer, reason }) => !group || !status || !explainer || !reason)) throw new Error("Dashboard metadata is incomplete");
if (html.includes("__WORKSTREAM_DATA__")) throw new Error("Dashboard data placeholder was not replaced");
if (!data.items.every(({ id, checkpoints }) => checkpoints.every(({ id: checkpointId }) => rawCheckpoints.some(({ workstreamId, payload }) => workstreamId === id && payload.checkpoint.id === checkpointId)))) throw new Error("Dashboard contains an unknown checkpoint");

const closedSuperseded = data.items.filter(({ status }) => status === "superseded");
if (closedSuperseded.length !== 6 || closedSuperseded.some(({ lifecycle }) => lifecycle !== "closed")) throw new Error("The six superseded Workstreams are not all closed");
console.log(`PASS: ${data.items.length} Workstreams, ${rawCheckpoints.length} checkpoints, ${closedSuperseded.length} superseded Workstreams closed`);
