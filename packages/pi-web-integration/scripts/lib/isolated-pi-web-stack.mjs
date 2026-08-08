import { execFile, spawn } from "node:child_process";
import { access, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REQUIRED_PATH_KEYS = [
  "HOME", "XDG_CONFIG_HOME", "PI_WEB_DATA_DIR", "PI_WEB_CONFIG",
  "PI_WEB_PROJECTS_FILE", "PI_WEB_MACHINES_FILE", "PI_WEB_SESSIOND_SOCKET",
  "PI_WEB_AGENT_DIR", "PI_CODING_AGENT_DIR", "PI_WEB_AGENT_SESSION_DIR",
  "PI_CODING_AGENT_SESSION_DIR", "PI_WEB_FIXTURE_MANIFEST",
];
const FORBIDDEN_ENV_PATTERN = /(?:^|_)(?:PROXY|TOKEN|API_KEY|AUTH|CREDENTIALS?)(?:_|$)|^(?:AWS|AZURE|GOOGLE|OPENAI|ANTHROPIC|GITHUB|GH)_/iu;
const SAFE_INHERITED_KEYS = ["PATH", "LANG", "LC_ALL", "TMPDIR", "USER", "LOGNAME", "SHELL", "__CF_USER_TEXT_ENCODING", "SystemRoot", "COMSPEC", "PATHEXT"];

export class IsolationError extends Error {
  constructor(message) {
    super(message);
    this.name = "IsolationError";
    this.code = "ISOLATION_VIOLATION";
  }
}

export async function createIsolatedPiWebStack(options) {
  const root = resolveRequiredRoot(options?.root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const ownedRoot = await realpath(root);
  const existingEntries = await readdir(ownedRoot);
  if (existingEntries.length > 0) throw new IsolationError("The isolated runtime root must be fresh and empty");
  const webPort = ownedPort(options?.webPort, "webPort");
  const browserPort = ownedPort(options?.browserPort, "browserPort", true);
  if (browserPort !== undefined && browserPort === webPort) throw new IsolationError("webPort and browserPort must be distinct");

  const paths = Object.freeze({
    root: ownedRoot,
    home: resolve(ownedRoot, "home"),
    xdgConfig: resolve(ownedRoot, "xdg-config"),
    data: resolve(ownedRoot, "data"),
    config: resolve(ownedRoot, "xdg-config/pi-web/config.json"),
    projects: resolve(ownedRoot, "data/projects.json"),
    machines: resolve(ownedRoot, "data/machines.json"),
    socket: resolve(ownedRoot, "run/sessiond.sock"),
    agent: resolve(ownedRoot, "agent"),
    sessions: resolve(ownedRoot, "agent/sessions"),
    workstreams: resolve(ownedRoot, "home/.pi-workbench/workstreams"),
    fixture: resolve(ownedRoot, "fixture"),
    fixtureManifest: resolve(ownedRoot, "fixture/manifest.json"),
    logs: resolve(ownedRoot, "logs"),
    chromeProfile: resolve(ownedRoot, "chrome-profile"),
    tmp: resolve(ownedRoot, "tmp"),
  });
  for (const path of Object.values(paths)) assertOwnedPath(ownedRoot, path);
  const ownedDirectories = [paths.home, paths.xdgConfig, resolve(paths.config, ".."), paths.data, resolve(paths.socket, ".."), paths.agent, paths.sessions, paths.workstreams, paths.fixture, paths.logs, paths.tmp];
  await Promise.all(ownedDirectories.map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
  for (const path of ownedDirectories) assertOwnedPath(ownedRoot, await realpath(path));

  const env = buildIsolatedEnvironment(paths, webPort, options?.baseEnv);
  assertIsolatedEnvironment(env, { root: ownedRoot, webPort, browserPort });
  await verifyChildHomedir(env, ownedRoot);
  const children = new Set();
  let cleaning = false;
  let cleanupPromise;

  function spawnOwned(name, command, args = [], spawnOptions = {}) {
    if (cleaning) throw new IsolationError("Cannot spawn after cleanup started");
    if (!isAbsolute(command)) throw new IsolationError(`${name} command must be an absolute path`);
    const cwd = spawnOptions.cwd ?? ownedRoot;
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: spawnOptions.stdio ?? "pipe",
      detached: process.platform !== "win32",
    });
    child.ownedProcessName = name;
    children.add(child);
    child.once("exit", () => children.delete(child));
    return child;
  }

  async function cleanup({ removeRoot = true } = {}) {
    if (cleanupPromise !== undefined) return cleanupPromise;
    cleaning = true;
    cleanupPromise = (async () => {
      const ownedChildren = [...children];
      await Promise.allSettled(ownedChildren.map(terminateOwnedProcess));
      children.clear();
      if (removeRoot) await rm(ownedRoot, { recursive: true, force: true });
      const rootRemoved = removeRoot ? await access(ownedRoot).then(() => false, () => true) : false;
      return Object.freeze({
        processes: ownedChildren.map((child) => Object.freeze({ name: child.ownedProcessName ?? "owned-process", exited: child.exitCode !== null || child.signalCode !== null })),
        rootRemoved,
      });
    })();
    return cleanupPromise;
  }

  return Object.freeze({ root: ownedRoot, paths, env: Object.freeze(env), ports: Object.freeze({ web: webPort, ...(browserPort === undefined ? {} : { browser: browserPort }) }), spawnOwned, cleanup });
}

export function buildIsolatedEnvironment(paths, webPort, baseEnv = process.env) {
  const env = {};
  for (const key of SAFE_INHERITED_KEYS) {
    const value = baseEnv?.[key];
    if (typeof value === "string" && value !== "") env[key] = value;
  }
  Object.assign(env, {
    HOME: paths.home,
    TMPDIR: paths.tmp,
    XDG_CONFIG_HOME: paths.xdgConfig,
    PI_WEB_DATA_DIR: paths.data,
    PI_WEB_CONFIG: paths.config,
    PI_WEB_PROJECTS_FILE: paths.projects,
    PI_WEB_MACHINES_FILE: paths.machines,
    PI_WEB_SESSIOND_SOCKET: paths.socket,
    PI_WEB_PORT: String(webPort),
    PI_WEB_HOST: "127.0.0.1",
    PI_WEB_ALLOWED_HOSTS: "true",
    PI_WEB_AGENT_DIR: paths.agent,
    PI_CODING_AGENT_DIR: paths.agent,
    PI_WEB_AGENT_SESSION_DIR: paths.sessions,
    PI_CODING_AGENT_SESSION_DIR: paths.sessions,
    PI_WEB_FIXTURE_OWNED_ROOT: paths.root,
    PI_WEB_FIXTURE_ROOT: paths.fixture,
    PI_WEB_FIXTURE_MANIFEST: paths.fixtureManifest,
    PI_WEB_OFFLINE: "1",
    PI_OFFLINE: "1",
    PI_WEB_SKIP_VERSION_CHECK: "1",
    PI_WEB_SPAWN_SESSIONS: "0",
    PI_WEB_SUBSESSIONS: "0",
    NO_COLOR: "1",
  });
  return env;
}

export function assertIsolatedEnvironment(env, ownership) {
  const root = resolveRequiredRoot(ownership?.root);
  for (const key of REQUIRED_PATH_KEYS) {
    const value = env[key];
    if (typeof value !== "string" || value === "") throw new IsolationError(`${key} must be set`);
    assertOwnedPath(root, value, key);
  }
  assertOwnedPath(root, env.PI_WEB_FIXTURE_OWNED_ROOT, "PI_WEB_FIXTURE_OWNED_ROOT");
  assertOwnedPath(root, env.PI_WEB_FIXTURE_ROOT, "PI_WEB_FIXTURE_ROOT");
  if (env.PI_WEB_SESSIOND_URL !== undefined || env.PI_WEB_SESSIOND_PORT !== undefined) {
    throw new IsolationError("TCP/URL sessiond overrides are forbidden; the owned socket is required");
  }
  for (const key of Object.keys(env)) {
    if (FORBIDDEN_ENV_PATTERN.test(key)) throw new IsolationError(`Credential/provider/proxy environment variable is forbidden: ${key}`);
  }
  if (env.PI_WEB_OFFLINE !== "1" || env.PI_OFFLINE !== "1" || env.PI_WEB_SKIP_VERSION_CHECK !== "1") {
    throw new IsolationError("Offline and version-check guards must be enabled");
  }
  if (env.PI_WEB_PORT !== String(ownedPort(ownership?.webPort, "webPort"))) throw new IsolationError("PI_WEB_PORT is not the owned web port");
  if (ownership?.browserPort !== undefined) ownedPort(ownership.browserPort, "browserPort");
  return true;
}

export function assertOwnedPath(root, candidate, label = "path") {
  if (typeof candidate !== "string" || !isAbsolute(candidate)) throw new IsolationError(`${label} must be absolute`);
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return resolvedCandidate;
  throw new IsolationError(`${label} escapes the owned root`);
}

export async function verifyChildHomedir(env, root) {
  const { stdout } = await execFileAsync(process.execPath, ["-e", "process.stdout.write(require('node:os').homedir())"], { env });
  assertOwnedPath(root, stdout, "os.homedir()");
  if (resolve(stdout) !== resolve(env.HOME)) throw new IsolationError("os.homedir() does not resolve to the isolated HOME");
}

export async function terminateOwnedProcess(child, graceMs = 2_500) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  signalOwned(child, "SIGTERM");
  const timedOut = await Promise.race([exited.then(() => false), delay(graceMs).then(() => true)]);
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    signalOwned(child, "SIGKILL");
    await Promise.race([exited, delay(1_000)]);
  }
}

export async function assertExecutable(path, message = "Executable is unavailable") {
  try { await access(path, constants.X_OK); }
  catch { throw new IsolationError(`${message}: ${path}`); }
}

function signalOwned(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function resolveRequiredRoot(root) {
  if (typeof root !== "string" || root === "" || !isAbsolute(root)) throw new IsolationError("An absolute temporary root is required");
  const resolved = resolve(root);
  if (resolved === resolve("/") || resolved === resolve(process.env.HOME ?? "/nonexistent")) throw new IsolationError("Refusing unsafe isolation root");
  return resolved;
}

function ownedPort(value, label, optional = false) {
  if (optional && value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new IsolationError(`${label} must be an unprivileged integer port`);
  return value;
}

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
