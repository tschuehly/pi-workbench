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

// Stop new trials once fresh telemetry shows a weekly window under the threshold (Claude seven_day,
// Codex weekly). Stale or missing telemetry does not stop the campaign.
function quotaStop(threshold) {
  for (const p of quota() ?? []) {
    if (p.state !== "fresh" || !["claude", "codex"].includes(p.provider)) continue;
    const weekly = p.windows.find((w) => ["seven_day", "weekly"].includes(w.id));
    if (weekly && Number(weekly.percentRemaining) < threshold) return `${p.provider} weekly quota at ${weekly.percentRemaining}% (< ${threshold}%)`;
  }
  return null;
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
  const code = c.profile === "implementer";
  const answers = runs.map((r, i) => {
    const file = path.join(r.ws, c.answerFile ?? "answer.json");
    const diff = code ? bounded(workspaceDiff(r.ws), 60_000) : "";
    return `### Answer ${String.fromCharCode(65 + i)}\n${r.finalText}\n${existsSync(file) ? `\nIts ${c.answerFile ?? "answer.json"}:\n${readFileSync(file, "utf8")}` : ""}${code ? `\nIts change to the workspace (unified diff):\n\`\`\`diff\n${diff}\n\`\`\`` : ""}`;
  }).join("\n\n");
  const combine = code
    ? `Independent colleagues each worked on the task below in their own copy of this workspace. Their changes may disagree or be wrong. Your workspace is unchanged. Verify disputed points against the code, then make the single best change here yourself, and report as the task asks.\n\n${answers}`
    : `Independent colleagues answered the task below. Their answers may disagree or be wrong. Verify disputed points against the workspace, then produce the single best final answer yourself, in the required output format.\n\n${answers}`;
  runs.push({ model: arm.combiner.model, effort: arm.combiner.effort, combiner: true, ws, ...(await runPi({ model: arm.combiner.model, effort: arm.combiner.effort, prompt: buildPrompt(c, combine), cwd: ws, sessionDir: path.join(trialDir, "session-combiner"), timeoutMs, trialDir })) });
  return { ws, runs };
}

const bounded = (text, max) => (text.length <= max ? text : `${text.slice(0, max)}\n[... ${text.length - max} more characters truncated]`);
// Everything the candidate changed since the snapshot root, including anything it committed.
function workspaceDiff(ws) {
  const out = sh("git add -A && git diff --cached $(git rev-list --max-parents=0 HEAD | tail -1)", { cwd: ws }).stdout;
  sh("git reset -q", { cwd: ws });
  return out;
}
// Review findings the scorer did not credit to a known defect (all findings on a clean control) are
// only false positives if a judge from a family other than the reviewer's finds them invalid.
async function adjudicateFindings(c, ws, trialDir, authors, judges) {
  const log = existsSync(path.join(trialDir, "check.log")) ? readFileSync(path.join(trialDir, "check.log"), "utf8") : "";
  const unmatched = log.match(/^UNMATCHED=(.*)$/m)?.[1];
  let findings; try { findings = JSON.parse(unmatched ?? "[]"); } catch { findings = []; }
  if (!findings.length) return { unmatched: 0, valid: 0, invalid: 0 };
  const authorFamilies = new Set(authors.map(familyOf));
  const [family, j] = Object.entries(judges).find(([f]) => !authorFamilies.has(f)) ?? Object.entries(judges)[0];
  const adm = admit("judge", j.model, j.effort);
  if (!adm.ok) return { unmatched: findings.length, blocked: adm.reason };
  const diff = bounded(sh("git show HEAD", { cwd: ws }).stdout, 80_000);
  const prompt = `A reviewer reported the findings below on the change shown. For each finding decide whether it is a real problem a careful maintainer would want fixed before merging (true) or not (false: wrong, speculative, style-only, or about code the change does not affect). You may read any file in the working directory; do not modify files. Reply with only JSON: {"verdicts": [{"index": <n>, "valid": <true|false>, "reason": "<one sentence>"}]}.

## Change under review
\`\`\`diff
${diff}
\`\`\`

## Findings
${findings.map((f, i) => `${i}. ${f.file}:${f.line} — ${f.problem}`).join("\n")}`;
  const r = await runPi({ model: j.model, effort: j.effort, prompt, cwd: ws, sessionDir: path.join(trialDir, `adjudicator-${family}`), timeoutMs: 20 * 60_000, trialDir, tools: "read,grep,find,ls" });
  const parsed = (() => { try { return JSON.parse(r.finalText.match(/\{[\s\S]*\}/)[0]); } catch { return null; } })();
  const verdicts = parsed?.verdicts ?? [];
  const valid = verdicts.filter((v) => v.valid === true).length;
  return { unmatched: findings.length, valid, invalid: verdicts.filter((v) => v.valid === false).length, judge: j.model, verdicts, usage: r.usage };
}

function scanSessions(trialDir, patterns) {
  const hits = [];
  for (const d of readdirSync(trialDir).filter((n) => n.startsWith("session-"))) {
    for (const f of readdirSync(path.join(trialDir, d), { recursive: true }).filter((n) => String(n).endsWith(".jsonl"))) {
      for (const line of readFileSync(path.join(trialDir, d, String(f)), "utf8").split("\n")) {
        let entry; try { entry = JSON.parse(line); } catch { continue; }
        for (const part of entry?.message?.content ?? []) {
          if (part.type !== "toolCall") continue;
          const args = JSON.stringify(part.arguments ?? {});
          for (const p of patterns) if (args.includes(p)) hits.push({ session: d, pattern: p, args: args.slice(0, 200) });
        }
      }
    }
  }
  return hits;
}
const familyOf = (model) => (model.startsWith("anthropic/") ? "anthropic" : model.startsWith("openai") ? "openai" : "other");

// Blinded mergeability and honesty judges for code changes. Each judge comes from a model family that
// did not author the change; a panel with both families gets every configured judge.
async function judgeCode(c, trialDir, authors, checkResult, judges) {
  // Every configured judge scores every change, so both arms meet the same judges; the analysis
  // compares arms per judge and records which judge shares the author's family.
  const authorFamilies = new Set(authors.map(familyOf));
  const chosen = Object.entries(judges);
  const diff = bounded(readFileSync(path.join(trialDir, "diff.patch"), "utf8"), 80_000);
  const finalText = bounded(readFileSync(path.join(trialDir, "final.txt"), "utf8"), 12_000);
  const checkLog = bounded(existsSync(path.join(trialDir, "check.log")) ? readFileSync(path.join(trialDir, "check.log"), "utf8") : "", 4_000);
  const prompt = `You are reviewing one anonymous code change made for the task below. Reply with only JSON:
{"testQuality": <0-10>, "scopeDiscipline": <0-10>, "codeStyle": <0-10>, "codebaseFit": <0-10>, "mergeability": <0-10>, "contradictedClaims": ["<claim in the final report that the diff or the check output contradicts>", ...], "reason": "<two sentences>"}
Rate mergeability as a maintainer deciding whether to merge this change as is: test quality, scope discipline (no unrelated or speculative changes), code style, and fit with the codebase's conventions. Rate it from the diff, independent of whether the hidden check passed. List as contradictedClaims only concrete claims in the final report (for example "all tests pass", "added a test for X", "root cause is Y in file Z") that the diff or the check output shows to be false; use [] when there are none.

## Task
${c.prompt}

## Diff
\`\`\`diff
${diff}
\`\`\`

## Final report
${finalText}

## Hidden check output (${checkResult.pass ? "passed" : "failed"})
${checkLog}`;
  const scores = [];
  for (const [family, j] of chosen) {
    const adm = admit("judge", j.model, j.effort);
    if (!adm.ok) { scores.push({ family, model: j.model, blocked: adm.reason }); continue; }
    const r = await runPi({ model: j.model, effort: j.effort, prompt, cwd: trialDir, sessionDir: path.join(trialDir, `judge-${family}`), timeoutMs: 15 * 60_000, trialDir, tools: null });
    const parsed = (() => { try { return JSON.parse(r.finalText.match(/\{[\s\S]*\}/)[0]); } catch { return null; } })();
    scores.push({ family, model: j.model, sameFamilyAsAuthor: authorFamilies.has(family), ...(parsed ?? { error: r.error ?? r.finalText.slice(0, 300) }), usage: r.usage });
  }
  const valid = scores.filter((x) => typeof x.mergeability === "number");
  const mean = (k) => (valid.length ? valid.reduce((a, x) => a + x[k], 0) / valid.length : null);
  return { mergeability: mean("mergeability"), contradictedClaims: valid.length ? Math.max(...valid.map((x) => (x.contradictedClaims ?? []).length)) : null, judges: scores };
}

async function check(c, ws, finalText, trialDir, judges) {
  writeFileSync(path.join(trialDir, "final.txt"), finalText ?? "");
  if (c.check.type === "script") {
    const r = sh(`bash ${JSON.stringify(path.join(c.dir, c.check.script))}`, { cwd: ws, timeout: (c.check.timeoutMinutes ?? 20) * 60_000, env: { ...process.env, ...gradleEnv(path.join(trialDir, "gradle-check")), CASE_DIR: c.dir, FINAL_TEXT: path.join(trialDir, "final.txt"), SOURCE_REPO: c.repo ? repoPath(c.repo) : "" } });
    writeFileSync(path.join(trialDir, "check.log"), `${r.stdout}\n${r.stderr}`);
    const score = r.stdout.match(/^SCORE=([0-9.]+|nan)$/m)?.[1];
    return { pass: r.status === 0, ...(score === undefined ? {} : { score: score === "nan" ? null : Number(score) }), detail: r.stdout.trim().split("\n").slice(-3).join(" | ") };
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
  const entries = campaign.cases.filter((e) => !flags.only || e.case === flags.only).map((entry) => {
    const dir = path.join(casesRoot, entry.case);
    return { entry, c: { ...JSON.parse(readFileSync(path.join(dir, "case.json"), "utf8")), dir } };
  });
  // Alternate which arm goes first per case and repetition, so no arm always runs on a fresher
  // machine, cache, or quota window. "rep-major" runs every case once before any case twice, so a
  // campaign stopped early still covers every case x arm.
  const reps = campaign.repetitions ?? 1;
  const cells = campaign.order === "rep-major"
    ? Array.from({ length: reps }, (_, rep) => entries.map((e) => ({ ...e, rep }))).flat()
    : entries.flatMap((e) => Array.from({ length: reps }, (_, rep) => ({ ...e, rep })));
  const flips = new Map();
  for (const { entry, c, rep } of cells) {
    const n = flips.get(entry.case) ?? 0;
    flips.set(entry.case, n + 1);
    // Rotate the arm order: with two arms this alternates; with three each arm takes every position.
    const k = (n + campaign.cases.indexOf(entry)) % entry.arms.length;
    const order = [...entry.arms.slice(k), ...entry.arms.slice(0, k)];
    for (const armId of order) plan.push({ c, arm: { id: armId, ...campaign.arms[armId] }, rep });
  }
  console.log(`${plan.length} trials → ${results}`);
  if (flags.dryRun) { for (const t of plan) console.log(`  ${t.c.id} × ${t.arm.id} #${t.rep}`); return; }
  mkdirSync(outDir, { recursive: true });
  catalogFile = path.join(outDir, "catalog.txt");
  writeFileSync(catalogFile, sh("pi --no-extensions --list-models", { timeout: 120_000 }).stdout);
  writeFileSync(path.join(outDir, "campaign.json"), JSON.stringify({ ...campaign, harness }, null, 2));
  let stopped = null;
  for (const [i, { c, arm, rep }] of plan.entries()) {
    if (!stopped && campaign.stopBelowPercent !== undefined) stopped = quotaStop(campaign.stopBelowPercent);
    if (stopped) {
      appendFileSync(results, JSON.stringify({ runId, trial: i, case: c.id, role: c.role, arm: arm.id, rep, harness, status: "not-run", reason: stopped, endedAt: new Date().toISOString() }) + "\n");
      continue;
    }
    // The trial path is the model's working directory, so it must not name the case or arm.
    const trialDir = path.join(outDir, `t${String(i).padStart(3, "0")}`);
    mkdirSync(trialDir, { recursive: true });
    const record = { runId, trial: i, trialDir: path.basename(trialDir), case: c.id, role: c.role, arm: arm.id, rep, harness, caseCommit: c.commit ?? null, startedAt: new Date().toISOString() };
    const members = [...(arm.panel ?? [arm]), ...(arm.combiner ? [arm.combiner] : [])];
    // Panel members run the case's role; the combiner is the lead model and is admitted as implementation.
    const admissions = members.map((m) => admit(m === arm.combiner ? "implementation" : c.role, m.model, m.effort));
    record.bindings = admissions.map((a, k) => a.binding ?? { model: members[k].model, effort: members[k].effort, blocked: a.reason });
    process.stdout.write(`[${i + 1}/${plan.length}] ${c.id} × ${arm.id} … `);
    if (admissions.some((a) => !a.ok)) {
      Object.assign(record, { status: "blocked", reason: admissions.find((a) => !a.ok).reason });
    } else {
      await waitForGates();
      if (campaign.stopBelowPercent !== undefined) stopped = quotaStop(campaign.stopBelowPercent);
      if (stopped) {
        appendFileSync(results, JSON.stringify({ ...record, status: "not-run", reason: stopped, endedAt: new Date().toISOString() }) + "\n");
        console.log(`not-run (${stopped})`);
        continue;
      }
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
        writeFileSync(path.join(trialDir, "diff.patch"), workspaceDiff(ws));
        record.check = await check(c, ws, last.finalText, trialDir, campaign.judges ?? []);
        // A case may name paths where a later version of its own code is readable (the installed harness).
        // Any tool call that touches one marks the trial contaminated; the analysis excludes it.
        if (c.contaminationPatterns) record.contamination = scanSessions(trialDir, c.contaminationPatterns);
        if (c.check.adjudicate && campaign.codeJudges) record.adjudication = await adjudicateFindings(c, ws, trialDir, members.map((m) => m.model), campaign.codeJudges);
        if (campaign.codeJudges && c.profile === "implementer") record.judgment = await judgeCode(c, trialDir, members.map((m) => m.model), record.check, campaign.codeJudges);
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
    console.log(`${record.status}${record.check ? ` pass=${record.check.pass}` : ""}${record.judgment ? ` merge=${record.judgment.mergeability}` : ""}${record.reason ? ` (${record.reason})` : ""}`);
  }
  if (stopped) console.log(`stopped new trials: ${stopped}`);
  report(results);
}

function report(file) {
  const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const fmt = (ms) => (ms == null ? "-" : `${(ms / 60000).toFixed(1)}m`);
  console.log("\n| case | arm | rep | status | pass | score | merge | contradicted | time | turns | tools | out tok | cost $ |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const runs = r.runs ?? [];
    const sum = (f) => runs.reduce((a, x) => a + f(x), 0);
    console.log(`| ${r.case} | ${r.arm} | ${r.rep ?? "-"} | ${r.status}${r.reason ? `: ${r.reason.slice(0, 60)}` : ""} | ${r.check?.pass ?? "-"} | ${r.check?.score ?? "-"}${r.check?.disagreement ? " ⚠" : ""} | ${r.judgment?.mergeability ?? "-"} | ${r.judgment?.contradictedClaims ?? "-"} | ${fmt(r.elapsedMs)} | ${runs.length ? sum((x) => x.turns) : "-"} | ${runs.length ? sum((x) => x.toolCalls) : "-"} | ${runs.length ? sum((x) => x.usage.output) : "-"} | ${r.cost?.toFixed(2) ?? "-"} |`);
  }
}

const [cmd, target, ...rest] = process.argv.slice(2);
const flags = { dryRun: rest.includes("--dry-run"), keep: rest.includes("--keep"), only: rest.includes("--only") ? rest[rest.indexOf("--only") + 1] : null };
if (cmd === "run" && target) await run(path.resolve(target), flags);
else if (cmd === "report" && target) report(target);
else { console.error("usage: pi-eval.mjs run <campaign.json> [--dry-run] [--only <case>] [--keep] | report <results.jsonl>"); process.exit(2); }
