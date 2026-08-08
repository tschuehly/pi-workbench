import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PACKAGES_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BROWSER_PACKAGE_NAMES = ["pi-web-integration", "workstream-session-coordination"];

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !path.startsWith(sep));
}

async function browserModuleGraph(entry) {
  const root = await realpath(PACKAGES_ROOT);
  const allowedRoots = await Promise.all(BROWSER_PACKAGE_NAMES.map((name) => realpath(resolve(root, name))));
  const queue = [resolve(root, entry)];
  const visited = new Set();
  while (queue.length > 0) {
    const modulePath = await realpath(queue.shift());
    if (visited.has(modulePath)) continue;
    assert.equal(inside(root, modulePath), true, `${modulePath} escapes the declared PI WEB plugin root`);
    assert.equal(allowedRoots.some((allowed) => inside(allowed, modulePath)), true, `${modulePath} is not copied into the served browser package set`);
    visited.add(modulePath);
    const source = await readFile(modulePath, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier.startsWith(".")) queue.push(resolve(dirname(modulePath), specifier));
    }
  }
  return visited;
}

test("the packages PI WEB manifest serves the complete copied browser module graph", async () => {
  const pluginManifest = JSON.parse(await readFile(resolve(PACKAGES_ROOT, "package.json"), "utf8"));
  const integrationManifest = JSON.parse(await readFile(resolve(PACKAGES_ROOT, "pi-web-integration/package.json"), "utf8"));
  const plugin = pluginManifest.piWeb?.plugins?.find((candidate) => candidate.id === "pi-workbench");
  assert.deepEqual(plugin, {
    id: "pi-workbench",
    module: "pi-web-integration/pi-web-plugin.js",
    service: "pi-web-integration/workstream-service.js",
  });
  assert.equal(integrationManifest.piWeb, undefined, "the nested package must not advertise an unservable plugin root");

  const modules = await browserModuleGraph(plugin.module);
  assert.equal(modules.has(await realpath(resolve(PACKAGES_ROOT, "workstream-session-coordination/src/index.js"))), true);
});
