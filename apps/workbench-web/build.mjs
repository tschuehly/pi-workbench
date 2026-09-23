import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const clientDist = resolve(root, 'dist');
await rm(clientDist, { recursive: true, force: true });
await mkdir(clientDist);
for (const file of ['index.html', 'main.mjs', 'client.mjs', 'catalog.mjs', 'NOTICE.md', 'LICENSE-PI-WEB.txt']) await cp(resolve(root, file), resolve(clientDist, file));
console.log(clientDist);
