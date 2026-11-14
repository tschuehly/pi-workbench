import assert from "node:assert/strict";
import test from "node:test";
import { nodeBin } from "./node-bin.mjs";

test("falls back to PATH's node once an upgrade deletes the running binary", () => {
  const real = process.execPath;
  assert.equal(nodeBin(), real);
  try {
    process.execPath = "/opt/homebrew/Cellar/node@24/gone/bin/node";
    assert.equal(nodeBin(), "node");
  } finally {
    process.execPath = real;
  }
});
