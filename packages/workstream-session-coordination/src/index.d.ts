import type {
  AppendWorkstream,
  WorkstreamReceipt,
  WorkstreamRecordProvenance,
  WorkstreamSnapshot,
} from "../../workstream-store/src/index.js";

export interface CompleteLocation {
  machineId: string;
  projectId: string;
  workspaceId: string;
}

export interface CreatedSession {
  id: string;
  location: CompleteLocation;
}

export interface ContinuationCheckpoint {
  id: string;
  whatChanged: string;
  remains: string;
  next: string;
  nextSessionPrompt: string;
  references?: string[];
}

export type ContinuationStaleness = WorkstreamRecordProvenance & {
  checkpointId: string;
  reason: string;
};

export type ContinuationBlockedCause =
  | "WORKSTREAM_CLOSED"
  | "SOURCE_SESSION_NOT_ACTIVE"
  | "SOURCE_LOCATION_INCOMPLETE"
  | "CHECKPOINT_MISSING"
  | "CHECKPOINT_STALE"
  | "NEXT_SESSION_PROMPT_MISSING"
  | "SELECTION_INVALID"
  | "SELECTION_CHANGED"
  | "HOST_LOCATION_UNAVAILABLE"
  | "HOST_LOCATION_MISMATCH";

type UnselectableContinuationCause = Exclude<ContinuationBlockedCause, "CHECKPOINT_STALE">;

export type ContinuationCandidate =
  | {
      sourceSessionId: string;
      status: "ready";
      location: CompleteLocation;
      checkpoint: ContinuationCheckpoint;
      selection: string;
    }
  | {
      sourceSessionId: string;
      status: "blocked";
      cause: "CHECKPOINT_STALE";
      reason: string;
      location: CompleteLocation;
      checkpoint: ContinuationCheckpoint;
      selection: string;
      staleness: ContinuationStaleness;
    }
  | {
      sourceSessionId: string;
      status: "blocked";
      cause: UnselectableContinuationCause;
      reason: string;
    };

export interface ContinuationView {
  workstreamId: string;
  title: string;
  revision: number;
  closed: boolean;
  candidates: ContinuationCandidate[];
}

/** operationId must be globally unique within its producer namespace; reuse it only for an exact retry. */
export type LaunchRequest =
  | { kind: "blank"; workstreamId: string; operationId: string; location: CompleteLocation }
  | { kind: "checkpoint"; workstreamId: string; operationId: string; selection: string; acceptStaleCheckpointId?: string };

export type LaunchOutcome =
  | { type: "blocked"; cause: ContinuationBlockedCause; reason: string; details?: unknown }
  | { type: "confirmed"; operationToken: string; session: CreatedSession }
  | { type: "cancelled"; operationToken: string; reason: string }
  | { type: "failed"; operationToken: string; reason: string }
  | { type: "pending"; operationToken: string; reason: string }
  | { type: "unavailable"; operationToken: string; cause: string; reason: string }
  | { type: "unconfirmed"; operationToken: string; reason: string; session: CreatedSession }
  | { type: "conflict"; operationToken: string; cause: string; reason: string; session?: CreatedSession };

export type ReconcileOutcome =
  | { associationKey: string; status: "confirmed"; sessionId: string }
  | { associationKey: string; status: "cancelled" | "failed"; reason: string }
  | { associationKey: string; status: "pending"; reason?: string; session?: CreatedSession }
  | { associationKey: string; status: "conflict"; cause: string; reason: string; sessionId?: string }
  | { associationKey: string; status: "blocked"; cause: "WORKSTREAM_CLOSED"; reason: string }
  | { status: "unavailable"; cause: string; reason: string };

export interface WorkstreamClient {
  inspect(workstreamId: string): Promise<WorkstreamSnapshot>;
  append(request: AppendWorkstream): Promise<WorkstreamReceipt>;
}

export interface AttendedSessionAdapter {
  checkLocation(request: { location: CompleteLocation }): Promise<
    | { type: "ready" }
    | { type: "blocked"; cause: "HOST_LOCATION_UNAVAILABLE" | "HOST_LOCATION_MISMATCH"; reason: string }
  >;
  launch(
    request: { associationKey: string; location: CompleteLocation; initialPrompt: string; operationMarker: string },
    hooks: { created(session: CreatedSession): Promise<void> },
  ): Promise<
    | { type: "completed" }
    | { type: "cancelled"; reason: string }
    | { type: "failed"; reason: string }
    | { type: "unknown"; reason: string }
  >;
  lookup(request: { associationKey: string; location: CompleteLocation }): Promise<
    | { type: "found"; session: CreatedSession }
    | { type: "cancelled"; reason: string }
    | { type: "failed"; reason: string }
    | { type: "unknown" }
  >;
}

export interface WorkstreamSessionCoordinationOptions {
  withWorkstreamClient<T>(callback: (client: WorkstreamClient) => Promise<T>): Promise<T>;
  attendedSession: AttendedSessionAdapter;
  producer: "pi-web" | "pi-extension";
  sourceSessionId?: string;
  maxRevisionRetries?: number;
  ownsAssociationKey?: (associationKey: string) => boolean;
}

export class WorkstreamSessionCoordination {
  constructor(options: WorkstreamSessionCoordinationOptions);
  inspectContinuation(workstreamId: string): Promise<ContinuationView>;
  launch(request: LaunchRequest): Promise<LaunchOutcome>;
  reconcile(workstreamId: string, knownSnapshot?: WorkstreamSnapshot): Promise<ReconcileOutcome[]>;
}

export class CoordinationError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown);
}
