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
 * Both extensions load in the same Pi process, so `checkpointBarrier(sessionId)` returns
 * one instance per session; `createCheckpointBarrier()` exists for isolated tests. The
 * PI WEB session daemon hosts many sessions in one process, so a process-wide barrier
 * would let one session's checkpoint hold, and its key collisions drop, every other
 * session's child wakes.
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
     * Returns true when the caller must not send now. Repeat keys collapse, so the
     * coalesced completion signal releases once under its stable key while a
     * receipt-failure wake keyed by its own execution stays distinct.
     */
    defer(send, key) {
      if (state === "idle") return false;
      queued.set(key ?? `anonymous:${(anonymous += 1)}`, send);
      return true;
    },

    /**
     * Called right after the checkpoint result is sent. That send starts a turn, and Pi marks
     * the session streaming only after its async before_agent_start; a wake sent in that gap
     * runs a second concurrent prompt that throws and wedges the session (every later prompt
     * fails instantly). Keep holding wakes until `turnBoundary()`.
     */
    handOff() {
      if (state !== "idle") state = "releasing";
      return state;
    },

    /**
     * agent_start (Pi now queues wakes as steer/followUp) or agent_settled (Pi defers and
     * serializes triggered sends): queued wakes are safe to send. Idempotent.
     */
    turnBoundary() {
      return state === "releasing" ? this.release() : 0;
    },

    /** Flushes every queued wake once. */
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

// ponytail: entries live for the process; one small idle object per lead session.
const bySession = new Map();

export function checkpointBarrier(sessionId) {
  if (typeof sessionId !== "string" || sessionId === "") throw new Error("checkpointBarrier needs a session id");
  let barrier = bySession.get(sessionId);
  if (barrier === undefined) bySession.set(sessionId, (barrier = createCheckpointBarrier()));
  return barrier;
}
