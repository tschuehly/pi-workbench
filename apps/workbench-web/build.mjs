import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const clientDist = resolve(root, 'dist');
await rm(clientDist, { recursive: true, force: true });
await mkdir(clientDist);
for (const file of ['index.html', 'pi-web-shell.css', 'main.mjs', 'client.mjs', 'catalog.mjs', 'workstreams.mjs', 'workstream-host.mjs', 'workstream-launch.mjs', 'roster.mjs', 'files.mjs', 'NOTICE.md', 'LICENSE-PI-WEB.txt']) await cp(resolve(root, file), resolve(clientDist, file));
// Reuse the validating Workbench service client, not a PI WEB frontend module.
await cp(resolve(root, '../../packages/pi-web-integration/workstream-client.js'), resolve(clientDist, 'workstream-client.js'));
await cp(resolve(root, '../../packages/workstream-session-coordination/src/index.js'), resolve(clientDist, 'coordination.mjs'));
await cp(resolve(root, '../../packages/pi-web-integration/workstream-client.js'), resolve(clientDist, 'workstream-client.mjs'));
console.log(clientDist);
