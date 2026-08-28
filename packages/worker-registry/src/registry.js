import { randomUUID } from "node:crypto";
import { fail } from "./errors.js";

const OUTCOMES = new Set(["success", "preflight_failed", "launch_failed", "execution_failed", "cancelled", "timed_out", "outcome_unknown"]);
const RECEIPT_LIMIT = 20;
const LINEAGE_LIMIT = 200;
const NAME_LIMIT = 120;
const SCOPE_LIMIT = 2_000;
const DIAGNOSTIC_LIMIT = 2_000;
const USAGE_LIMIT = 4_000;

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

export class WorkerRegistry {
  constructor({ adapter, clock = () => new Date(), isProcessAlive = defaultIsProcessAlive } = {}) {
    if (!adapter || typeof adapter.transaction !== "function") throw new TypeError("adapter with transaction() is required");
    this.adapter = adapter;
    this.clock = clock;
    this.isProcessAlive = isProcessAlive;
  }

  async create({ name, scope, profile, repositoryRoot, ownerSessionId } = {}) {
    requireBoundedString("name", name, NAME_LIMIT);
    requireBoundedString("scope", scope, SCOPE_LIMIT);
    requireBoundedString("profile", profile, NAME_LIMIT);
    requireBoundedString("repositoryRoot", repositoryRoot, 1_024);
    requireBoundedString("ownerSessionId", ownerSessionId, NAME_LIMIT);
    const record = {
      workerId: randomUUID(),
      name: name.trim(),
      scope: scope.trim(),
      profile: profile.trim(),
      repositoryRoot,
      ownerSessionId: ownerSessionId.trim(),
      createdAt: this.clock().toISOString(),
      sessionLineage: [],
      receipts: [],
      lock: null,
      lastLockRecovery: null,
      requiresInspection: null,
      retired: null,
    };
    return this.adapter.transaction((database) => {
      database.workers[record.workerId] = record;
      return structuredClone(record);
    });
  }

  async inspect(workerId) {
    return this.adapter.transaction((database) => structuredClone(this.#worker(database, workerId)), { readOnly: true });
  }

  async list({ ownerSessionId, includeRetired = false, all = false } = {}) {
    if (!all) requireBoundedString("ownerSessionId", ownerSessionId, NAME_LIMIT);
    const normalizedOwnerSessionId = ownerSessionId?.trim();
    return this.adapter.transaction((database) => {
      return Object.values(database.workers)
        .filter((worker) => all || worker.ownerSessionId === normalizedOwnerSessionId)
        .filter((worker) => all || includeRetired || worker.retired === null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((worker) => summarize(worker));
    }, { readOnly: true });
  }

  async beginDispatch(workerId, { pid, repositoryRoot, ownerSessionId, acknowledgeInspection = false } = {}) {
    if (!Number.isSafeInteger(pid) || pid <= 0) fail("INVALID_INPUT", "pid must be a positive integer");
    requireBoundedString("repositoryRoot", repositoryRoot, 1_024);
    requireBoundedString("ownerSessionId", ownerSessionId, NAME_LIMIT);
    ownerSessionId = ownerSessionId.trim();
    const now = this.clock().toISOString();
    return this.adapter.transaction((database) => {
      const worker = this.#worker(database, workerId);
      this.#requireOwner(worker, workerId, ownerSessionId);
      if (worker.retired !== null) fail("WORKER_RETIRED", `worker ${workerId} was retired at ${worker.retired.at}: ${worker.retired.reason}`);
      if (worker.repositoryRoot !== repositoryRoot) fail("REPOSITORY_MISMATCH", `worker ${workerId} is bound to ${worker.repositoryRoot}, not ${repositoryRoot}`);
      if (worker.requiresInspection !== null && acknowledgeInspection !== true) {
        fail("WORKER_INSPECTION_REQUIRED", `worker ${workerId} had an unknown outcome at ${worker.requiresInspection.at} (${worker.requiresInspection.diagnostic ?? "no diagnostic"}); inspect it, then dispatch with acknowledgeInspection`);
      }
      this.#reclaimDeadLock(worker, now);
      if (worker.lock !== null) fail("WORKER_BUSY", `worker ${workerId} has an active dispatch held by live process ${worker.lock.pid} since ${worker.lock.acquiredAt}`);
      if (acknowledgeInspection === true) worker.requiresInspection = null;
      worker.lock = { token: randomUUID(), pid, acquiredAt: now, heartbeatAt: now };
      return {
        lockToken: worker.lock.token,
        continuationSessionId: worker.sessionLineage.length === 0 ? null : worker.sessionLineage[worker.sessionLineage.length - 1],
        name: worker.name,
        scope: worker.scope,
        profile: worker.profile,
      };
    });
  }

  async heartbeat(workerId, lockToken) {
    const now = this.clock().toISOString();
    return this.adapter.transaction((database) => {
      const worker = this.#worker(database, workerId);
      this.#requireLock(worker, workerId, lockToken);
      worker.lock.heartbeatAt = now;
      return { heartbeatAt: now };
    });
  }

  async completeDispatch(workerId, lockToken, receipt = {}) {
    if (!OUTCOMES.has(receipt.outcome)) fail("INVALID_INPUT", `receipt.outcome must be one of ${[...OUTCOMES].join(", ")}`);
    const now = this.clock().toISOString();
    return this.adapter.transaction((database) => {
      const worker = this.#worker(database, workerId);
      this.#requireLock(worker, workerId, lockToken);
      const sessionId = optionalString(receipt.sessionId);
      if (sessionId !== undefined && worker.sessionLineage[worker.sessionLineage.length - 1] !== sessionId) {
        worker.sessionLineage.push(sessionId);
        if (worker.sessionLineage.length > LINEAGE_LIMIT) worker.sessionLineage.shift();
      }
      const stored = {
        executionId: optionalString(receipt.executionId) ?? null,
        outcome: receipt.outcome,
        cognitiveRole: optionalString(receipt.cognitiveRole) ?? null,
        provider: optionalString(receipt.provider) ?? null,
        model: optionalString(receipt.model) ?? null,
        effort: optionalString(receipt.effort) ?? null,
        sessionId: sessionId ?? null,
        acceptedAt: optionalString(receipt.acceptedAt) ?? null,
        endedAt: optionalString(receipt.endedAt) ?? now,
        usage: boundedUsage(receipt.usage),
        diagnostic: optionalString(receipt.diagnostic)?.slice(0, DIAGNOSTIC_LIMIT) ?? null,
      };
      worker.receipts.push(stored);
      if (worker.receipts.length > RECEIPT_LIMIT) worker.receipts.shift();
      if (receipt.outcome === "outcome_unknown") {
        worker.requiresInspection = { at: now, executionId: stored.executionId, diagnostic: stored.diagnostic };
      }
      worker.lock = null;
      return structuredClone(stored);
    });
  }

  async retire(workerId, reason, { ownerSessionId } = {}) {
    requireBoundedString("reason", reason, SCOPE_LIMIT);
    requireBoundedString("ownerSessionId", ownerSessionId, NAME_LIMIT);
    ownerSessionId = ownerSessionId.trim();
    const now = this.clock().toISOString();
    return this.adapter.transaction((database) => {
      const worker = this.#worker(database, workerId);
      this.#requireOwner(worker, workerId, ownerSessionId);
      if (worker.retired !== null) fail("WORKER_RETIRED", `worker ${workerId} was already retired at ${worker.retired.at}: ${worker.retired.reason}`);
      this.#reclaimDeadLock(worker, now);
      if (worker.lock !== null) fail("WORKER_BUSY", `worker ${workerId} has an active dispatch held by live process ${worker.lock.pid}; cancel it before retiring`);
      worker.retired = { at: now, reason: reason.trim() };
      return structuredClone(worker.retired);
    });
  }

  #worker(database, workerId) {
    const worker = database.workers[workerId];
    if (worker === undefined) fail("WORKER_NOT_FOUND", `worker ${workerId} was not found`);
    return worker;
  }

  #requireOwner(worker, workerId, ownerSessionId) {
    if (worker.ownerSessionId === undefined) {
      worker.ownerSessionId = ownerSessionId;
      return;
    }
    if (worker.ownerSessionId !== ownerSessionId) fail("WORKER_SESSION_MISMATCH", `worker ${workerId} is owned by a different lead session`);
  }

  #requireLock(worker, workerId, lockToken) {
    if (typeof lockToken !== "string" || lockToken.length === 0) fail("INVALID_INPUT", "lockToken is required");
    if (worker.lock === null || worker.lock.token !== lockToken) {
      fail("LOCK_NOT_HELD", `worker ${workerId} dispatch lock is not held by this token; the lock may have been reclaimed after owner death`);
    }
  }

  #reclaimDeadLock(worker, now) {
    if (worker.lock === null) return;
    if (this.isProcessAlive(worker.lock.pid)) return;
    worker.lastLockRecovery = { at: now, deadPid: worker.lock.pid, acquiredAt: worker.lock.acquiredAt, heartbeatAt: worker.lock.heartbeatAt };
    worker.lock = null;
  }
}

function summarize(worker) {
  const latest = worker.receipts[worker.receipts.length - 1];
  return {
    workerId: worker.workerId,
    name: worker.name,
    scope: worker.scope,
    profile: worker.profile,
    repositoryRoot: worker.repositoryRoot,
    ownerSessionId: worker.ownerSessionId ?? null,
    createdAt: worker.createdAt,
    dispatchCount: worker.receipts.length,
    latestSessionId: worker.sessionLineage.length === 0 ? null : worker.sessionLineage[worker.sessionLineage.length - 1],
    latestOutcome: latest?.outcome ?? null,
    locked: worker.lock !== null,
    requiresInspection: worker.requiresInspection !== null,
    retired: worker.retired !== null,
  };
}

function requireBoundedString(field, value, limit) {
  if (typeof value !== "string" || value.trim() === "") fail("INVALID_INPUT", `${field} is required`);
  if (value.length > limit) fail("INVALID_INPUT", `${field} exceeds ${limit} characters`);
}

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function boundedUsage(value) {
  if (value === undefined || value === null || typeof value !== "object") return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= USAGE_LIMIT ? JSON.parse(serialized) : null;
  } catch {
    return null;
  }
}
