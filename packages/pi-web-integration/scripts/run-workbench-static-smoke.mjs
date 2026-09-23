#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createIsolatedPiWebStack } from './lib/isolated-pi-web-stack.mjs';

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
const stack = await createIsolatedPiWebStack({ root, webPort: port, ownedClientDist: clientDist });
const tsx = join(piWebRoot, 'node_modules/.bin/tsx');
const log = [];
try {
  await writeFile(stack.paths.config, `${JSON.stringify({ host: '127.0.0.1', port, allowedHosts: true, spawnSessions: false, subsessions: false, pathAccess: { allowedPaths: [root] } })}\n`);
  const invalid = spawnSync(tsx, ['src/server/index.ts'], { cwd: piWebRoot, env: { ...stack.env, PI_WEB_CLIENT_DIST: './relative-client' }, timeout: 10_000, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0, 'relative static root must fail closed');
  assert.match(invalid.stderr, /PI_WEB_CLIENT_DIST must be an absolute directory containing index.html/);
  if (native) {
    const daemon = stack.spawnOwned('sessiond', tsx, ['src/server/sessiond.ts'], { cwd: piWebRoot });
    daemon.stderr.on('data', chunk => log.push(String(chunk).slice(-2000)));
    for (let i = 0; i < 120; i++) {
      if (daemon.exitCode !== null) throw new Error(`Isolated sessiond exited: ${log.join('').slice(-3000)}`);
      try { await access(stack.paths.socket); break; } catch { await delay(100); }
    }
    await access(stack.paths.socket);
  }
  const web = stack.spawnOwned('production-web', tsx, ['src/server/index.ts'], { cwd: piWebRoot });
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
  }
  console.log(JSON.stringify({ type: 'STATIC_SMOKE', status: 'passed', productionEntrypoint: 'src/server/index.ts', ownedIndex: true, ownedModule: true, api: true, invalidRootRejected: true }));
} finally {
  const cleaned = await stack.cleanup();
  console.log(JSON.stringify({ type: 'CLEANUP_RESULT', ...cleaned }));
}
