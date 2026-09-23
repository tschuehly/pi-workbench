#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createIsolatedPiWebStack } from './lib/isolated-pi-web-stack.mjs';

const [piWebPath, clientPath] = process.argv.slice(2);
if (!piWebPath || !clientPath) throw new Error('Usage: run-workbench-static-smoke.mjs PI_WEB_ROOT OWNED_CLIENT_DIST');
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
  assert.equal((await version.json()).packageName, '@jmfederico/pi-web');
  console.log(JSON.stringify({ type: 'STATIC_SMOKE', status: 'passed', productionEntrypoint: 'src/server/index.ts', ownedIndex: true, ownedModule: true, api: true, invalidRootRejected: true }));
} finally {
  const cleaned = await stack.cleanup();
  console.log(JSON.stringify({ type: 'CLEANUP_RESULT', ...cleaned }));
}
