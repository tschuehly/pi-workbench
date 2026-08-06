export type ExecutionOutcome = "success" | "preflight_failed" | "launch_failed" | "execution_failed" | "cancelled" | "timed_out" | "outcome_unknown";
export type QuotaAdmission = "fresh-quota" | "degraded-quota-telemetry";
export type QuotaTelemetryStatus = "fresh" | "stale" | "unavailable";
export interface QuotaSnapshot { generatedAt: string | null; refreshedAt: string | null; telemetryStatus: QuotaTelemetryStatus; stale: boolean; error: string | null; relevantWindows: unknown[] }
export interface ModelBinding { cognitiveRole: string; provider: string; model: string; effort: string; admission: QuotaAdmission; quotaSnapshot: QuotaSnapshot }
export interface ResolvedExecutionSpec { task: string; profile: string; cognitiveRole: string; cwd: string; tools: string[]; binding: ModelBinding; timeoutMs?: number }
export interface ExecutionReceipt { executionId: string; acceptedAt: string }
export interface ExecutionObservation { executionId: string; sequence: number; at: string; type: string; detail?: unknown }
export interface ExecutionResult { outcome: ExecutionOutcome; text: string; profile: string; cognitiveRole: string; provider: string; model: string; effort: string; quotaAdmission: QuotaAdmission; quotaTelemetryStatus: QuotaTelemetryStatus; sessionId?: string; diagnostic?: string }
export interface CancellationReceipt { executionId: string; outcome: "cancelled" | "outcome_unknown" }
export interface ExecutionStatus { executionId: string; profile: string; cognitiveRole: string; provider: string; model: string; effort: string; running: boolean; outcome?: ExecutionOutcome; acceptedAt: string; observationCount: number; latestObservation?: { type: string; at: string; detail?: unknown }; sessionId?: string }
export interface ExecutionSummary { executionId: string; profile: string; cognitiveRole: string; running: boolean; outcome?: ExecutionOutcome; acceptedAt: string }
export class PiRpcExecutionAdapter {
  constructor(options?: { command?: string; timeoutMs?: number; bindingMaxAgeMs?: number; hostTools?: string[]; clock?: () => Date; spawn?: Function; killGraceMs?: number });
  dispatch(spec: ResolvedExecutionSpec): Promise<ExecutionReceipt>;
  observe(executionId: string): AsyncIterable<ExecutionObservation>;
  result(executionId: string): Promise<ExecutionResult>;
  status(executionId: string): ExecutionStatus;
  list(): ExecutionSummary[];
  cancel(executionId: string, reason: string): Promise<CancellationReceipt>;
  cancelAll(reason: string): Promise<CancellationReceipt[]>;
}
