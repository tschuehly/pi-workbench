// Aggregate results/evidence/*.jsonl into results/summary.md and record exact versions in results/versions.json.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = join(import.meta.dirname, "..");
const lock = (file: string) => JSON.parse(readFileSync(join(root, file), "utf8")).packages as Record<string, { version?: string }>;
const pinned = (packages: Record<string, { version?: string }>) =>
	Object.fromEntries(Object.entries(packages).filter(([name]) => /@earendil-works\//.test(name)).map(([name, p]) => [name.replace(/^.*node_modules\//, ""), p.version]));
const db = new DatabaseSync(":memory:");
const versions = {
	node: process.version,
	sqlite: (db.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v,
	pilot: pinned(lock("package-lock.json")),
	legacy: pinned(lock("legacy-1.3/package-lock.json")),
	piClaudeCodeUseRules: "2.2.1 (re-expressed in src/claude.ts)",
	commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim(),
};
writeFileSync(join(root, "results", "versions.json"), `${JSON.stringify(versions, null, 2)}\n`);

const dir = join(root, "results", "evidence");
const rows: string[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
	const lines = readFileSync(join(dir, file), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
	const pass = lines.filter((l) => l.pass).length;
	const sample = lines.find((l) => l.pass) ?? lines[0] ?? {};
	const counts = [
		sample.requests !== undefined ? `requests ${sample.requests}` : "",
		Array.isArray(sample.effects) && sample.effects.length > 0 ? `effects ${sample.effects.length}` : "",
		sample.integrity !== undefined ? `integrity ${Array.isArray(sample.integrity) ? sample.integrity.join("/") : sample.integrity}` : "",
		sample.uncertainAtOpen?.length ? `uncertain task ${sample.uncertainAtOpen.join(",")}` : "",
		sample.reporters?.length ? `reporter ${sample.reporters.map((r: any) => `${r.id}:${r.outcome}`).join(",")}` : "",
		sample.owner !== undefined ? `owner epoch ${sample.owner}` : "",
	].filter(Boolean).join("; ");
	const ms = lines.filter((l) => typeof l.ms === "number").map((l) => l.ms as number);
	rows.push(`| ${file.replace(/\.jsonl$/, "")} | ${pass}/${lines.length} | ${ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : "-"} | ${counts} |`);
}
const summary = [
	"# Crash-matrix evidence summary",
	"",
	`Generated ${new Date().toISOString()} at commit ${versions.commit}; Node ${versions.node}, SQLite ${versions.sqlite}, pi-durable ${versions.pilot["@earendil-works/pi-durable"]}.`,
	"Each row is one fault window and shutdown mode (kill = SIGKILL of the host process, close = graceful Harness close).",
	"Per-iteration evidence is in `evidence/<row>.jsonl`; the sample column is from the first passing iteration.",
	"",
	"| Window / mode | Passed | Mean ms | Sample evidence |",
	"| --- | --- | --- | --- |",
	...rows,
	"",
].join("\n");
writeFileSync(join(root, "results", "summary.md"), summary);
console.log(summary);
