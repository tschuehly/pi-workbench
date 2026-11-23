// pi-eval arms of kind "pi-web": drive a trial PI WEB instance over its HTTP API instead of `pi -p`, so a case runs
// in a Durable Chat, optionally watched by a live reviewer (`/pair`). See scripts/pi-eval.mjs and
// docs/contracts/harness.md ("Installed and Development Checkouts") for the trial-instance rules.
//
// The instance: own PI_WEB_DATA_DIR, socket and port (8517-8519, never 8505/8506), PI_WEB_PI_PACKAGE_AUTO_INSTALL=0,
// PI_WEB_DURABLE_DEFAULT=1, the real agent profile, and builds of the pinned PI WEB and pi-workbench revisions under
// <evalHome>/ab-live-review/builds. Its Durable host entry is scripts/pi-eval-host-shim.mjs: each Chat's host runs
// under sandbox-exec (the trial's host-sandbox.sb: pi-eval's read denies plus no outbound network but loopback), and
// reaches the model providers only through this module's CONNECT proxy, which admits the provider hosts alone.
// Tool commands inherit the host's sandbox, so `curl https://github.com` fails while model calls work.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const sh = (cmd, opts = {}) => spawnSync("bash", ["-c", cmd], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Model providers and their login refresh endpoints; everything else is refused.
const PROVIDER_HOSTS = /^(api\.anthropic\.com|console\.anthropic\.com|platform\.claude\.com|claude\.ai|api\.openai\.com|auth\.openai\.com|chatgpt\.com)$/;
// Loopback ports an agent must not reach: the owner's PI WEB instances and the trial instances' APIs (other Chats).
const DENIED_LOOPBACK = [8505, 8506, 8517, 8518, 8519];

/** A detached build of `rev` from `repo` under `buildsDir`, installed and built once (as promote-installed prepare does). */
export function prepareBuild(repo, rev, name, buildsDir) {
  const sha = sh(`git -C ${JSON.stringify(repo)} rev-parse --verify ${JSON.stringify(`${rev}^{commit}`)}`).stdout.trim();
  if (!sha) throw new Error(`${name}: unknown revision ${rev} in ${repo}`);
  const dir = path.join(buildsDir, `${name}-${sha.slice(0, 12)}`);
  if (existsSync(`${dir}.prepared`)) return dir;
  mkdirSync(buildsDir, { recursive: true });
  const log = path.join(buildsDir, `${name}-${sha.slice(0, 12)}.log`);
  const run = (cmd, cwd) => { const r = sh(`${cmd} >> ${JSON.stringify(log)} 2>&1`, { cwd, timeout: 30 * 60_000 }); if (r.status !== 0) throw new Error(`${name}: '${cmd}' failed, see ${log}`); };
  if (!existsSync(dir)) run(`git clone -q --shared --no-checkout ${JSON.stringify(repo)} ${JSON.stringify(dir)} && git -C ${JSON.stringify(dir)} checkout -q --detach ${sha}`, buildsDir);
  if (name === "pi-web") run("pnpm install --frozen-lockfile && chmod +x node_modules/node-pty/prebuilds/*/spawn-helper && npm run build", dir);
  else run("pnpm install --frozen-lockfile --ignore-scripts && cd packages/durable-pilot && pnpm install --frozen-lockfile --ignore-scripts", dir);
  writeFileSync(`${dir}.prepared`, `${sha}\n`);
  return dir;
}

/** The CONNECT proxy the sandboxed hosts reach the providers through (its own process: a busy harness never stalls it). */
function startProxy(port, log, pids) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "proxy", String(port), log], { detached: true, stdio: "ignore" });
  appendFileSync(pids, `${child.pid}\n`);
  return { close: () => { try { process.kill(child.pid, "SIGTERM"); } catch {} } };
}

/** The proxy itself; denials go to `log`. */
function serveProxy(port, log) {
  const server = http.createServer((req, res) => { appendFileSync(log, `${new Date().toISOString()} deny plain ${req.url}\n`); res.writeHead(403).end(); });
  server.on("connect", (req, socket, head) => {
    const [host, port] = String(req.url).split(":");
    if (!PROVIDER_HOSTS.test(host)) { appendFileSync(log, `${new Date().toISOString()} deny ${req.url}\n`); socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    const upstream = net.connect(Number(port) || 443, host, () => { socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); upstream.write(head); upstream.pipe(socket); socket.pipe(upstream); });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => resolve(server)); });
}

/**
 * The sandbox profile of one trial's hosts and tool commands: pi-eval's read denies (`baseProfile`, which keeps the
 * trial directory readable), reads of the host build and the trial's Chat stores, and no outbound network except
 * loopback (minus DENIED_LOOPBACK) and local sockets. `~/.m2/repository` is read only: a run never installs into the
 * shared Maven cache other runs and the owner read.
 */
export function hostSandboxProfile(baseProfile, { readable, m2 }) {
  const allowRead = readable.map((p) => `(allow file-read-data (subpath ${JSON.stringify(p)}))`).join("");
  const deniedLoopback = DENIED_LOOPBACK.map((p) => `(deny network-outbound (remote ip "localhost:${p}"))`).join("");
  // Later rules win: base rules first, then the network block, then the launchd/SSH-agent denies the base ends with.
  const [rules, unixDenies] = baseProfile.split(/(?=\(deny network-outbound \(remote unix-socket)/);
  return `${rules}${allowRead}(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(allow network-outbound (remote unix-socket))${deniedLoopback}${unixDenies ?? ""}`
    + `(deny file-write* (subpath ${JSON.stringify(path.join(m2, "repository"))}))`;
}

/** One trial PI WEB for a campaign: started once, reused by every pi-web trial, stopped by `stop()` or finish.sh. */
export async function startInstance({ evalHome, port, web, host, env: baseEnv, log = console.log }) {
  if (![8517, 8518, 8519].includes(port)) throw new Error(`trial PI WEB port must be 8517-8519, not ${port}`);
  const root = path.join(evalHome, "ab-live-review", `instance-${port}`);
  const data = path.join(root, "data");
  for (const d of [root, data, path.join(root, "sock")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  if (sh(`lsof -nP -iTCP:${port} -sTCP:LISTEN`).stdout.trim()) throw new Error(`port ${port} is in use; run ${path.join(evalHome, "ab-live-review", "finish.sh")}`);
  writeFileSync(path.join(root, "pids"), "");
  const proxyPort = port + 10_000;
  const proxy = startProxy(proxyPort, path.join(root, "proxy.log"), path.join(root, "pids"));
  const env = Object.fromEntries(Object.entries(baseEnv).filter(([k]) => !/^(PI_WEB_|PI_CODING_AGENT_SESSION_DIR$|PI_CODING_AGENT_DIR$)/.test(k)));
  Object.assign(env, {
    PI_WEB_DATA_DIR: data, PI_WEB_CONFIG: path.join(root, "config.json"), PI_WEB_SESSIOND_SOCKET: path.join(root, "sock", "s.sock"),
    PI_WEB_HOST: "127.0.0.1", PI_WEB_PORT: String(port), PI_WEB_SKIP_VERSION_CHECK: "1",
    PI_WEB_PI_PACKAGE_AUTO_INSTALL: "0", PI_WEB_DURABLE_DEFAULT: "1", PI_WEB_DURABLE_AUTO_UPGRADE: "0",
    PI_WEB_PI_PACKAGE_DIR: path.join(web, "node_modules/@earendil-works/pi-coding-agent"),
    PI_WEB_DURABLE_HOST: path.join(SCRIPTS, "pi-eval-host-shim.mjs"),
    PI_EVAL_REAL_HOST: path.join(host, "packages/durable-pilot/src/chat-host-main.ts"),
    PI_EVAL_PROXY: `http://127.0.0.1:${proxyPort}`,
    PI_CODING_AGENT_SESSION_DIR: path.join(root, "sessions"), NO_COLOR: "1",
  });
  const children = [];
  const start = (name) => {
    const fd = openSync(path.join(root, `${name}.log`), "a");
    const child = spawn(process.execPath, [path.join(web, "dist/server", `${name === "web" ? "index" : name}.js`)], { cwd: root, env, detached: true, stdio: ["ignore", fd, fd] });
    appendFileSync(path.join(root, "pids"), `${child.pid}\n`);
    children.push(child);
  };
  const until = async (what, fn, ms) => { const end = Date.now() + ms; for (;;) { try { if (await fn()) return; } catch {} if (Date.now() > end) throw new Error(`trial PI WEB: timed out waiting for ${what}`); await sleep(1000); } };
  const base = `http://127.0.0.1:${port}/`;
  const stop = async () => {
    for (const c of children) try { process.kill(-c.pid, "SIGTERM"); } catch {}
    await sleep(3000);
    for (const c of children) try { process.kill(-c.pid, "SIGKILL"); } catch {}
    sh(`pgrep -f ${JSON.stringify(root)} | xargs kill -KILL 2>/dev/null`);
    proxy.close();
    writeFileSync(path.join(root, "pids"), "");
  };
  try {
    start("sessiond");
    await until("the session daemon socket", () => existsSync(env.PI_WEB_SESSIOND_SOCKET), 90_000);
    start("web");
    await until("the web server", async () => (await fetch(`${base}api/projects`)).ok, 90_000);
  } catch (error) { await stop(); throw error; }
  log(`trial PI WEB up: ${base} (data ${data})`);
  return { base, root, data, storesDir: path.join(data, "durable"), stop };
}

/** A small client for one Chat's routes. */
function client(base, cwd) {
  const q = `?${new URLSearchParams({ cwd })}`;
  const api = async (method, route, body) => {
    const r = await fetch(`${base}api/${route}${method === "GET" ? (route.includes("?") ? `&${q.slice(1)}` : q) : ""}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify({ cwd, ...body }) : undefined });
    const t = await r.text();
    if (!r.ok) throw new Error(`${method} ${route}: ${r.status} ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : {};
  };
  const s = (id, route) => `sessions/${encodeURIComponent(id)}/${route}`;
  return {
    api, s,
    status: (id) => api("GET", s(id, "status")),
    messages: async (id) => { const r = await api("GET", s(id, "messages?limit=100000")); return r.messages ?? r; },
  };
}

/** Runner PIDs of the trial's background bash jobs still running (a job is done once its `exit` file exists). */
function runningJobs(trialDir) {
  const root = path.join(trialDir, "background-bash");
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((id) => !existsSync(path.join(root, id, "exit")))
    .flatMap((id) => sh(`pgrep -f ${JSON.stringify(path.join(root, id))}`).stdout.split("\n").filter(Boolean).map(Number));
}

const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.filter((p) => p.type === "text").map((p) => p.text ?? "").join("") : "");
const idle = (st) => !st.isStreaming && !st.isCompacting && !st.isBashRunning && st.pendingMessageCount === 0 && !(st.queuedMessages?.length);

/**
 * One trial in a Durable Chat: a fresh workspace (prepared by the caller in `ws`), the main model and thinking, an
 * optional `/pair <reviewer> --trigger X --brief Y`, the task text, then wait until main and reviewer stay idle (or the
 * cap) and collect both transcripts, tokens, wall time, digests and reviewer messages.
 */
export async function runPiWebArm({ inst, ws, trialDir, prompt, arm, timeoutMs, log = () => {} }) {
  const started = Date.now();
  const { api, s, status, messages } = client(inst.base, ws);
  const created = await api("POST", "sessions", { runtime: "durable" });
  const main = created.sessionId ?? created.id ?? created.session?.id;
  if (!main) throw new Error(`no session id in ${JSON.stringify(created).slice(0, 200)}`);
  const [provider, ...rest] = arm.model.split("/");
  await api("POST", s(main, "model"), { provider, modelId: rest.join("/") });
  await api("POST", s(main, "thinking-level"), { level: arm.effort });
  await api("POST", s(main, "commands/run"), { text: `/name ${path.basename(trialDir)}` });
  let pairResult;
  if (arm.reviewer) {
    pairResult = await api("POST", s(main, "commands/run"), { text: `/pair ${arm.reviewer.model} --trigger ${arm.reviewer.trigger ?? "turn5"} --brief ${arm.reviewer.brief ?? "silent"}` });
    log(`pair: ${JSON.stringify(pairResult).slice(0, 300)}`);
    if (!/Live review on/.test(JSON.stringify(pairResult))) throw new Error(`/pair refused: ${JSON.stringify(pairResult).slice(0, 300)}`);
  }
  const chats = async () => {
    const list = await api("GET", "sessions");
    return (list.sessions ?? list).map((x) => x.id ?? x.sessionId).filter(Boolean);
  };
  const reviewerId = arm.reviewer ? (await chats()).find((id) => id !== main) : undefined;
  if (arm.reviewer && !reviewerId) throw new Error("no reviewer Chat in the workspace after /pair");
  await api("POST", s(main, "prompt"), { text: prompt });
  // Settled: every Chat idle and no background bash job running for 3 polls in a row (30 s), so a build whose
  // completion will wake the Chat, or a digest in flight, is not missed.
  let quiet = 0, timedOut = false;
  while (quiet < 3) {
    await sleep(10_000);
    if (Date.now() - started > timeoutMs) { timedOut = true; break; }
    const sts = await Promise.all([main, reviewerId].filter(Boolean).map((id) => status(id).catch(() => ({ isStreaming: true }))));
    quiet = sts.every(idle) && runningJobs(trialDir).length === 0 ? quiet + 1 : 0;
  }
  if (timedOut) for (const id of [main, reviewerId].filter(Boolean)) await api("POST", s(id, "abort"), {}).catch(() => {});
  // Nothing an agent started outlives its trial: each job runner leads its own process group.
  for (const pid of runningJobs(trialDir)) try { process.kill(-pid, "SIGTERM"); } catch {}
  const elapsedMs = Date.now() - started;
  const collect = async (id, role, model, effort) => {
    const [st, msgs] = await Promise.all([status(id), messages(id)]);
    writeFileSync(path.join(trialDir, `${role}-messages.json`), JSON.stringify(msgs, null, 2));
    const assistant = msgs.filter((m) => m.role === "assistant");
    const last = assistant.at(-1);
    return {
      role, model, effort, chatId: id, elapsedMs, timedOut,
      turns: assistant.filter((m) => m.stopReason && m.stopReason !== "toolUse").length,
      toolCalls: assistant.reduce((a, m) => a + (m.content ?? []).filter((c) => c.type === "toolCall").length, 0),
      usage: { input: st.tokens?.input ?? 0, output: st.tokens?.output ?? 0, cacheRead: st.tokens?.cacheRead ?? 0, cacheWrite: st.tokens?.cacheWrite ?? 0, cost: st.cost ?? 0 },
      stopReason: last?.stopReason, error: last?.errorMessage,
      finalText: textOf(last?.content), messages: msgs,
    };
  };
  const runs = [await collect(main, "main", arm.model, arm.effort)];
  if (reviewerId) runs.push(await collect(reviewerId, "reviewer", arm.reviewer.model, "low"));
  // Close both Chats' hosts; their transcripts stay in the instance's data.
  for (const id of [reviewerId, main].filter(Boolean)) await api("POST", s(id, "stop"), { confirmed: true }).catch(() => {});
  return { runs, pair: reviewerId ? pairMetrics(runs[0].messages, runs[1].messages) : undefined, pairResult };
}

/**
 * Digest count (digests the reviewer received) and the reviewer's messages as the main Chat received them, each with
 * whether it was urgent (a steer) and what the main Chat did next (for the judge's acted-on call).
 */
export function pairMetrics(mainMsgs, reviewerMsgs) {
  const isChatMessage = (m) => m.role === "custom" || m.customType === "workbench:chat-message";
  const digests = reviewerMsgs.filter((m) => isChatMessage(m) && /Live review digest/.test(textOf(m.content))).length;
  const messages = [];
  mainMsgs.forEach((m, i) => {
    if (!isChatMessage(m)) return;
    const text = textOf(m.content);
    if (!/live review|Live reviewer/i.test(text)) return;
    const after = mainMsgs.slice(i + 1, i + 6).filter((x) => x.role === "assistant").map((x) => [textOf(x.content), ...(x.content ?? []).filter((c) => c.type === "toolCall").map((c) => `${c.name} ${JSON.stringify(c.arguments).slice(0, 400)}`)].filter(Boolean).join("\n")).join("\n---\n");
    messages.push({ index: i, urgent: /urgent|steer/i.test(JSON.stringify(m.details ?? {})) || /\burgent\b/i.test(text.split("\n")[0] ?? ""), text, after: after.slice(0, 3000) });
  });
  return { digests, reviewerMessages: messages.length, urgent: messages.filter((x) => x.urgent).length, normal: messages.filter((x) => !x.urgent).length, messages };
}

/**
 * At most `slots` agent builds at once across every trial: the workspace's `mvnw` waits for a free slot file under
 * `slotsDir` and holds its lock for the build's lifetime (the lock fd is inherited through exec, released at exit).
 * The original wrapper moves to `.mvnw-real` and runs sourced with `$0` still `mvnw` (it derives the Maven command and
 * the project directory from its own name); both lie in the snapshot commit, so neither shows in the diff.
 */
export function limitBuilds(ws, slotsDir, slots) {
  const mvnw = path.join(ws, "mvnw");
  if (!existsSync(mvnw)) return;
  mkdirSync(slotsDir, { recursive: true });
  writeFileSync(path.join(ws, ".mvnw-real"), readFileSync(mvnw));
  sh(`chmod +x ${JSON.stringify(path.join(ws, ".mvnw-real"))}`);
  writeFileSync(mvnw, `#!/bin/bash
# Waits for one of ${slots} shared build slots (evaluation harness), then runs the project's Maven wrapper.
exec perl -e 'use Fcntl qw(:flock); $^F = 255; my $d = shift; my $n = shift; my $said;
for (;;) { for my $i (0 .. $n - 1) { open(my $f, ">>", "$d/slot-$i") or die "slot: $!"; if (flock($f, LOCK_EX | LOCK_NB)) { $ENV{EVAL_BUILD_SLOT_FD} = fileno($f); exec @ARGV; die "exec: $!" } close $f } print STDERR "(waiting for a free build slot)\\n" unless $said++; sleep 2 }' ${JSON.stringify(slotsDir)} ${slots} \\
  env EVAL_REAL_MVNW="$(dirname "$0")/.mvnw-real" bash -c 'source "$EVAL_REAL_MVNW" "$@"' "$0" "$@"
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "proxy") await serveProxy(Number(process.argv[3]), process.argv[4]);
