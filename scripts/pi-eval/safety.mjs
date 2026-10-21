import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, rmSync, statfsSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function parseDeadline(value) {
  if (value === undefined) return Infinity;
  const ms = typeof value === 'number' ? value : /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new Error('Invalid absolute evaluation deadline');
  return ms;
}
// Freeze once in the trusted parent, never reread candidate-controlled environment.
const DEADLINE = parseDeadline(process.env.PI_EVAL_DEADLINE_AT);
export const cleanupDeadline = () => Math.min(Date.now() + 120000, DEADLINE + 120000);
export function remainingTimeout(configured, deadlineAt = DEADLINE) {
  const remaining = deadlineAt - Date.now();
  if (!(remaining > 0)) throw new Error('Absolute evaluation deadline exceeded');
  return Math.max(1, Math.min(configured, remaining));
}
// Resolve existing ancestors too: new scratch paths must not hide a symlink escape.
export function canonical(p) {
  if (existsSync(p)) return realpathSync(p);
  const parent = path.dirname(p);
  return parent === p ? p : path.join(canonical(parent), path.basename(p));
}
export const inside = (root, p) => p === root || p.startsWith(root + path.sep);
export function commandTimeout(seconds = 900) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) throw new Error('Invalid timeout: finite positive seconds required');
  return Math.min(seconds, 900);
}
export function requireDisk(available = () => { const s = statfsSync(homedir()); return s.bavail * s.bsize; }, show = () => {
  const r = spawnSync('df', ['-h', homedir()], { encoding: 'utf8', timeout: 5000 });
  process.stderr.write(r.stdout ?? 'df unavailable\n');
}) {
  show();
  let bytes;
  try { bytes = available(); } catch { throw new Error('Disk preflight unavailable'); }
  if (!Number.isFinite(bytes) || bytes < 20_000_000_000) throw new Error(`Disk preflight: need >=20GB, available=${bytes ?? 'unknown'}`);
  return bytes;
}
// Native Pi uses SIGKILL on the detached process group. Use the same ordinary-descendant boundary
// for trusted shell paths; spawnSync's own timeout kills only its immediate child.
export async function runProcess(command, args, { cwd, env = process.env, timeoutMs = 900000, maxTimeoutMs = 900000, termGraceMs = 0, beforeLaunch = requireDisk, wait, deadlineAt = DEADLINE } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid process timeout');
  remainingTimeout(1, deadlineAt);
  beforeLaunch();
  if (wait) { await wait(); beforeLaunch(); }
  if (process.env.PI_EVAL_PROCESS_LEDGER) appendFileSync(process.env.PI_EVAL_PROCESS_LEDGER, '');
  timeoutMs = remainingTimeout(Math.min(timeoutMs, maxTimeoutMs), deadlineAt);
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (process.env.PI_EVAL_PROCESS_LEDGER && child.pid) {
      const identity = spawnSync('ps', ['-o', 'lstart=', '-p', String(child.pid)], {encoding:'utf8',timeout:Math.max(1,Math.min(1000,timeoutMs))}).stdout?.trim();
      appendFileSync(process.env.PI_EVAL_PROCESS_LEDGER, JSON.stringify({pid:child.pid,pgid:child.pid,startIdentity:identity,startedAt:new Date(started).toISOString(),command,deadlineAt:Number.isFinite(deadlineAt)?deadlineAt:null,timeoutMs})+'\n');
    }
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.setEncoding('utf8').on('data', d => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', d => { stderr += d; });
    let force;
    const grace = Math.min(termGraceMs, Math.max(0, timeoutMs - 1));
    const kill = signal => { try { process.kill(-child.pid, signal); } catch {} };
    const timer = setTimeout(() => {
      timedOut = true;
      kill(grace ? 'SIGTERM' : 'SIGKILL');
      if (grace) force = setTimeout(() => kill('SIGKILL'), Math.max(0, started + timeoutMs - Date.now()));
    }, Math.max(0, started + timeoutMs - grace - Date.now()));
    child.once('error', error => { clearTimeout(timer); clearTimeout(force); resolve({ status: null, stdout, stderr, error: String(error), elapsedMs: Date.now() - started }); });
    child.once('close', status => { clearTimeout(timer); clearTimeout(force); resolve({ status, stdout, stderr, timedOut, elapsedMs: Date.now() - started }); });
  });
}
export function shell(command, { timeout = 900000, preflight = true, env = process.env, deadlineAt = DEADLINE, ...opts } = {}) {
  if (preflight) requireDisk();
  const timeoutMs = remainingTimeout(commandTimeout(timeout / 1000) * 1000, deadlineAt);
  // Trusted setup/check/reference/cleanup must not inherit the candidate-only Gradle policy.
  env = { ...env }; delete env.PI_EVAL_ROUND_TOKEN;
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--shell'], {
    encoding: 'utf8', maxBuffer: 1 << 28, input: JSON.stringify({ command, opts: { ...opts, env, timeoutMs, deadlineAt: Number.isFinite(deadlineAt) ? deadlineAt : null } }),
    timeout: timeoutMs + 10000, killSignal: 'SIGKILL',
  });
  if (r.error) throw r.error;
  try { return JSON.parse(r.stdout); } catch { throw new Error(`Bounded shell failed: ${r.stderr}`); }
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--shell') {
  const { command, opts } = JSON.parse(readFileSync(0, 'utf8'));
  opts.deadlineAt ??= Infinity;
  process.stdout.write(JSON.stringify(await runProcess('bash', ['-o', 'pipefail', '-c', command], { ...opts, beforeLaunch: () => {} })));
}
export function copyToolGuard(trialDir) {
  const dir = path.join(trialDir, '.harness'); mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'guard.mjs');
  copyFileSync(path.join(HERE, 'guard.mjs'), file);
  return { file, hash: hash(readFileSync(file)) };
}
export function sandboxProfile(trialDir, { neutral = false } = {}) {
  const real = p => existsSync(p) ? realpathSync(p) : p;
  const projects = real(path.resolve(ROOT, '..'));
  const home = homedir();
  const deny = [projects, canonical(path.join(home, '.pi-workbench/tmp')), ...(process.env.PI_TMP && !inside(canonical(trialDir), canonical(process.env.PI_TMP)) ? [canonical(process.env.PI_TMP)] : []), real(process.env.PI_EVAL_HOME ?? path.join(home, '.pi-workbench/evals')), ...['results', 'scratch', 'reviews', 'handoffs', 'workers', 'workstreams', 'reports'].map(d => real(path.join(home, '.pi-workbench', d))), real(path.join(home, '.pi/agent/sessions')), real(path.join(home, '.pi-web'))];
  // Installed startup extensions stay readable; neutral judges never open an arm/case directory.
  const allow = [real(trialDir), ...readdirSync(projects).filter(d => d.endsWith('.installed') || d === 'pi-extensions').map(d => real(path.join(projects, d)))];
  const rule = (verb, p) => `(${verb} file-read-data (subpath ${JSON.stringify(p)}))`;
  return `(version 1)(allow default)${deny.map(p => rule('deny', p)).join('')}${allow.map(p => rule('allow', p)).join('')}`;
}
export function createGradleGuard(ownedRoot, { home = homedir(), token = randomUUID() } = {}) {
  if (!/^[a-zA-Z0-9-]+$/.test(token)) throw new Error('Invalid round token');
  const root = realpathSync(ownedRoot);
  const dir = path.join(home, '.gradle/init.d'); mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pi-eval-next-round-${token}.gradle`);
  const content = readFileSync(path.join(HERE, 'guard.gradle'), 'utf8')
    .replaceAll('__ROUND_TOKEN__', token).replaceAll('__OWNED_ROOT__', root.replaceAll('\\', '\\\\').replaceAll("'", "\\'"));
  writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
  const {dev, ino, uid} = statSync(file);
  return { file, hash: hash(content), owner: {dev, ino, uid}, token, root, env: { PI_EVAL_ROUND_TOKEN: token } };
}
export function removeGradleGuard(guard) {
  if (!existsSync(guard.file)) return false;
  const s = statSync(guard.file);
  if (!guard.owner || !['dev','ino','uid'].every(k => s[k] === guard.owner[k]) || hash(readFileSync(guard.file)) !== guard.hash) return false;
  rmSync(guard.file); return true;
}
