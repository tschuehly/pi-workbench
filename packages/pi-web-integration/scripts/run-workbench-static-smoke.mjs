#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createIsolatedPiWebStack, terminateOwnedProcess } from './lib/isolated-pi-web-stack.mjs';
import { createUserLocalWorkstreamStore } from '../../../packages/workstream-store/src/index.js';

const [piWebPath, clientPath, option] = process.argv.slice(2);
const native = option === '--native';
if (!piWebPath || !clientPath || (option && !native)) throw new Error('Usage: run-workbench-static-smoke.mjs PI_WEB_ROOT OWNED_CLIENT_DIST [--native]');
if (native && process.platform !== 'darwin') throw new Error('Native smoke requires macOS');
const piWebRoot = resolve(piWebPath), clientDist = resolve(clientPath);
const expectedIndex = await readFile(join(clientDist, 'index.html'), 'utf8');
const expectedMain = await readFile(join(clientDist, 'main.mjs'), 'utf8');
const server = createServer();
await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
const port = server.address().port;
await new Promise(ok => server.close(ok));
const root = await mkdtemp(join(tmpdir(), 'pw-static-'));
const selectedClient = join(root, 'selected-client');
const stack = await createIsolatedPiWebStack({ root, webPort: port, ownedClientDist: native ? selectedClient : clientDist });
if (native) await symlink(clientDist, selectedClient);
const tsx = join(piWebRoot, 'node_modules/.bin/tsx');
const log = [];
try {
  await writeFile(stack.paths.config, `${JSON.stringify({ host: '127.0.0.1', port, allowedHosts: true, spawnSessions: false, subsessions: false, pathAccess: { allowedPaths: [root] } })}\n`);
  const invalid = spawnSync(tsx, ['src/server/index.ts'], { cwd: piWebRoot, env: { ...stack.env, PI_WEB_CLIENT_DIST: './relative-client' }, timeout: 10_000, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0, 'relative static root must fail closed');
  assert.match(invalid.stderr, /PI_WEB_CLIENT_DIST must be an absolute directory containing index.html/);
  let daemonProcess;
  if (native) {
    daemonProcess = stack.spawnOwned('sessiond', tsx, ['src/server/sessiond.ts'], { cwd: piWebRoot });
    daemonProcess.stderr.on('data', chunk => log.push(String(chunk).slice(-2000)));
    for (let i = 0; i < 120; i++) {
      if (daemonProcess.exitCode !== null) throw new Error(`Isolated sessiond exited: ${log.join('').slice(-3000)}`);
      try { await access(stack.paths.socket); break; } catch { await delay(100); }
    }
    await access(stack.paths.socket);
  }
  let web = stack.spawnOwned('production-web', tsx, ['src/server/index.ts'], { cwd: piWebRoot });
  web.stdout.on('data', chunk => log.push(String(chunk).slice(-2000)));
  web.stderr.on('data', chunk => log.push(String(chunk).slice(-2000)));
  let response;
  for (let i = 0; i < 120; i++) {
    if (web.exitCode !== null) throw new Error(`Production web exited: ${log.join('').slice(-3000)}`);
    try { response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); break; }
    catch { await delay(100); }
  }
  if (!response) throw new Error(`Production web did not listen: ${log.join('').slice(-3000)}`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), expectedIndex);
  const main = await fetch(`http://127.0.0.1:${port}/main.mjs`);
  assert.equal(main.status, 200);
  assert.equal(await main.text(), expectedMain);
  const version = await fetch(`http://127.0.0.1:${port}/api/pi-web/version`);
  assert.equal(version.status, 200);
  const report = await version.json();
  assert.equal(report.packageName, '@jmfederico/pi-web');
  if (native) {
    for (let i = 0; i < 120 && (!report.components.web.available || !report.components.sessiond.available); i++) {
      await delay(100);
      Object.assign(report, await (await fetch(`http://127.0.0.1:${port}/api/pi-web/version`)).json());
    }
    for (const component of [report.components.web, report.components.sessiond]) {
      assert.equal(component.available, true);
      assert.equal(component.stale, false);
      assert.equal(resolve(component.installation.path), piWebRoot);
    }
    const fakeCli = join(root, 'status-only-cli');
    const forbidden = join(root, 'forbidden-cli-command');
    await writeFile(fakeCli, `#!/bin/sh\nif [ "$1" = status ]; then exit 0; fi\nprintf '%s\\n' "$*" > '${forbidden}'\nexit 1\n`, { mode: 0o700 });
    const appPath = join(root, 'Pi Workbench.app');
    const install = spawnSync('bash', ['apps/pi-web-macos/Scripts/install-app.sh', '--app-only'], {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: { ...stack.env, PI_WEB_APP_PATH: appPath, PI_WEB_COMMAND_DIR: join(root, 'bin'), PI_WEB_DIR: piWebRoot, PI_WEB_CLI: fakeCli, PI_WEB_URL: `http://127.0.0.1:${port}`, SWIFTPM_BUILD_DIR: join(root, 'swift-build') },
      encoding: 'utf8', timeout: 120_000,
    });
    assert.equal(install.status, 0, `Isolated app-only install failed: ${install.stderr}`);
    const bundle = join(appPath, 'Contents/MacOS/PIWebMac');
    await access(bundle);
    const priorLog = log.length;
    const app = stack.spawnOwned('native-app', bundle, [], { cwd: root });
    app.stderr.on('data', chunk => log.push(String(chunk).slice(-2000)));
    for (let i = 0; i < 200; i++) {
      if (app.exitCode !== null) throw new Error(`Native app exited: ${log.join('').slice(-3000)}`);
      if (log.slice(priorLog).join('').includes('"url":"/main.mjs"')) break;
      await delay(100);
    }
    assert.match(log.slice(priorLog).join(''), /"url":"\/main\.mjs"/, 'Native WKWebView did not load owned module');
    await assert.rejects(access(forbidden), { code: 'ENOENT' });
    console.log(JSON.stringify({ type: 'NATIVE_SMOKE', status: 'passed', appOnly: true, isolatedReadiness: true, nativeOwnedModuleRequest: true, lifecycleCommand: false }));

    // Revert only the static client selection. Keep the same native bundle, backend
    // revision, socket-bound daemon, and durable state; never downgrade a data format.
    const priorClient = join(root, 'prior-client');
    await cp(join(piWebRoot, 'dist/client'), priorClient, { recursive: true });
    const priorIndex = await readFile(join(priorClient, 'index.html'), 'utf8');
    assert.notEqual(priorIndex, expectedIndex, 'Rollback requires a distinct previous client');
    const sessionCwd = join(root, 'workspace');
    await mkdir(sessionCwd);
    const { SessionManager } = await import(pathToFileURL(join(piWebRoot, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href);
    const sessionId = randomUUID();
    const session = SessionManager.create(sessionCwd, stack.paths.sessions, { id: sessionId });
    session.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Rollback preserves this session' }], timestamp: Date.now() });
    session.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Stored before client rollback' }], api: 'anthropic-messages', provider: 'fixture', model: 'no-model', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() });
    const store = createUserLocalWorkstreamStore({ directory: stack.paths.workstreams });
    const created = await store.create({ workstreamId: 'ws-isolated-rollback', idempotencyKey: 'rollback-create', title: 'Rollback state', producer: 'fixture' });
    const before = await Promise.all([directoryDigest(stack.paths.sessions), directoryDigest(stack.paths.workstreams)]);
    const configBefore = await readFile(stack.paths.config);
    const backendBefore = await readFile(join(piWebRoot, 'src/server/index.ts'));
    const backup = join(root, 'state-backup');
    await mkdir(backup);
    await cp(stack.paths.sessions, join(backup, 'sessions'), { recursive: true });
    await cp(stack.paths.workstreams, join(backup, 'workstreams'), { recursive: true });
    await cp(stack.paths.config, join(backup, 'config.json'));
    await access(stack.paths.socket);
    await terminateOwnedProcess(web);
    await unlink(selectedClient);
    await symlink(priorClient, selectedClient);
    web = stack.spawnOwned('production-web-rollback', tsx, ['src/server/index.ts'], { cwd: piWebRoot });
    web.stderr.on('data', chunk => log.push(String(chunk).slice(-2000)));
    let restored;
    for (let i = 0; i < 120; i++) {
      if (web.exitCode !== null) throw new Error(`Rollback web exited: ${log.join('').slice(-3000)}`);
      try { restored = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }); break; }
      catch { await delay(100); }
    }
    assert.equal(restored?.status, 200);
    assert.equal(await restored.text(), priorIndex);
    assert.deepEqual(await Promise.all([directoryDigest(stack.paths.sessions), directoryDigest(stack.paths.workstreams)]), before);
    assert.deepEqual(await Promise.all([directoryDigest(join(backup, 'sessions')), directoryDigest(join(backup, 'workstreams'))]), before);
    assert.deepEqual(await readFile(stack.paths.config), configBefore);
    assert.deepEqual(await readFile(join(backup, 'config.json')), configBefore);
    assert.deepEqual(await readFile(join(piWebRoot, 'src/server/index.ts')), backendBefore);
    assert.equal((await store.inspect('ws-isolated-rollback')).revision, created.acceptedRevision);
    assert.ok((await SessionManager.list(sessionCwd, stack.paths.sessions)).some(entry => entry.id === sessionId));
    await access(stack.paths.socket);
    assert.equal(daemonProcess.exitCode, null, 'Session daemon must remain running throughout rollback');
    await assert.rejects(access(forbidden), { code: 'ENOENT' });
    console.log(JSON.stringify({ type: 'ROLLBACK_SMOKE', status: 'passed', priorClientRestored: true, stateBackupMatches: true, sessionBytesUnchanged: true, workstreamBytesUnchanged: true, configurationUnchanged: true, sameBackendRevision: true, daemonSocketRetained: true, lifecycleCommand: false }));
  }
  console.log(JSON.stringify({ type: 'STATIC_SMOKE', status: 'passed', productionEntrypoint: 'src/server/index.ts', ownedIndex: true, ownedModule: true, api: true, invalidRootRejected: true }));
} finally {
  const cleaned = await stack.cleanup();
  console.log(JSON.stringify({ type: 'CLEANUP_RESULT', ...cleaned }));
}

async function directoryDigest(root) {
  const hash = createHash('sha256');
  async function visit(directory, prefix = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(prefix, entry.name), path = join(directory, entry.name);
      hash.update(name);
      if (entry.isDirectory()) await visit(path, name);
      else if (entry.isFile()) hash.update(await readFile(path));
      else throw new Error(`Unexpected state entry: ${name}`);
    }
  }
  await visit(root);
  return hash.digest('hex');
}
