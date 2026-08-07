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
  | SemanticRecord<"session.pending", { sessionId?: string; associationKey: string; machineId?: string; projectId?: string; workspaceId?: string }>
  | SemanticRecord<"session.confirmed", { sessionId: string; associationKey?: string; machineId?: string; projectId?: string; workspaceId?: string }>
  | SemanticRecord<"session.failed", { sessionId?: string; associationKey?: string; reason: string }>
  | SemanticRecord<"checkpoint.replaced", { sessionId: string; checkpoint: Checkpoint }>
  | SemanticRecord<"checkpoint.failed", { sessionId: string; reason: string }>
  | SemanticRecord<"checkpoint.stale", { sessionId: string; checkpointId: string; reason: string }>
  | SemanticRecord<"human-task.upsert", { task: HumanTaskInput }>
  | SemanticRecord<"human-task.answered", { taskId: string; answerId: string; answer: HumanTaskAnswer }>
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

export type HumanTaskAnswerKind = "yes-no" | "choice" | "free-text";
export type HumanTaskMateriality = "material" | "non-material";
export interface HumanTaskOption { id: string; label: string }
export type HumanTaskInput =
  | { id: string; title: string; detail?: string }
  | { id: string; title: string; detail?: string; answerKind: HumanTaskAnswerKind; options: HumanTaskOption[]; materiality: HumanTaskMateriality };
export type HumanTaskAnswer =
  | { kind: "yes-no"; optionId: "yes" | "no" | "change" }
  | { kind: "choice"; optionId: string }
  | { kind: "free-text"; text: string };
export interface HumanTaskAnswerReceipt {
  answerId: string;
  taskId: string;
  acceptedRevision: Revision;
  recordedAt: string;
  producer: string;
  sourceSessionId: string | null;
}
export interface HumanTask {
  id: string;
  title: string;
  detail?: string;
  answerKind: HumanTaskAnswerKind | null;
  options: HumanTaskOption[];
  materiality: HumanTaskMateriality | null;
  sourceSessionId: string | null;
  status: "pending" | "answered" | "resolved";
  answer: HumanTaskAnswer | null;
  answerReceipt: HumanTaskAnswerReceipt | null;
}
export interface WorkstreamLink { id: string; kind: string; reference: string; label?: string }

export interface WorkstreamReceipt {
  workstreamId: WorkstreamId;
  acceptedRevision: Revision;
  snapshotReference: { workstreamId: WorkstreamId; revision: Revision };
  sequence: number;
  idempotencyKey: string;
  recordedAt: string;
}

export interface WorkstreamRecordProvenance {
  recordedAt: string;
  revision: Revision;
  producer: string;
  sourceSessionId: string | null;
}

export interface WorkstreamSession {
  id: string;
  status: "pending" | "active" | "failed";
  associationKey?: string;
  machineId?: string;
  projectId?: string;
  workspaceId?: string;
  latestCheckpoint: Checkpoint | null;
  checkpointFailure: string | null;
  checkpointStaleness: (WorkstreamRecordProvenance & { checkpointId: string; reason: string }) | null;
  launchFailure: (WorkstreamRecordProvenance & { reason: string }) | null;
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
  failedSessionCount: number;
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
