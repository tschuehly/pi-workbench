import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertIsolatedEnvironment, createIsolatedPiWebStack, IsolationError } from "../scripts/lib/isolated-pi-web-stack.mjs";

test("constructs an allowlisted offline environment wholly under the owned root", async () => {
  const root = await mkdtemp(join(tmpdir(), "isolated-pi-web-test-"));
  const stack = await createIsolatedPiWebStack({
    root,
    webPort: 18504,
    browserPort: 19222,
    baseEnv: { PATH: "/bin", HOME: "/real-home", HTTPS_PROXY: "http://proxy", OPENAI_API_KEY: "secret" },
  });
  try {
    assert.equal(stack.env.PATH, "/bin");
    assert.equal(stack.env.HOME, join(stack.root, "home"));
    assert.equal(stack.env.HTTPS_PROXY, undefined);
    assert.equal(stack.env.OPENAI_API_KEY, undefined);
    assert.equal(stack.env.PI_WEB_SESSIOND_URL, undefined);
    assert.equal(stack.env.PI_WEB_SESSIOND_PORT, undefined);
    assert.equal(assertIsolatedEnvironment(stack.env, { root: stack.root, webPort: 18504, browserPort: 19222 }), true);
  } finally {
    await stack.cleanup();
  }
});

test("rejects paths, daemon overrides, credential variables, and foreign ports", async () => {
  const root = await mkdtemp(join(tmpdir(), "isolated-pi-web-test-"));
  const stack = await createIsolatedPiWebStack({ root, webPort: 18505, baseEnv: { PATH: "/bin" } });
  try {
    for (const patch of [
      { HOME: "/tmp/foreign-home" },
      { PI_WEB_SESSIOND_URL: "http://127.0.0.1:9999" },
      { ANTHROPIC_API_KEY: "secret" },
      { PI_WEB_PORT: "18506" },
    ]) {
      assert.throws(() => assertIsolatedEnvironment({ ...stack.env, ...patch }, { root, webPort: 18505 }), IsolationError);
    }
  } finally {
    await stack.cleanup();
  }
});

test("refuses to adopt and later delete a pre-existing non-empty root", async () => {
  const root = await mkdtemp(join(tmpdir(), "isolated-pi-web-test-"));
  await writeFile(join(root, "foreign-marker"), "do not adopt\n", "utf8");
  await assert.rejects(() => createIsolatedPiWebStack({ root, webPort: 18507, baseEnv: { PATH: "/bin" } }), IsolationError);
  await rm(root, { recursive: true });
});

test("cleanup terminates the owned process group and removes the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "isolated-pi-web-test-"));
  const stack = await createIsolatedPiWebStack({ root, webPort: 18508, baseEnv: { PATH: process.env.PATH } });
  const child = stack.spawnOwned("sleeper", process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: root, stdio: "ignore" });
  await new Promise((resolve) => child.once("spawn", resolve));
  const receipt = await stack.cleanup();
  assert.deepEqual(receipt, { processes: [{ name: "sleeper", exited: true }], rootRemoved: true });
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await assert.rejects(() => rm(root), { code: "ENOENT" });
});
