#!/usr/bin/env node
// Model evaluation runner. See docs/plans/model-orchestration-redesign.md ("Evaluation") and evals/README.md.
// Usage:
//   node scripts/pi-eval.mjs run <campaign.json> [--dry-run] [--only <caseId>] [--keep]
//   node scripts/pi-eval.mjs report <results.jsonl>
//   node scripts/pi-eval.mjs verify-case <caseId>            (pi-web cases: hidden tests pass on the fix, fail at the start)
//   node scripts/pi-eval.mjs net-smoke <campaign.json>       (pi-web arms: an agent's bash has no internet, its model does)
// Arms of kind "pi-web" run in a Durable Chat of a trial PI WEB instance, optionally watched by a live reviewer
// (`/pair`); see scripts/pi-eval-web.mjs. Their cases use the "dev-run" check (held-out tests on a dev VM) and the
// diff judge (the real diff, the known defect, and a label per reviewer message).
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostSandboxProfile, limitBuilds, prepareBuild, runPiWebArm, startInstance } from "./pi-eval-web.mjs";

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
// Extensions stay on so extension-registered providers (xai-auth, antigravity-acp) can be arms.
let catalogFile;
function admit(role, model, effort) {
  const r = spawnSync("node", [RESOLVER, ADMISSION_ROLE[role] ?? role, "--model", model, "--effort", effort, "--catalog", catalogFile], { encoding: "utf8", timeout: 60_000 });
  try { return { ok: true, binding: JSON.parse(r.stdout).modelBinding }; } catch { return { ok: false, reason: (r.stdout + r.stderr).match(/REASON=(.*)/)?.[1] ?? r.stdout.slice(0, 300) }; }
}

// Fresh snapshot without history, so the future fix is never discoverable through git.
function prepareWorkspace(c, dir, beforeSnapshot) {
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
  beforeSnapshot?.(dir);
  // Setup may build its own history (a review case commits the change under review).
  if (!existsSync(path.join(dir, ".git"))) sh(`git init -q && git add -A && git -c user.name=eval -c user.email=eval@local commit -qm snapshot --allow-empty --no-verify`, { cwd: dir });
}

// A candidate has shell access, so it could read the source repositories, the case checks, earlier trials,
// retained review evidence or session logs that discuss the answers, and it could reach GitHub as the owner.
// macOS sandbox-exec denies those reads; later rules win, so the trial directory, Pi's local packages, the
// promoted checkouts (~/.pi-workbench/installed) and run shims (~/.pi-workbench/run) stay readable.
// All of ~/.pi-workbench is denied (scratch, workstreams, tmp, background-bash, reviews, ...); runPi points
// Pi's tmp and background-bash roots into the trial directory.
// Rules match real paths, so every path is resolved: the `*.installed` links point into ~/.pi-workbench/installed.
// It also denies the login keychain, ~/.ssh, connecting to the SSH agent (launchd's socket is findable by
// glob), and the tools that hand out stored credentials (gh, security, git's keychain helper); Pi's model
// logins live in ~/.pi/agent/auth.json. A provider that probes the keychain (antigravity-acp) then falls
// back to its token file.
function sandboxProfile(trialDir) {
  const real = (p) => (existsSync(p) ? realpathSync(p) : p);
  const home = homedir();
  const projects = real(process.env.PI_EVAL_PROJECTS ?? path.join(home, "IdeaProjects"));
  const workbench = path.join(home, ".pi-workbench");
  const deny = [projects, real(EVAL_HOME), workbench, ".pi/agent/sessions", ".pi-web", "Library/Keychains", ".ssh", ".claude/projects", ".codex/sessions"]
    .map((p) => real(path.resolve(home, p)));
  // Pi's settings and global AGENTS.md may be links into a denied checkout (pi-agent-config); Pi needs both to load.
  const agentFiles = ["settings.json", "AGENTS.md"].map((f) => path.join(home, ".pi/agent", f));
  const allow = [...localPiPackages(), ...agentFiles, path.join(workbench, "installed"), path.join(workbench, "run"), trialDir].map(real);
  const rule = (verb, p) => `(${verb} file-read-data (subpath ${JSON.stringify(p)}))`;
  const which = (cmd) => sh(`command -v ${cmd}`).stdout.trim();
  const noExec = ["/usr/bin/security", which("gh"), path.join(sh("git --exec-path").stdout.trim(), "git-credential-osxkeychain")].filter(Boolean).map(real);
  const agent = process.env.SSH_AUTH_SOCK ? ` (remote unix-socket (path-literal ${JSON.stringify(real(process.env.SSH_AUTH_SOCK))}))` : "";
  return `(version 1)(allow default)${deny.map((p) => rule("deny", p)).join("")}${allow.map((p) => rule("allow", p)).join("")}`
    + noExec.map((p) => `(deny process-exec (literal ${JSON.stringify(p)}))`).join("")
    + `(deny network-outbound (remote unix-socket (path-regex #"^/private/var/run/com\\.apple\\.launchd\\.[^/]+/"))${agent})`;
}

// Local-path packages from Pi's settings (the installed Workbench, development packages); Pi exits if it
// cannot read one.
function localPiPackages() {
  try {
    const { packages = [] } = JSON.parse(readFileSync(path.join(homedir(), ".pi/agent/settings.json"), "utf8"));
    return packages.map((p) => (typeof p === "string" ? p : p.source)).filter((s) => s?.startsWith("/"));
  } catch { return []; }
}

// Credentials a trial must not inherit; git gets no global or system config (the Xcode system config
// names the keychain helper) and cannot prompt, so it gets an eval identity for commits.
function trialEnv(base, trialDir) {
  const id = { GIT_AUTHOR_NAME: "eval", GIT_AUTHOR_EMAIL: "eval@local", GIT_COMMITTER_NAME: "eval", GIT_COMMITTER_EMAIL: "eval@local" };
  const tmp = path.join(trialDir, "pi-tmp");
  const env = { ...base, ...id, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    PI_TMP_ROOT: tmp, PI_TMP: tmp, PI_BACKGROUND_BASH_ROOT: path.join(trialDir, "background-bash") };
  for (const k of Object.keys(env)) if (/^(GH_|GITHUB_|SSH_AUTH_SOCK$|GIT_ASKPASS$|SSH_ASKPASS$)|_GH_TOKEN$/.test(k)) delete env[k];
  return env;
}

function runPi({ model, effort, prompt, cwd, sessionDir, timeoutMs, trialDir, tools = TOOLS }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = ["-p", "--mode", "json", "--model", model, "--thinking", effort, "--session-dir", sessionDir, tools ? "--tools" : "--no-tools", ...(tools ? [tools] : []), prompt];
    const env = trialEnv({ ...process.env, ...gradleEnv(path.join(trialDir, "gradle-agent")) }, trialDir);
    delete env.PI_WORKBENCH_ROUTING_OVERLAY;
    mkdirSync(env.PI_TMP, { recursive: true });
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

async function runArm(c, arm, trialDir, ctx) {
  if (arm.kind === "pi-web") return runWebArm(c, arm, trialDir, ctx);
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

// A pi-web arm: a fresh workspace whose Maven builds share the campaign's build slots, the trial's host sandbox
// profile (read by scripts/pi-eval-host-shim.mjs), then one Durable Chat run in the trial PI WEB.
const BUILD_SLOTS = path.join(EVAL_HOME, "ab-live-review", "build-slots");
const real = (p) => (existsSync(p) ? realpathSync(p) : p);
// The host build, the PI WEB build, the build slots and the sandbox-safe ps (scripts/pi-eval-ps) stay readable.
const writeHostProfile = (trialDir, inst) => writeFileSync(path.join(trialDir, "host-sandbox.sb"), hostSandboxProfile(sandboxProfile(trialDir), { readable: [inst.hostBuild, inst.webBuild, BUILD_SLOTS, path.join(ROOT, "scripts/pi-eval-ps")].map(real), m2: path.join(homedir(), ".m2") }));
async function runWebArm(c, arm, trialDir, { inst, campaign }) {
  const ws = path.join(trialDir, "ws");
  prepareWorkspace(c, ws, (dir) => limitBuilds(dir, BUILD_SLOTS, campaign.buildSlots ?? 2));
  writeHostProfile(trialDir, inst);
  const r = await runPiWebArm({ inst, ws: real(ws), trialDir: real(trialDir), prompt: buildPrompt(c), arm, timeoutMs: (c.timeoutMinutes ?? 60) * 60_000 });
  return { ws, runs: r.runs.map(({ messages: _m, ...x }) => ({ ws, ...x })), pair: r.pair };
}

const shAsync = (cmd, { cwd, timeoutMs }) => new Promise((resolve) => {
  const child = spawn("bash", ["-c", cmd], { cwd, stdio: "ignore", detached: true });
  const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGTERM"); } catch {} }, timeoutMs);
  child.on("close", (code) => { clearTimeout(timer); resolve(code); });
});

// Held-out tests: a shared clone of the case repository at the start commit, the agent's diff applied, the PR's test
// files copied over it, and the case's command on a dev VM (dev-run ships the clone's HEAD plus its changes). dev-run
// exit 74 (VM lost or unreachable) is retried once.
async function devRunCheck(c, trialDir, diffFile = path.join(trialDir, "diff.patch")) {
  const dir = path.join(trialDir, "hidden-check");
  const q = JSON.stringify;
  rmSync(dir, { recursive: true, force: true });
  const clone = sh(`git clone -q --shared --no-checkout ${q(repoPath(c.repo))} ${q(dir)} && git -C ${q(dir)} checkout -q --detach ${c.commit}`);
  if (clone.status !== 0) throw new Error(`hidden-test checkout failed: ${clone.stderr}`);
  try {
    if (existsSync(diffFile) && readFileSync(diffFile, "utf8").trim()) {
      const applied = sh(`git apply --whitespace=nowarn ${q(diffFile)}`, { cwd: dir });
      if (applied.status !== 0) return { pass: false, exitCode: null, detail: `the diff does not apply: ${applied.stderr.slice(0, 300)}` };
    }
    const copied = sh(`cp -R ${q(path.join(c.dir, "tests"))}/. ${q(dir)}`);
    if (copied.status !== 0) throw new Error(`hidden tests not copied: ${copied.stderr}`);
    const log = path.join(trialDir, "check.log");
    const minutes = c.check.timeoutMinutes ?? 30;
    let code;
    for (let attempt = 0; attempt < 2 && (code === undefined || code === 74); attempt++) {
      code = await shAsync(`dev-run --timeout ${minutes * 60} -- ${c.check.command} > ${q(log)} 2>&1`, { cwd: dir, timeoutMs: (minutes + 15) * 60_000 });
    }
    const out = existsSync(log) ? readFileSync(log, "utf8") : "";
    const maven = [...out.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/gm)].at(-1);
    const python = out.match(/^Ran (\d+) tests?/m);
    const pyFail = out.match(/^FAILED \(([^)]*)\)/m)?.[1];
    const tests = maven ? { run: +maven[1], failures: +maven[2], errors: +maven[3], skipped: +maven[4] }
      : python ? { run: +python[1], failures: +(pyFail?.match(/failures=(\d+)/)?.[1] ?? 0), errors: +(pyFail?.match(/errors=(\d+)/)?.[1] ?? 0) } : null;
    const problems = out.split("\n").filter((l) => l.startsWith("problem:")).slice(0, 5);
    return { pass: code === 0, exitCode: code, tests, detail: problems.join(" | ") || out.trim().split("\n").slice(-3).join(" | ") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Blind cross-family diff judge: the task, the real fix and its known defect against the anonymous diff, plus a label
// for each live-reviewer message (and whether the implementer acted on it). Judges never see model names.
async function judgeDiff(c, trialDir, pair, judges) {
  const cap = (t, n = 150_000) => (t.length > n ? `${t.slice(0, n)}\n… (${t.length - n} more characters cut)` : t);
  const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  const diff = read(path.join(trialDir, "diff.patch"));
  const messages = pair?.messages ?? [];
  const listed = messages.map((m, i) => `### Reviewer message ${i + 1} (${m.urgent ? "urgent" : "normal"})\n${cap(m.text, 6000)}\n\nWhat the implementer did next:\n${m.after || "(nothing)"}`).join("\n\n");
  const prompt = `You are grading one anonymous implementation of a task against the change that was really merged. Read both diffs closely.

Score 0-10 how well the implementation achieves the task compared with the real fix (correctness first, then completeness and test coverage; style matters little). Say whether it repeats the known defect below (true, false, or null when the implementation does not reach that code).
${messages.length ? `A live reviewer watched the implementer and sent the messages listed last. Label each: "caught-real-defect" (it points at a real defect in the work at that time), "useful" (a correct, worthwhile improvement or risk), "noise" (correct but not worth the interruption), or "wrong" (incorrect advice). Also say whether the implementer acted on it.` : ""}

Reply with only JSON: {"score": <0-10>, "repeatsKnownDefect": true|false|null, "reason": "<two sentences>"${messages.length ? `, "messages": [{"n": <number>, "label": "caught-real-defect|useful|noise|wrong", "acted": true|false, "reason": "<one sentence>"}]` : ""}}

## Task
${c.prompt}

## Real merged change (reference)
${cap(read(path.join(c.dir, c.judge.reference)))}

## Known defect of the first real implementation (found later by review)
${read(path.join(c.dir, c.judge.knownDefect))}

## Implementation under grading (diff)
${diff.trim() ? cap(diff) : "(no change)"}
${messages.length ? `\n## Live reviewer messages\n${listed}` : ""}`;
  writeFileSync(path.join(trialDir, "judge-prompt.md"), prompt);
  const verdicts = [];
  for (const j of judges) {
    const adm = admit("judge", j.model, j.effort);
    if (!adm.ok) { verdicts.push({ model: j.model, blocked: adm.reason }); continue; }
    const r = await runPi({ model: j.model, effort: j.effort, prompt, cwd: trialDir, sessionDir: path.join(trialDir, `judge-${j.model.replace(/\W/g, "_")}`), timeoutMs: 15 * 60_000, trialDir, tools: null });
    const parsed = (() => { try { return JSON.parse(r.finalText.match(/\{[\s\S]*\}/)[0]); } catch { return null; } })();
    verdicts.push({ model: j.model, score: parsed?.score ?? null, repeatsKnownDefect: parsed?.repeatsKnownDefect ?? null, reason: parsed?.reason ?? r.error ?? r.finalText.slice(0, 300), messages: parsed?.messages, usage: r.usage });
  }
  const valid = verdicts.filter((v) => typeof v.score === "number");
  return { score: valid.length ? valid.reduce((a, v) => a + v.score, 0) / valid.length : null, judges: verdicts, labels: valid[0]?.messages ?? [] };
}

// Parallelism grows one step at a time (never past `max`) only while, for every quota window of the providers in
// play, the window's used share plus the measured per-trial use times the next level stays under the ceiling.
const PROVIDER_QUOTA = { anthropic: "claude", openai: "codex", "openai-codex": "codex", "github-copilot": "copilot" };
const quotaProviders = (arm) => [arm.model, arm.reviewer?.model, ...(arm.panel ?? []).map((m) => m.model)].filter(Boolean).map((m) => PROVIDER_QUOTA[m.split("/")[0]]).filter(Boolean);
function windowUse(before, after, provider, id) {
  const b = before?.find((p) => p.provider === provider)?.windows.find((w) => w.id === id);
  const a = after?.find((p) => p.provider === provider)?.windows.find((w) => w.id === id);
  if (b?.percentRemaining == null || a?.percentRemaining == null || b.resetsAt !== a.resetsAt) return null;
  return Math.max(0, b.percentRemaining - a.percentRemaining);
}
export function nextParallel(level, { max = 1, ceilingPercent = 60 } = {}, done, now, providers) {
  if (level >= max || !now) return level;
  for (const provider of new Set(providers)) {
    for (const w of now.find((p) => p.provider === provider)?.windows ?? []) {
      if (w.percentRemaining == null) continue;
      const uses = done.map((r) => windowUse(r.quotaBefore, r.quotaAfter, provider, w.id)).filter((u) => u != null);
      if (!uses.length) return level;
      const perTrial = uses.reduce((a, b) => a + b, 0) / uses.length;
      if (100 - w.percentRemaining + perTrial * (level + 1) >= ceilingPercent) return level;
    }
  }
  return level + 1;
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
    for (let rep = 0; rep < (entry.repetitions ?? campaign.repetitions ?? 1); rep++) {
      const order = group++ % 2 === 0 ? entry.arms : [...entry.arms].reverse();
      for (const armId of order) plan.push({ c, arm: { id: armId, ...campaign.arms[armId] }, rep });
    }
  }
  if (flags.limit) plan.splice(flags.limit);
  console.log(`${plan.length} trials → ${results}`);
  if (flags.dryRun) { for (const t of plan) console.log(`  ${t.c.id} × ${t.arm.id} #${t.rep}`); return; }
  mkdirSync(outDir, { recursive: true });
  catalogFile = path.join(outDir, "catalog.txt");
  writeFileSync(catalogFile, sh("pi --list-models", { timeout: 120_000 }).stdout);
  writeFileSync(path.join(outDir, "campaign.json"), JSON.stringify({ ...campaign, harness }, null, 2));
  let inst;
  if (plan.some((t) => t.arm.kind === "pi-web")) inst = await webInstance(campaign, outDir);
  const stopInstance = async () => { await inst?.stop(); inst = undefined; };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await stopInstance(); process.exit(130); });
  const done = [];
  let stopped = null;
  async function runTrial(i, { c, arm, rep }) {
    // The trial path is the model's working directory, so it must not name the case or arm.
    const trialDir = path.join(outDir, `t${String(i).padStart(3, "0")}`);
    mkdirSync(trialDir, { recursive: true });
    const record = { runId, trial: i, trialDir: path.basename(trialDir), case: c.id, role: c.role, arm: arm.id, rep, harness, caseCommit: c.commit ?? null, startedAt: new Date().toISOString() };
    const members = [...(arm.panel ?? [arm]), ...(arm.combiner ? [arm.combiner] : []), ...(arm.reviewer ? [{ ...arm.reviewer, effort: "low" }] : [])];
    const admissions = members.map((m) => admit(c.role, m.model, m.effort));
    record.bindings = admissions.map((a, k) => a.binding ?? { model: members[k].model, effort: members[k].effort, blocked: a.reason });
    if (admissions.some((a) => !a.ok)) {
      Object.assign(record, { status: "blocked", reason: admissions.find((a) => !a.ok).reason });
    } else {
      record.quotaBefore = quota();
      const workspaces = [];
      try {
        const { ws, runs, pair } = await runArm(c, arm, trialDir, { inst, campaign });
        workspaces.push(ws, ...runs.map((x) => x.ws));
        const last = arm.kind === "pi-web" ? runs[0] : runs.at(-1);
        record.runs = runs.map(({ ws: _w, finalText: _f, ...r }) => r);
        // A pi-web trial's main and reviewer Chats run side by side: its time is the wall time.
        record.elapsedMs = arm.kind === "pi-web" ? runs[0].elapsedMs : runs.reduce((a, r) => a + r.elapsedMs, 0);
        record.cost = runs.reduce((a, r) => a + r.usage.cost, 0);
        if (pair) record.pair = pair;
        // Diff against the snapshot root commit, so work the model committed is captured too.
        writeFileSync(path.join(trialDir, "diff.patch"), sh("git add -A && git diff --cached --binary $(git rev-list --max-parents=0 HEAD | tail -1)", { cwd: ws }).stdout);
        sh("git reset -q", { cwd: ws });
        record.check = c.check.type === "dev-run" ? await devRunCheck(c, trialDir) : await check(c, ws, last.finalText, trialDir, campaign.judges ?? []);
        if (c.judge) record.judge = await judgeDiff(c, trialDir, pair, campaign.judges ?? []);
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
    console.log(`[${i + 1}/${plan.length}] ${c.id} × ${arm.id} #${rep}: ${record.status}${record.check ? ` pass=${record.check.pass}` : ""}${record.judge ? ` judge=${record.judge.score}` : ""}${record.reason ? ` (${record.reason})` : ""}`);
    done.push(record);
  }
  let level = campaign.parallel?.start ?? 1;
  const running = new Set();
  let next = 0;
  try {
    while ((next < plan.length && !stopped) || running.size) {
      while (running.size < level && next < plan.length && !stopped) {
        await waitForGates();
        const t = plan[next];
        const now = quota();
        const low = now?.filter((p) => quotaProviders(t.arm).includes(p.provider)).flatMap((p) => p.windows.map((w) => ({ provider: p.provider, ...w }))).find((w) => w.percentRemaining != null && w.percentRemaining < (campaign.stopBelowPercent ?? 0));
        if (low) { stopped = `${low.provider} ${low.id} at ${low.percentRemaining}% remaining`; break; }
        const p = runTrial(next++, t).finally(() => running.delete(p));
        running.add(p);
      }
      if (running.size) await Promise.race(running);
      const raised = nextParallel(level, campaign.parallel, done.filter((r) => r.quotaAfter), quota(), plan.flatMap((t) => quotaProviders(t.arm)));
      if (raised !== level) { console.log(`parallel runs: ${level} → ${raised}`); level = raised; }
    }
  } finally {
    await stopInstance();
  }
  if (stopped) {
    console.log(`stopped early: ${stopped}; ${plan.length - next} trials not run`);
    writeFileSync(path.join(outDir, "not-run.json"), JSON.stringify({ reason: stopped, trials: plan.slice(next).map((t) => ({ case: t.c.id, arm: t.arm.id, rep: t.rep })) }, null, 2));
  }
  if (existsSync(results)) report(results);
}

// The campaign's trial PI WEB: pinned builds of PI WEB and the pi-workbench host, one instance for every pi-web trial.
async function webInstance(campaign, outDir) {
  const w = campaign.piWeb ?? {};
  const home = (p) => p.replace(/^~(?=\/)/, homedir());
  const buildsDir = path.join(EVAL_HOME, "ab-live-review", "builds");
  const webBuild = prepareBuild(home(w.web.repo), w.web.rev, "pi-web", buildsDir);
  const hostBuild = prepareBuild(home(w.host.repo), w.host.rev, "pi-workbench", buildsDir);
  const env = trialEnv({ ...process.env }, outDir);
  for (const k of ["PI_TMP", "PI_TMP_ROOT", "PI_BACKGROUND_BASH_ROOT", "PI_WORKBENCH_ROUTING_OVERLAY"]) delete env[k];
  const inst = await startInstance({ evalHome: EVAL_HOME, port: w.port ?? 8517, web: webBuild, host: hostBuild, env });
  return { ...inst, webBuild, hostBuild };
}

// Case verification: the hidden tests pass on the real fix and fail at the start commit (both through dev-run), and
// the case's local build passes offline from a fresh snapshot under the same host sandbox an agent gets.
async function verifyCase(caseId, flags) {
  const dir = path.join(EVAL_HOME, "cases", caseId);
  const c = { ...JSON.parse(readFileSync(path.join(dir, "case.json"), "utf8")), dir };
  const out = path.join(EVAL_HOME, "results", `verify-${caseId}-${stamp()}`);
  const result = { case: caseId, start: c.commit, fix: c.fixCommit, out };
  const steps = flags.only ? [flags.only] : ["fix", "start", "local"];
  if (steps.includes("fix")) {
    const t = path.join(out, "fix"); mkdirSync(t, { recursive: true });
    result.fixRun = await devRunCheck(c, t, path.join(dir, c.judge.reference));
  }
  if (steps.includes("start")) {
    const t = path.join(out, "start"); mkdirSync(t, { recursive: true });
    result.startRun = await devRunCheck(c, t, path.join(t, "none.patch"));
  }
  if (steps.includes("local") && c.localBuild) {
    const t = path.join(out, "local"); const ws = path.join(t, "ws");
    prepareWorkspace(c, ws, (d) => limitBuilds(d, BUILD_SLOTS, 2));
    const profile = hostSandboxProfile(sandboxProfile(t), { readable: [BUILD_SLOTS].map(real), m2: path.join(homedir(), ".m2") });
    writeFileSync(path.join(t, "host-sandbox.sb"), profile);
    const started = Date.now();
    // The agent's temporary folder is inside its trial, as the host shim sets it (the default is under ~/.pi-workbench).
    mkdirSync(path.join(t, "pi-tmp"), { recursive: true });
    const code = await shAsync(`TMPDIR=${JSON.stringify(path.join(t, "pi-tmp"))} sandbox-exec -f ${JSON.stringify(path.join(t, "host-sandbox.sb"))} bash -c ${JSON.stringify(c.localBuild)} > ${JSON.stringify(path.join(t, "local-build.log"))} 2>&1`, { cwd: ws, timeoutMs: 40 * 60_000 });
    result.localBuild = { pass: code === 0, exitCode: code, minutes: +((Date.now() - started) / 60000).toFixed(1), log: path.join(t, "local-build.log") };
    rmSync(ws, { recursive: true, force: true });
  }
  result.verified = (result.fixRun?.pass ?? true) && (result.startRun ? !result.startRun.pass : true) && (result.localBuild?.pass ?? true);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "verify.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

// Network-deny proof for pi-web arms: one Durable Chat in the campaign's trial PI WEB runs curl to GitHub (through the
// proxy and around it) and reads a source repository; each must fail while the Chat's model answers.
async function netSmoke(campaignPath) {
  const campaign = JSON.parse(readFileSync(campaignPath, "utf8"));
  const outDir = path.join(EVAL_HOME, "results", `net-smoke-${stamp()}`);
  const trialDir = path.join(outDir, "t000");
  const ws = path.join(trialDir, "ws");
  mkdirSync(ws, { recursive: true });
  sh("git init -q && git -c user.name=eval -c user.email=eval@local commit -q --allow-empty -m snapshot", { cwd: ws });
  const secretFile = path.join(repoPath("pi-workbench"), "AGENTS.md");
  const inst = await webInstance(campaign, outDir);
  try {
    writeHostProfile(trialDir, inst);
    const commands = ["curl -sS -m 20 -o /dev/null https://github.com", "curl -sS -m 20 --noproxy '*' -o /dev/null https://github.com", `head -c 40 ${secretFile}`, "curl -sS -m 5 -o /dev/null http://127.0.0.1:8506/api/projects", "sleep 40; echo slept", "echo sandbox-ok"];
    const prompt = `This is a sandbox test. Run each of these commands with the bash tool, one call each, with foreground=true, exactly as written, and report each exit status in one line:\n${commands.map((x, i) => `${i + 1}. ${x}`).join("\n")}\nThen use the read tool (not bash) on ${secretFile} and report whether it worked.`;
    const arm = { model: campaign.netSmokeModel ?? "anthropic/claude-sonnet-5-5", effort: "low" };
    const r = await runPiWebArm({ inst, ws: real(ws), trialDir: real(trialDir), prompt, arm, timeoutMs: 10 * 60_000 });
    const msgs = JSON.parse(readFileSync(path.join(real(trialDir), "main-messages.json"), "utf8"));
    const results = msgs.filter((m) => m.role === "toolResult").map((m) => ({ tool: m.toolName, isError: m.isError, text: (Array.isArray(m.content) ? m.content.map((p) => p.text ?? "").join("") : String(m.content)).slice(0, 400) }));
    const summary = { outDir, model: arm.model, modelAnswered: Boolean(r.runs[0].finalText), finalText: r.runs[0].finalText, usage: r.runs[0].usage, toolResults: results, proxyLog: existsSync(path.join(inst.root, "proxy.log")) ? readFileSync(path.join(inst.root, "proxy.log"), "utf8").split("\n").slice(-20) : [] };
    writeFileSync(path.join(outDir, "net-smoke.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await inst.stop();
  }
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
const flags = { dryRun: rest.includes("--dry-run"), keep: rest.includes("--keep"), only: rest.includes("--only") ? rest[rest.indexOf("--only") + 1] : null, limit: rest.includes("--limit") ? Number(rest[rest.indexOf("--limit") + 1]) : null };
if (cmd === "run" && target) await run(path.resolve(target), flags);
else if (cmd === "verify-case" && target) await verifyCase(target, flags);
else if (cmd === "net-smoke" && target) await netSmoke(path.resolve(target));
else if (cmd === "report" && target) report(target);
else if (cmd === "sandbox-profile" && target) console.log(sandboxProfile(path.resolve(target)));
else if (cmd === "trial-env" && target) for (const [k, v] of Object.entries(trialEnv({}, path.resolve(target)))) console.log(`${k}=${v}`);
else { console.error("usage: pi-eval.mjs run <campaign.json> [--dry-run] [--only <case>] [--limit <n>] [--keep] | verify-case <caseId> [--only fix|start|local] | net-smoke <campaign.json> | report <results.jsonl> | sandbox-profile <trial-dir> | trial-env <trial-dir>"); process.exit(2); }
