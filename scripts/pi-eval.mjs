#!/usr/bin/env node
// Model evaluation runner. See docs/plans/model-orchestration-redesign.md ("Evaluation") and evals/README.md.
// Usage:
//   node scripts/pi-eval.mjs run <campaign.json> [--dry-run] [--only <caseId>] [--keep]
//   node scripts/pi-eval.mjs report <results.jsonl>
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESOLVER = path.join(ROOT, "skills/model-orchestration/scripts/resolve-runtime-binding.mjs");
const EVAL_HOME = process.env.PI_EVAL_HOME ?? path.join(homedir(), ".pi-workbench/evals");
const TOOLS = "read,bash,edit,write,grep,find,ls";
// Eval arms still pass the routing gate (catalog, effort, quota). Arms set an explicit model, which the
// resolver refuses for independence roles; independence is not in play because humans authored the
// reviewed bytes, so review cases resolve admission under a non-independent role.
const ADMISSION_ROLE = { routine: "routine", implementation: "implementation", frontier: "frontier", review: "implementation", "independent-review": "implementation", judge: "implementation" };

const sh = (cmd, opts = {}) => spawnSync("bash", ["-c", cmd], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
// Gradle reuses daemons across invocations. A daemon started inside one trial's sandbox can read only that
// trial, so reuse by a later trial or by the unsandboxed check breaks builds and could leak state. Give the
// candidate and the check separate per-trial registries with a short idle timeout.
// PI_EVAL_MAX_FORKS is read by ~/.gradle/init.d/pi-eval-max-forks.gradle, which caps Test.maxParallelForks so
// a trial does not start four test JVMs plus Chrome next to other sessions' builds.
const MAX_FORKS = process.env.PI_EVAL_MAX_FORKS ?? "2";
const gradleEnv = (dir) => ({ PI_EVAL_MAX_FORKS: MAX_FORKS, GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ""} -Dorg.gradle.daemon.registry.base=${dir} -Dorg.gradle.daemon.idletimeout=120000`.trim() });
// Stop every daemon a trial registered, with or without its workspace: `gradlew --stop` first, then SIGTERM
// any daemon that is still alive, identified by the daemon-<pid>.out.log files in the trial's own registry.
function stopGradle(trialDir, workspaces) {
  for (const d of ["gradle-agent", "gradle-check"].map((n) => path.join(trialDir, n)).filter(existsSync)) {
    const ws = workspaces.find((w) => existsSync(path.join(w, "gradlew")));
    if (ws) sh("./gradlew --stop -q", { cwd: ws, env: { ...process.env, ...gradleEnv(d) }, timeout: 120_000 });
    const pids = sh(`find ${JSON.stringify(d)} -name 'daemon-*.out.log'`).stdout.split("\n").map((f) => f.match(/daemon-(\d+)\.out\.log$/)?.[1]).filter(Boolean);
    for (const pid of pids) if (/GradleDaemon/.test(sh(`ps -o command= -p ${pid}`).stdout)) try { process.kill(Number(pid), "SIGTERM"); } catch {}
  }
}
// Long campaigns yield to CI gates run by other sessions.
async function waitForGates() {
  let announced = false;
  while (sh("pgrep -f 'gate\\.sh'").stdout.trim()) {
    if (!announced) { process.stdout.write("(waiting for gate.sh to finish) "); announced = true; }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function profileInstruction(name) {
  if (!name) return "";
  const src = readFileSync(path.join(ROOT, "extensions/subagent/index.ts"), "utf8");
  const m = src.match(new RegExp(`\\n  ${name}: \\{[\\s\\S]*?instruction: "((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) throw new Error(`Unknown profile ${name}`);
  return JSON.parse(`"${m[1]}"`);
}

function repoPath(name) {
  return process.env[`PI_EVAL_REPO_${name.toUpperCase()}`] ?? path.resolve(ROOT, "..", name);
}

function quota() {
  const r = sh("quota-axi --json", { timeout: 30_000 });
  try {
    return JSON.parse(r.stdout).providers
      .filter((p) => ["claude", "codex", "copilot"].includes(p.provider))
      .map((p) => ({ provider: p.provider, state: p.state?.status, windows: (p.windows ?? []).map((w) => ({ id: w.id, percentRemaining: w.percentRemaining, resetsAt: w.resetsAt })) }));
  } catch { return null; }
}

// Built once per campaign: extension discovery can push \`pi --list-models\` past the resolver's deadline.
let catalogFile;
function admit(role, model, effort) {
  const r = spawnSync("node", [RESOLVER, ADMISSION_ROLE[role] ?? role, "--model", model, "--effort", effort, "--catalog", catalogFile], { encoding: "utf8", timeout: 60_000 });
  try { return { ok: true, binding: JSON.parse(r.stdout).modelBinding }; } catch { return { ok: false, reason: (r.stdout + r.stderr).match(/REASON=(.*)/)?.[1] ?? r.stdout.slice(0, 300) }; }
}

// Fresh snapshot without history, so the future fix is never discoverable through git.
function prepareWorkspace(c, dir) {
  mkdirSync(dir, { recursive: true });
  if (c.workspace !== "empty") {
    const paths = (c.paths ?? []).map((p) => JSON.stringify(p)).join(" ");
    const r = sh(`git -C ${JSON.stringify(repoPath(c.repo))} archive ${c.commit} ${paths} | tar -x -C ${JSON.stringify(dir)}`);
    if (r.status !== 0) throw new Error(`snapshot failed: ${r.stderr}`);
  }
  const env = { ...process.env, CASE_DIR: c.dir, SOURCE_REPO: c.repo ? repoPath(c.repo) : "" };
  if (c.setup) {
    const r = sh(`bash ${JSON.stringify(path.join(c.dir, c.setup))}`, { cwd: dir, env });
    if (r.status !== 0) throw new Error(`setup failed: ${r.stdout}${r.stderr}`);
  }
  // Setup may build its own history (a review case commits the change under review).
  if (!existsSync(path.join(dir, ".git"))) sh(`git init -q && git add -A && git -c user.name=eval -c user.email=eval@local commit -qm snapshot --allow-empty`, { cwd: dir });
}

// A candidate has shell access, so it could read the source repository, the case checks, earlier trials,
// or session logs that discuss the answers. macOS sandbox-exec denies those reads; later rules win, so
// the trial directory and the installed harness checkouts stay readable.
function sandboxProfile(trialDir) {
  const real = (p) => (existsSync(p) ? realpathSync(p) : p);
  const home = homedir();
  const projects = real(path.resolve(ROOT, ".."));
  const deny = [projects, real(EVAL_HOME), real(path.join(home, ".pi/agent/sessions")), real(path.join(home, ".pi-web"))];
  const allow = [...readdirSync(projects).filter((d) => d.endsWith(".installed")).map((d) => path.join(projects, d)), real(trialDir)];
  const rule = (verb, p) => `(${verb} file-read-data (subpath ${JSON.stringify(p)}))`;
  return `(version 1)(allow default)${deny.map((p) => rule("deny", p)).join("")}${allow.map((p) => rule("allow", p)).join("")}`;
}

function runPi({ model, effort, prompt, cwd, sessionDir, timeoutMs, trialDir, tools = TOOLS }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = ["-p", "--mode", "json", "--model", model, "--thinking", effort, "--session-dir", sessionDir, tools ? "--tools" : "--no-tools", ...(tools ? [tools] : []), prompt];
    const env = { ...process.env, ...gradleEnv(path.join(trialDir, "gradle-agent")) };
    delete env.PI_WORKBENCH_ROUTING_OVERLAY;
    const child = spawn("sandbox-exec", ["-p", sandboxProfile(trialDir), "pi", ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let out = "", err = "", timedOut = false;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGTERM"); } catch {} }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const events = out.split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
      const turns = events.filter((e) => e.type === "turn_end").length;
      const messages = events.findLast((e) => e.type === "agent_end")?.messages
        ?? events.filter((e) => e.type === "message_end").map((e) => e.message);
      const assistant = messages.filter((m) => m.role === "assistant");
      const sum = (k) => assistant.reduce((a, m) => a + (m.usage?.[k] ?? 0), 0);
      const last = assistant.at(-1);
      resolve({
        exitCode: code, timedOut, elapsedMs: Date.now() - started, turns,
        toolCalls: assistant.reduce((a, m) => a + (m.content ?? []).filter((c) => c.type === "toolCall").length, 0),
        usage: { input: sum("input"), output: sum("output"), cacheRead: sum("cacheRead"), cacheWrite: sum("cacheWrite"), reasoning: sum("reasoning"), cost: assistant.reduce((a, m) => a + (m.usage?.cost?.total ?? 0), 0) },
        stopReason: last?.stopReason, error: last?.errorMessage ?? (code !== 0 ? err.slice(-500) : undefined),
        finalText: (last?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n"),
      });
    });
  });
}

function buildPrompt(c, extra = "") {
  return [profileInstruction(c.profile), c.prompt, "All material for this task is in the current working directory.", extra].filter(Boolean).join("\n\n");
}

async function runArm(c, arm, trialDir) {
  const timeoutMs = (c.timeoutMinutes ?? 30) * 60_000;
  const members = arm.panel ?? [arm];
  const runs = [];
  for (const [i, m] of members.entries()) {
    const ws = path.join(trialDir, arm.panel ? `ws-member-${i}` : "ws");
    prepareWorkspace(c, ws);
    runs.push({ model: m.model, effort: m.effort, ws, ...(await runPi({ model: m.model, effort: m.effort, prompt: buildPrompt(c), cwd: ws, sessionDir: path.join(trialDir, `session-${i}`), timeoutMs, trialDir })) });
  }
  if (!arm.panel) return { ws: runs[0].ws, runs };
  const ws = path.join(trialDir, "ws");
  prepareWorkspace(c, ws);
  const answers = runs.map((r, i) => {
    const file = path.join(r.ws, c.answerFile ?? "answer.json");
    return `### Answer ${String.fromCharCode(65 + i)}\n${r.finalText}\n${existsSync(file) ? `\nIts ${c.answerFile ?? "answer.json"}:\n${readFileSync(file, "utf8")}` : ""}`;
  }).join("\n\n");
  const combine = `Independent colleagues answered the task below. Their answers may disagree or be wrong. Verify disputed points against the workspace, then produce the single best final answer yourself, in the required output format.\n\n${answers}`;
  runs.push({ model: arm.combiner.model, effort: arm.combiner.effort, combiner: true, ws, ...(await runPi({ model: arm.combiner.model, effort: arm.combiner.effort, prompt: buildPrompt(c, combine), cwd: ws, sessionDir: path.join(trialDir, "session-combiner"), timeoutMs, trialDir })) });
  return { ws, runs };
}

async function check(c, ws, finalText, trialDir, judges) {
  writeFileSync(path.join(trialDir, "final.txt"), finalText ?? "");
  if (c.check.type === "script") {
    const r = sh(`bash ${JSON.stringify(path.join(c.dir, c.check.script))}`, { cwd: ws, timeout: (c.check.timeoutMinutes ?? 20) * 60_000, env: { ...process.env, ...gradleEnv(path.join(trialDir, "gradle-check")), CASE_DIR: c.dir, FINAL_TEXT: path.join(trialDir, "final.txt"), SOURCE_REPO: c.repo ? repoPath(c.repo) : "" } });
    writeFileSync(path.join(trialDir, "check.log"), `${r.stdout}\n${r.stderr}`);
    return { pass: r.status === 0, detail: r.stdout.trim().split("\n").slice(-3).join(" | ") };
  }
  // Blinded judges: they see the task, the reference outcome, the rubric, and the answer — never the model.
  const answerFile = path.join(ws, c.answerFile ?? "answer.md");
  const answer = existsSync(answerFile) ? readFileSync(answerFile, "utf8") : finalText;
  // A reference script keeps private reference material out of the case definition.
  const reference = c.check.referenceScript
    ? sh(`bash ${JSON.stringify(path.join(c.dir, c.check.referenceScript))}`, { env: { ...process.env, SOURCE_REPO: repoPath(c.repo) } }).stdout
    : readFileSync(path.join(c.dir, c.check.reference), "utf8");
  if (!reference.trim()) throw new Error("empty judge reference");
  const prompt = `You are grading one anonymous answer to a task. Score it 0-10 against the rubric, using the reference as what actually happened. Reply with only JSON: {"score": <0-10>, "reason": "<two sentences>"}.\n\n## Task\n${c.prompt}\n\n## Reference\n${reference}\n\n## Rubric\n${c.check.rubric}\n\n## Answer\n${answer}`;
  const scores = [];
  for (const j of judges) {
    const adm = admit("judge", j.model, j.effort);
    if (!adm.ok) { scores.push({ model: j.model, blocked: adm.reason }); continue; }
    const r = await runPi({ model: j.model, effort: j.effort, prompt, cwd: trialDir, sessionDir: path.join(trialDir, `judge-${j.model.replace(/\W/g, "_")}`), timeoutMs: 10 * 60_000, trialDir, tools: null });
    const parsed = (() => { try { return JSON.parse(r.finalText.match(/\{[\s\S]*\}/)[0]); } catch { return null; } })();
    scores.push({ model: j.model, score: parsed?.score ?? null, reason: parsed?.reason ?? r.error ?? r.finalText.slice(0, 300) });
  }
  const valid = scores.filter((s) => typeof s.score === "number").map((s) => s.score);
  const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  return { pass: mean != null && mean >= (c.check.passScore ?? 6), score: mean, judges: scores, disagreement: valid.length > 1 && Math.max(...valid) - Math.min(...valid) >= 3 };
}

async function run(campaignPath, flags) {
  const campaign = JSON.parse(readFileSync(campaignPath, "utf8"));
  const casesRoot = path.resolve(path.dirname(campaignPath), "..", "cases");
  const runId = `${campaign.id}-${stamp()}`;
  const outDir = path.join(EVAL_HOME, "results", runId);
  const results = path.join(outDir, "results.jsonl");
  const harness = sh("git rev-parse HEAD", { cwd: ROOT }).stdout.trim();
  const plan = [];
  let group = 0;
  for (const entry of campaign.cases) {
    if (flags.only && entry.case !== flags.only) continue;
    const dir = path.join(casesRoot, entry.case);
    const c = { ...JSON.parse(readFileSync(path.join(dir, "case.json"), "utf8")), dir };
    // Alternate which arm goes first per case and repetition, so no arm always runs on a fresher
    // machine, cache, or quota window.
    for (let rep = 0; rep < (campaign.repetitions ?? 1); rep++) {
      const order = group++ % 2 === 0 ? entry.arms : [...entry.arms].reverse();
      for (const armId of order) plan.push({ c, arm: { id: armId, ...campaign.arms[armId] }, rep });
    }
  }
  console.log(`${plan.length} trials → ${results}`);
  if (flags.dryRun) { for (const t of plan) console.log(`  ${t.c.id} × ${t.arm.id} #${t.rep}`); return; }
  mkdirSync(outDir, { recursive: true });
  catalogFile = path.join(outDir, "catalog.txt");
  writeFileSync(catalogFile, sh("pi --no-extensions --list-models", { timeout: 120_000 }).stdout);
  writeFileSync(path.join(outDir, "campaign.json"), JSON.stringify({ ...campaign, harness }, null, 2));
  for (const [i, { c, arm, rep }] of plan.entries()) {
    // The trial path is the model's working directory, so it must not name the case or arm.
    const trialDir = path.join(outDir, `t${String(i).padStart(3, "0")}`);
    mkdirSync(trialDir, { recursive: true });
    const record = { runId, trial: i, trialDir: path.basename(trialDir), case: c.id, role: c.role, arm: arm.id, rep, harness, caseCommit: c.commit ?? null, startedAt: new Date().toISOString() };
    const members = [...(arm.panel ?? [arm]), ...(arm.combiner ? [arm.combiner] : [])];
    const admissions = members.map((m) => admit(c.role, m.model, m.effort));
    record.bindings = admissions.map((a, k) => a.binding ?? { model: members[k].model, effort: members[k].effort, blocked: a.reason });
    process.stdout.write(`[${i + 1}/${plan.length}] ${c.id} × ${arm.id} … `);
    if (admissions.some((a) => !a.ok)) {
      Object.assign(record, { status: "blocked", reason: admissions.find((a) => !a.ok).reason });
    } else {
      await waitForGates();
      record.quotaBefore = quota();
      const workspaces = [];
      try {
        const { ws, runs } = await runArm(c, arm, trialDir);
        workspaces.push(ws, ...runs.map((x) => x.ws));
        const last = runs.at(-1);
        record.runs = runs.map(({ ws: _w, finalText: _f, ...r }) => r);
        record.elapsedMs = runs.reduce((a, r) => a + r.elapsedMs, 0);
        record.cost = runs.reduce((a, r) => a + r.usage.cost, 0);
        // Diff against the snapshot root commit, so work the model committed is captured too.
        writeFileSync(path.join(trialDir, "diff.patch"), sh("git add -A && git diff --cached $(git rev-list --max-parents=0 HEAD | tail -1)", { cwd: ws }).stdout);
        sh("git reset -q", { cwd: ws });
        record.check = await check(c, ws, last.finalText, trialDir, campaign.judges ?? []);
        record.status = runs.some((r) => r.timedOut) ? "timeout" : runs.some((r) => r.error) ? "error" : "done";
      } catch (error) {
        Object.assign(record, { status: "harness-error", reason: String(error?.message ?? error).slice(0, 1000) });
      } finally {
        stopGradle(trialDir, workspaces);
        if (!flags.keep) for (const r of new Set(workspaces)) rmSync(r, { recursive: true, force: true });
      }
      record.quotaAfter = quota();
    }
    record.endedAt = new Date().toISOString();
    appendFileSync(results, JSON.stringify(record) + "\n");
    console.log(`${record.status}${record.check ? ` pass=${record.check.pass}` : ""}${record.reason ? ` (${record.reason})` : ""}`);
  }
  report(results);
}

function report(file) {
  const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const fmt = (ms) => (ms == null ? "-" : `${(ms / 60000).toFixed(1)}m`);
  console.log("\n| case | arm | status | pass | score | time | turns | tools | out tok | cost $ |\n|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const runs = r.runs ?? [];
    const sum = (f) => runs.reduce((a, x) => a + f(x), 0);
    console.log(`| ${r.case} | ${r.arm} | ${r.status}${r.reason ? `: ${r.reason.slice(0, 60)}` : ""} | ${r.check?.pass ?? "-"} | ${r.check?.score ?? "-"}${r.check?.disagreement ? " ⚠" : ""} | ${fmt(r.elapsedMs)} | ${runs.length ? sum((x) => x.turns) : "-"} | ${runs.length ? sum((x) => x.toolCalls) : "-"} | ${runs.length ? sum((x) => x.usage.output) : "-"} | ${r.cost?.toFixed(2) ?? "-"} |`);
  }
}

const [cmd, target, ...rest] = process.argv.slice(2);
const flags = { dryRun: rest.includes("--dry-run"), keep: rest.includes("--keep"), only: rest.includes("--only") ? rest[rest.indexOf("--only") + 1] : null };
if (cmd === "run" && target) await run(path.resolve(target), flags);
else if (cmd === "report" && target) report(target);
else { console.error("usage: pi-eval.mjs run <campaign.json> [--dry-run] [--only <case>] [--keep] | report <results.jsonl>"); process.exit(2); }
