import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./skill-router.mjs", import.meta.url).pathname;
const run = (dir) => execFileSync(process.execPath, [script, dir], { encoding: "utf8" });

function bundle() {
  const dir = mkdtempSync(join(process.env.PI_TMP ?? tmpdir(), "skill-router-"));
  const skill = (name, fm) => {
    mkdirSync(join(dir, "skills", name), { recursive: true });
    writeFileSync(join(dir, "skills", name, "SKILL.md"), `---\n${fm}\n---\n\n# ${name}\n`);
  };
  skill("rechnung", 'name: rechnung\ndescription: "Prüft Rechnungen: Pflichtangaben \\"§14\\" UStG."');
  skill("abmahnung", "name: abmahnung\ndescription: 'Abmahnung erhalten? It''s urgent.'");
  mkdirSync(join(dir, ".claude-plugin"));
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "praxis", description: "Praxis für Solo-Selbstständige." }));
  return dir;
}

test("writes a router SKILL.md and an INDEX.md, idempotently", () => {
  const dir = bundle();
  assert.match(run(dir), /2 skills/);
  const router = readFileSync(join(dir, "SKILL.md"), "utf8");
  assert.match(router, /^---\nname: praxis\ndescription: "Praxis für Solo-Selbstständige\. Load this before answering any such question from memory: it routes to the matching one of 2 specialised skills\."/);
  assert.match(router, /INDEX\.md/);
  const index = readFileSync(join(dir, "INDEX.md"), "utf8");
  assert.ok(index.indexOf("abmahnung") < index.indexOf("rechnung"), "sorted by name");
  assert.match(index, /- `abmahnung` \(skills\/abmahnung\/SKILL\.md\): Abmahnung erhalten\? It's urgent\./);
  assert.match(index, /Pflichtangaben "§14" UStG\./);
  run(dir);
  assert.equal(readFileSync(join(dir, "SKILL.md"), "utf8"), router, "rerun gives the same router");
});

test("refuses to overwrite a root SKILL.md it did not write", () => {
  const dir = bundle();
  writeFileSync(join(dir, "SKILL.md"), "---\nname: own\ndescription: mine\n---\n");
  assert.throws(() => execFileSync(process.execPath, [script, dir], { stdio: "pipe" }), /not written by skill-router/);
});
