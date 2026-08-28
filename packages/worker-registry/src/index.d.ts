export type WorkerOutcome = "success" | "preflight_failed" | "launch_failed" | "execution_failed" | "cancelled" | "timed_out" | "outcome_unknown";

export interface WorkerDispatchReceipt {
  executionId: string | null;
  outcome: WorkerOutcome;
  cognitiveRole: string | null;
  provider: string | null;
  model: string | null;
  effort: string | null;
  sessionId: string | null;
  acceptedAt: string | null;
  endedAt: string;
  usage: unknown | null;
  diagnostic: string | null;
}

export interface WorkerDispatchLock { token: string; pid: number; acquiredAt: string; heartbeatAt: string }

export interface WorkerRecord {
  workerId: string;
  name: string;
  scope: string;
  profile: string;
  repositoryRoot: string;
  ownerSessionId?: string;
  createdAt: string;
  sessionLineage: string[];
  receipts: WorkerDispatchReceipt[];
  lock: WorkerDispatchLock | null;
  lastLockRecovery: { at: string; deadPid: number; acquiredAt: string; heartbeatAt: string } | null;
  requiresInspection: { at: string; executionId: string | null; diagnostic: string | null } | null;
  retired: { at: string; reason: string } | null;
}

export interface WorkerSummary {
  workerId: string;
  name: string;
  scope: string;
  profile: string;
  repositoryRoot: string;
  ownerSessionId: string | null;
  createdAt: string;
  dispatchCount: number;
  latestSessionId: string | null;
  latestOutcome: WorkerOutcome | null;
  locked: boolean;
  requiresInspection: boolean;
  retired: boolean;
}

export interface BeginDispatchGrant {
  lockToken: string;
  continuationSessionId: string | null;
  name: string;
  scope: string;
  profile: string;
}

export interface WorkerAdapter {
  transaction<T>(callback: (database: unknown) => T | Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
}

export class InMemoryWorkerAdapter implements WorkerAdapter {
  constructor(options?: { state?: unknown });
  transaction<T>(callback: (database: unknown) => T | Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
  exportState(): Promise<unknown>;
}

export class FileWorkerAdapter implements WorkerAdapter {
  constructor(options: { directory: string; lockTimeoutMs?: number });
  transaction<T>(callback: (database: unknown) => T | Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
}

export class WorkerRegistryError extends Error {
  code: string;
}

export class WorkerRegistry {
  constructor(options: { adapter: WorkerAdapter; clock?: () => Date; isProcessAlive?: (pid: number) => boolean });
  create(input: { name: string; scope: string; profile: string; repositoryRoot: string; ownerSessionId: string }): Promise<WorkerRecord>;
  inspect(workerId: string): Promise<WorkerRecord>;
  list(options: { ownerSessionId?: string; includeRetired?: boolean; all?: boolean }): Promise<WorkerSummary[]>;
  beginDispatch(workerId: string, input: { pid: number; repositoryRoot: string; ownerSessionId: string; acknowledgeInspection?: boolean }): Promise<BeginDispatchGrant>;
  heartbeat(workerId: string, lockToken: string): Promise<{ heartbeatAt: string }>;
  completeDispatch(workerId: string, lockToken: string, receipt: { outcome: WorkerOutcome; executionId?: string; cognitiveRole?: string; provider?: string; model?: string; effort?: string; sessionId?: string; acceptedAt?: string; endedAt?: string; usage?: unknown; diagnostic?: string }): Promise<WorkerDispatchReceipt>;
  retire(workerId: string, reason: string, options: { ownerSessionId: string }): Promise<{ at: string; reason: string }>;
}

export function createUserLocalWorkerRegistry(options?: { directory?: string; clock?: () => Date; isProcessAlive?: (pid: number) => boolean }): WorkerRegistry;
