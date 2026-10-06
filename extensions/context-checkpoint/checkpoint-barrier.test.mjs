import assert from "node:assert/strict";
import test from "node:test";
import { checkpointBarrier, createCheckpointBarrier } from "./checkpoint-barrier.mjs";

test("blocks from acceptance through compaction and releases queued wakes exactly once", () => {
  const barrier = createCheckpointBarrier();
  const sent = [];
  const wake = (id) => barrier.defer(() => sent.push(id), id);

  assert.equal(barrier.state, "idle");
  assert.equal(wake("before"), false, "an idle barrier never queues");

  assert.equal(barrier.open(), "pending");
  assert.equal(wake("during-pending"), true);
  assert.equal(barrier.beginCompaction(), "compacting");
  assert.equal(wake("during-compaction"), true);
  assert.deepEqual(sent, [], "no wake may fire before compaction settles");
  assert.equal(barrier.queuedCount, 2);

  assert.equal(barrier.release(), 2);
  assert.deepEqual(sent, ["during-pending", "during-compaction"]);
  assert.equal(barrier.state, "idle");
  assert.equal(barrier.queuedCount, 0);

  assert.equal(barrier.release(), 0, "a second release delivers nothing");
  assert.deepEqual(sent, ["during-pending", "during-compaction"]);
  assert.equal(wake("after"), false, "the barrier is transparent again");
});

test("collapses repeated wakes per key and keeps unkeyed wakes distinct", () => {
  const barrier = createCheckpointBarrier();
  const sent = [];
  barrier.open();

  barrier.defer(() => sent.push("first"), "execution-1");
  barrier.defer(() => sent.push("second"), "execution-1");
  barrier.defer(() => sent.push("failure"), "execution-1:failed");
  barrier.defer(() => sent.push("unkeyed-a"));
  barrier.defer(() => sent.push("unkeyed-b"));

  assert.equal(barrier.release(), 4);
  assert.deepEqual(sent, ["second", "failure", "unkeyed-a", "unkeyed-b"]);
});

test("shutdown suppresses queued wakes instead of delivering them late", () => {
  const barrier = createCheckpointBarrier();
  let sent = 0;
  barrier.open();
  barrier.defer(() => { sent += 1; }, "execution-1");

  barrier.dispose();

  assert.equal(barrier.state, "idle");
  assert.equal(barrier.queuedCount, 0);
  assert.equal(barrier.release(), 0);
  assert.equal(sent, 0);
});

test("both extensions share one barrier per session, never across sessions", () => {
  assert.equal(checkpointBarrier("session-a"), checkpointBarrier("session-a"));
  assert.notEqual(checkpointBarrier("session-a"), checkpointBarrier("session-b"));
  assert.throws(() => checkpointBarrier(undefined), /session id/);
});

test("one session's pending checkpoint neither holds nor replaces another session's wake", () => {
  // Regression: the PI WEB daemon hosts many sessions in one process. A process-wide barrier let
  // one session's checkpoint hold every session's child wakes for hours, and the shared
  // coalescing key let one session's wake replace another's.
  const sent = [];
  checkpointBarrier("busy").open();
  assert.equal(checkpointBarrier("busy").defer(() => sent.push("busy"), "attention:terminal-results"), true);
  assert.equal(checkpointBarrier("waiting").defer(() => sent.push("waiting"), "attention:terminal-results"), false);
  assert.equal(checkpointBarrier("busy").release(), 1);
  assert.deepEqual(sent, ["busy"]);
});
