export type ExecutionOutcome = "success" | "preflight_failed" | "launch_failed" | "execution_failed" | "cancelled" | "timed_out" | "outcome_unknown";
export interface ModelBinding { cognitiveRole: string; provider: string; model: string; effort: string; quotaSnapshot: { generatedAt: string | null; refreshedAt: string | null; stale: false; error: null; relevantWindows: unknown[] } }
export interface ResolvedExecutionSpec { task: string; profile: string; cognitiveRole: string; cwd: string; tools: string[]; binding: ModelBinding; timeoutMs?: number }
export interface ExecutionReceipt { executionId: string; acceptedAt: string }
export interface ExecutionObservation { executionId: string; sequence: number; at: string; type: string; detail?: unknown }
export interface ExecutionResult { outcome: ExecutionOutcome; text: string; profile: string; cognitiveRole: string; provider: string; model: string; effort: string; sessionId?: string; diagnostic?: string }
export interface CancellationReceipt { executionId: string; outcome: "cancelled" | "outcome_unknown" }
export class PiRpcExecutionAdapter {
  constructor(options?: { command?: string; concurrency?: number; timeoutMs?: number; bindingMaxAgeMs?: number; hostTools?: string[]; clock?: () => Date; spawn?: Function; killGraceMs?: number });
  dispatch(spec: ResolvedExecutionSpec): Promise<ExecutionReceipt>;
  observe(executionId: string): AsyncIterable<ExecutionObservation>;
  result(executionId: string): Promise<ExecutionResult>;
  cancel(executionId: string, reason: string): Promise<CancellationReceipt>;
  cancelAll(reason: string): Promise<CancellationReceipt[]>;
}
