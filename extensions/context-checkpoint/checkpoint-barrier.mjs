/**
 * Session-local barrier that makes a context checkpoint atomic.
 *
 * A background child can reach terminal completion between the moment
 * `compact_and_continue` is accepted and the moment compaction settles. Its wakeup
 * asks for a turn, so without a barrier that turn either races the compaction
 * boundary or is swallowed by it. The barrier holds turn-triggering child wakes from
 * the instant the checkpoint is accepted until the checkpoint result has been
 * delivered, then releases them exactly once.
 *
 * Both extensions load in the same Pi process, so `checkpointBarrier()` returns one
 * shared instance; `createCheckpointBarrier()` exists for isolated tests.
 */
export function createCheckpointBarrier() {
  let state = "idle";
  const queued = new Map();
  let anonymous = 0;

  return {
    get state() {
      return state;
    },

    get queuedCount() {
      return queued.size;
    },

    /** An accepted checkpoint blocks child wakes immediately, before `agent_settled`. */
    open() {
      if (state === "idle") state = "pending";
      return state;
    },

    /** Compaction has started; keep blocking. */
    beginCompaction() {
      if (state === "pending") state = "compacting";
      return state;
    },

    /**
     * Queues a turn-triggering send while a checkpoint is pending or compacting.
     * Returns true when the caller must not send now. Repeat keys collapse, so one
     * execution can only wake the lead once.
     */
    defer(send, key) {
      if (state === "idle") return false;
      queued.set(key ?? `anonymous:${(anonymous += 1)}`, send);
      return true;
    },

    /** Called after the checkpoint result is delivered; flushes every queued wake once. */
    release() {
      if (state === "idle") return 0;
      state = "idle";
      const sends = [...queued.values()];
      queued.clear();
      for (const send of sends) send();
      return sends.length;
    },

    /** Session shutdown suppresses late wakes rather than delivering them. */
    dispose() {
      state = "idle";
      queued.clear();
    },
  };
}

const shared = createCheckpointBarrier();

export function checkpointBarrier() {
  return shared;
}
