// Phase-0 process fixture, not a Pi worker. Parent owns the root and this process handle.
import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { FileWorkstreamAdapter } from "../../src/index.js";
import { TRANSACTION_TEST } from "../../src/adapters.js";
import { FileWorkstreamAdapter as LegacyFileWorkstreamAdapter } from "./legacy-adapters.js";

export const isolationVariables = ["PI_TMP", "PI_WORKBENCH_WORKSTREAM_DIR", "TMPDIR", "HOME"];

// Only absent variables permit discovery skips. Empty or invalid values must fail.
export function missingIsolation() {
  return isolationVariables.filter((key) => !Object.hasOwn(process.env, key));
}

function below(parent, path) {
  const subpath = relative(parent, path);
  return subpath && !isAbsolute(subpath) && subpath !== ".." && !subpath.startsWith(`..${sep}`);
}

export async function isolatedRoot() {
  for (const key of isolationVariables) assert.ok(process.env[key], `${key} is required and must not be empty`);
  const root = await realpath(process.env.PI_WORKBENCH_WORKSTREAM_DIR);
  const parent = await realpath(process.env.PI_TMP);
  assert.ok(below(parent, root), "root must be owned beneath PI_TMP");
  assert.equal(await realpath(process.env.TMPDIR), root, "TMPDIR must equal the isolated root");
  assert.ok(below(root, await realpath(homedir())), "HOME must be disposable beneath the isolated root");
  return root;
}

// Importing the isolation guard does not launch the fixture.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = await isolatedRoot();
  const [mode, directory, phase] = process.argv.slice(2);
  assert.equal(await realpath(directory), directory);
  assert.ok(directory.startsWith(`${root}${sep}`), "child directory must be below the isolated root");
  assert.ok(process.send, "fixture requires parent IPC");
  const watchdog = setTimeout(() => process.exit(70), 8_000);
  const release = new Promise((resolve) => process.once("message", (message) => {
    assert.equal(message, "release");
    resolve();
  }));
  const ready = () => process.send({ event: "acquired", mode, version: process.version });
  try {
    if (mode === "legacy" || mode === "candidate" || mode === "candidate-write") {
      const Adapter = mode === "legacy" ? LegacyFileWorkstreamAdapter : FileWorkstreamAdapter;
      await new Adapter({ directory, lockTimeoutMs: 200, [TRANSACTION_TEST]: { hook: async (current) => {
        if (phase === current) {
          process.send({ event: current, mode, version: process.version });
          await release;
        }
      } } }).transaction(async () => {
        if (!phase) { ready(); await release; }
      }, { readOnly: mode !== "candidate-write" });
    } else if (mode === "sqlite") {
      const { DatabaseSync } = await import("node:sqlite");
      const database = new DatabaseSync(join(directory, ".workstreams-lock.sqlite"));
      try {
        database.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
        ready();
        await release;
        database.exec("COMMIT");
      } finally {
        database.close();
      }
    } else {
      throw new Error(`unknown fixture mode: ${mode}`);
    }
  } finally {
    clearTimeout(watchdog);
    process.disconnect();
  }
}
