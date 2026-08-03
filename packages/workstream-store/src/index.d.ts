export type WorkstreamId = string;
export type Revision = number;

export interface CreateWorkstream {
  workstreamId: WorkstreamId;
  idempotencyKey: string;
  title: string;
  producer: string;
}

export interface AppendWorkstream {
  workstreamId: WorkstreamId;
  expectedRevision: Revision;
  idempotencyKey: string;
  records: WorkstreamRecord[];
}

export interface CloseWorkstream {
  workstreamId: WorkstreamId;
  expectedRevision: Revision;
  idempotencyKey: string;
  producer: string;
  sourceSessionId?: string;
}

export type WorkstreamRecord =
  | SemanticRecord<"session.pending", { sessionId: string; associationKey: string }>
  | SemanticRecord<"session.confirmed", { sessionId: string }>
  | SemanticRecord<"session.failed", { sessionId: string; reason: string }>
  | SemanticRecord<"checkpoint.replaced", { sessionId: string; checkpoint: Checkpoint }>
  | SemanticRecord<"checkpoint.failed", { sessionId: string; reason: string }>
  | SemanticRecord<"human-task.upsert", { task: HumanTask }>
  | SemanticRecord<"human-task.resolved", { taskId: string }>
  | SemanticRecord<"link.upsert", { link: WorkstreamLink }>
  | SemanticRecord<"link.removed", { linkId: string }>;

export interface SemanticRecord<T extends string, P> {
  type: T;
  producer: string;
  sourceSessionId?: string;
  payload: P;
}

export interface Checkpoint {
  id: string;
  whatChanged: string;
  remains: string;
  next: string;
  references?: string[];
}

export interface HumanTask { id: string; title: string; detail?: string }
export interface WorkstreamLink { id: string; kind: string; reference: string; label?: string }

export interface WorkstreamReceipt {
  workstreamId: WorkstreamId;
  acceptedRevision: Revision;
  snapshotReference: { workstreamId: WorkstreamId; revision: Revision };
  sequence: number;
  idempotencyKey: string;
  recordedAt: string;
}

export interface WorkstreamSession {
  id: string;
  status: "pending" | "active";
  associationKey?: string;
  latestCheckpoint: Checkpoint | null;
  checkpointFailure: string | null;
}

export interface WorkstreamSnapshot {
  id: WorkstreamId;
  title: string;
  revision: Revision;
  createdAt: string;
  updatedAt: string;
  sessions: WorkstreamSession[];
  humanTasks: HumanTask[];
  links: WorkstreamLink[];
  closed: boolean;
  closedAt: string | null;
}

export interface WorkstreamSummary {
  id: WorkstreamId;
  title: string;
  revision: Revision;
  updatedAt: string;
  activeSessionCount: number;
  pendingSessionCount: number;
  unresolvedHumanTaskCount: number;
  closed: boolean;
}

export interface WorkstreamQuery { includeClosed?: boolean; text?: string }
export interface WorkstreamWatch { afterSequence?: number; workstreamId?: WorkstreamId; limit?: number }
export type WorkstreamEventBatch =
  | { mode: "replay"; events: WorkstreamEvent[]; nextSequence: number }
  | { mode: "snapshot"; snapshots: WorkstreamSnapshot[]; nextSequence: number };
export interface WorkstreamEvent {
  sequence: number;
  workstreamId: WorkstreamId;
  revision: Revision;
  records: unknown[];
  recordedAt: string;
}

export interface WorkstreamAdapter {
  transaction<T>(callback: (database: any) => T | Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
}

export interface StoreOptions {
  adapter: WorkstreamAdapter;
  clock?: () => Date | string | number;
  limits?: Record<string, number>;
}

export class WorkstreamStore {
  constructor(options: StoreOptions);
  create(request: CreateWorkstream): Promise<WorkstreamReceipt>;
  append(request: AppendWorkstream): Promise<WorkstreamReceipt>;
  inspect(workstreamId: WorkstreamId): Promise<WorkstreamSnapshot>;
  list(query?: WorkstreamQuery): Promise<WorkstreamSummary[]>;
  watch(watch?: WorkstreamWatch): Promise<WorkstreamEventBatch>;
  close(request: CloseWorkstream): Promise<WorkstreamReceipt>;
}

export class InMemoryWorkstreamAdapter implements WorkstreamAdapter {
  constructor(options?: { eventRetention?: number; state?: unknown });
  transaction<T>(callback: (database: any) => T | Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
  exportState(): Promise<unknown>;
}

export class FileWorkstreamAdapter implements WorkstreamAdapter {
  constructor(options: { directory: string; eventRetention?: number; lockTimeoutMs?: number });
  transaction<T>(callback: (database: any) => T | Promise<T>, options?: { readOnly?: boolean }): Promise<T>;
}

export class WorkstreamStoreError extends Error {
  code: string;
  details?: unknown;
}

export function createUserLocalWorkstreamStore(options?: {
  directory?: string;
  eventRetention?: number;
  lockTimeoutMs?: number;
  clock?: () => Date | string | number;
  limits?: Record<string, number>;
}): WorkstreamStore;

export function rebuildSnapshot(ledger: unknown[]): WorkstreamSnapshot;
