// Test-only trusted harness control flow, not an unforgeable production capability/process manager.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedRoot } from "./lock-owner-child.mjs";
import { completeInitialization, ensureMarker, inspectMarker, PROTOCOL_TEST } from "../../src/lock-protocol.js";
import { fail } from "../../src/errors.js";

// Importing an internal function or presenting an exit boolean/raw object does not supply supervisor proof.
export async function reconcileConstruction() { throw new Error("Requires retained fresh-root construction supervisor; caller proof is not accepted"); }

export async function createConstructionSupervisor(options = {}) {
  assert.equal(Object.keys(options).length, 0, "supervisor must create a fresh root, never accept a pre-existing directory");
  const root = await isolatedRoot();
  const directory = await mkdtemp(join(root, "construction-"));
  const canonical = await realpath(directory);
  const identity = await lstat(directory);
  const token = randomUUID();
  let child, exit, exitObserved = false, assigned = false, ambiguous = false, killTimer;
  return {
    directory,
    async start({ phase = "initialized" } = {}) {
      if (assigned) { ambiguous = true; throw new Error("multiple constructor assignments are forbidden"); }
      assert.ok(["mkdir", "initialized"].includes(phase));
      assigned = true;
      child = fork(fileURLToPath(import.meta.url), [directory], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
      // Install the actual retained handle's exit listener BEFORE sending the token/start instruction.
      exit = new Promise((done) => child.once("exit", (code, signal) => {
        exitObserved = true;
        clearTimeout(killTimer);
        done({ code, signal });
      }));
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      const ready = new Promise((done, reject) => {
        child.once("error", reject);
        child.on("message", (message) => {
          if (message.event === "barrier") done(message);
          else reject(new Error("unexpected construction child message"));
        });
        exit.then(() => reject(new Error("construction child exited before barrier")));
      });
      child.send({ token, phase });
      await ready;
    },
    async stop() {
      assert.ok(child && exit, "requires retained actual child");
      if (!exitObserved) child.kill("SIGKILL");
      return exit;
    },
    async complete() {
      assert.ok(assigned && child && exitObserved, "actual retained-child exit must be observed");
      assert.equal(ambiguous, false, "multiple constructors make scope ambiguous");
      assert.equal(await realpath(directory), canonical, "changed owned root");
      const current = await lstat(directory);
      assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino, "changed owned root identity");
      const state = await inspectMarker(directory);
      if (state.complete) return; // Authoritative protocol: idempotent no-op, not reusable recovery authority.
      if (!state.initialization || state.initialization.operationToken !== token) {
        fail("STORE_BUSY", "Construction supervisor requires matching complete on-disk initialization; use attended migration.");
      }
      // All three proofs checked above; the shared primitive independently revalidates disk state.
      await completeInitialization(directory, token);
    },
    async dispose() {
      if (child && !exitObserved) child.kill("SIGKILL");
      if (exit) await exit;
      clearTimeout(killTimer);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = await isolatedRoot();
  const directory = process.argv[2];
  assert.ok(directory.startsWith(`${root}/`));
  assert.equal(await realpath(directory), directory);
  assert.ok(process.send);
  const watchdog = setTimeout(() => process.exit(70), 8_000);
  try {
    const { token, phase } = await new Promise((done) => process.once("message", done));
    await ensureMarker(directory, { [PROTOCOL_TEST]: { token, hook: async (current) => {
      if (current === phase) {
        process.send({ event: "barrier" });
        await new Promise(() => {});
      }
    } } });
  } finally { clearTimeout(watchdog); }
}
