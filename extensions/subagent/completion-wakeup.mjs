const CUSTOM_TYPE = "pi-workbench:child-completion";

/**
 * Owns session-local completion wakeup deduplication and shutdown suppression.
 * Terminal result content remains behind subagent_collect; the wakeup carries only
 * bounded identity and outcome metadata.
 */
export function createCompletionWakeup({ sendMessage }) {
  const handled = new Set();
  const receiptFailuresObserved = new Set();
  const reconciliationInFlight = new Set();
  let shuttingDown = false;

  return {
    beginReconciliation(executionId) {
      reconciliationInFlight.add(executionId);
    },

    finishReconciliation(executionId, terminal) {
      reconciliationInFlight.delete(executionId);
      if (terminal) handled.add(executionId);
    },

    markHandled(executionId) {
      reconciliationInFlight.delete(executionId);
      handled.add(executionId);
    },

    shutdown() {
      shuttingDown = true;
    },

    notify(meta) {
      const executionId = requiredString(meta.executionId, "executionId");
      const receiptFailed = meta.receiptFailure !== undefined;
      if (shuttingDown) return false;
      if (receiptFailed) {
        if (receiptFailuresObserved.has(executionId)) return false;
        receiptFailuresObserved.add(executionId);
      } else {
        if (reconciliationInFlight.has(executionId) || handled.has(executionId)) return false;
        handled.add(executionId);
      }

      const outcome = bounded(requiredString(meta.outcome, "outcome"), 64);
      const actor = meta.workerId === undefined
        ? "Background subagent"
        : `Worker "${bounded(meta.workerName ?? "unnamed", 120)}" (${bounded(meta.workerId, 128)}) background dispatch`;
      const status = receiptFailed
        ? `reached a terminal child result, but its Worker receipt did not settle; treat the recorded outcome as outcome_unknown and inspect worker_status`
        : `reached terminal outcome ${outcome}`;
      const reconciliation = receiptFailed
        ? `Inspect worker_status and do not dispatch this Worker again. If executionId "${executionId}" has not already been collected, call subagent_collect exactly once and reconcile it.`
        : `Call subagent_collect exactly once for executionId "${executionId}" and reconcile the result.`;
      const content = `${actor} ${executionId} ${status}. ${reconciliation} Do not retry, relaunch, publish, or accept this outcome based only on the wakeup.`;
      const details = {
        executionId,
        outcome: receiptFailed ? "outcome_unknown" : outcome,
        profile: bounded(requiredString(meta.profile, "profile"), 64),
        cognitiveRole: bounded(requiredString(meta.cognitiveRole, "cognitiveRole"), 64),
        ...(meta.workerId === undefined ? {} : {
          workerId: bounded(meta.workerId, 128),
          workerName: bounded(meta.workerName ?? "unnamed", 120),
        }),
        ...(receiptFailed ? {
          receiptStatus: "failed",
          receiptDiagnostic: bounded(meta.receiptFailure, 240),
          resultAlreadyReconciled: handled.has(executionId),
        } : {}),
      };

      sendMessage({ customType: CUSTOM_TYPE, content, display: true, details }, { deliverAs: "followUp", triggerTurn: true });
      return true;
    },
  };
}

/** Settles the Worker receipt before success wakeup; a failed receipt emits bounded attention instead. */
export async function settleWorkerReceipt({ settle, wakeup, background, completion }) {
  try {
    await settle();
    if (background) wakeup.notify(completion);
  } catch (error) {
    if (background) wakeup.notify({ ...completion, outcome: "outcome_unknown", receiptFailure: errorMessage(error) });
    throw error;
  }
}

export function workerReceiptFailureResult(result, executionId, workerId, error) {
  const childOutcome = result?.details?.outcome ?? "outcome_unknown";
  const childText = Array.isArray(result?.content)
    ? result.content.filter((part) => part?.type === "text").map((part) => String(part.text ?? "")).join("\n")
    : "";
  const diagnostic = bounded(errorMessage(error), 500);
  return {
    content: [{
      type: "text",
      text: `outcome_unknown: Worker ${workerId} child execution ${executionId} reported ${String(childOutcome)}, but its registry receipt did not settle: ${diagnostic}. Inspect worker_status and do not dispatch this Worker again in the current session.\n\nChild result for inspection only:\n${bounded(childText || "No child text was reported.", 2_000)}`,
    }],
    details: {
      ...(result?.details ?? {}),
      outcome: "outcome_unknown",
      childOutcome,
      executionId,
      workerId,
      receiptStatus: "failed",
      receiptDiagnostic: diagnostic,
    },
    isError: true,
  };
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function bounded(value, max) {
  const text = String(value);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
