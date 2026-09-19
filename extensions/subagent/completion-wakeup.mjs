const CUSTOM_TYPE = "pi-workbench:child-completion";
const NORMAL_ATTENTION = "terminal-results";
const NORMAL_CONTENT = "Background children finished. Call `subagent_status`, then collect and reconcile each terminal-uncollected child once, then resume the run that launched them at its next incomplete step. This notice authorizes no retry, relaunch, publication, or acceptance beyond that run's existing authorization.";

/** True only for the delivered coalesced normal-attention message; receipt failures never match. */
export function isNormalCompletionAttention(message) {
  return message?.role === "custom" && message.customType === CUSTOM_TYPE && message.details?.attention === NORMAL_ATTENTION;
}

/**
 * Owns session-local completion attention: normal completions coalesce into one steer
 * signal that only delivery re-arms, while a Worker receipt failure keeps its own exact
 * per-execution attention. Terminal result content remains behind subagent_collect.
 */
export function createCompletionWakeup({ sendMessage }) {
  const handled = new Set();
  const receiptFailuresObserved = new Set();
  const reconciliationInFlight = new Set();
  let shuttingDown = false;
  let queued = false;

  return {
    /** Idempotent: normal attention returns to idle so a later completion can signal again. */
    rearm() {
      queued = false;
    },

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

      requiredString(meta.outcome, "outcome");
      requiredString(meta.profile, "profile");
      requiredString(meta.cognitiveRole, "cognitiveRole");

      if (!receiptFailed) {
        // One signal per attention cycle: the lead reconciles the whole default status roster,
        // so a second child adds nothing until the first signal has been delivered.
        if (queued) return false;
        queued = true;
        sendMessage(
          { customType: CUSTOM_TYPE, content: NORMAL_CONTENT, display: true, details: { attention: NORMAL_ATTENTION } },
          { deliverAs: "steer", triggerTurn: true },
        );
        return true;
      }

      const actor = meta.workerId === undefined
        ? "Background subagent"
        : `Worker "${bounded(meta.workerName ?? "unnamed", 120)}" (${bounded(meta.workerId, 128)}) background dispatch`;
      const content = `${actor} ${executionId} reached a terminal child result, but its Worker receipt did not settle; treat the recorded outcome as outcome_unknown and inspect worker_status. Inspect worker_status and do not dispatch this Worker again. If executionId "${executionId}" has not already been collected, call subagent_collect exactly once and reconcile it. Do not retry, relaunch, publish, or accept this outcome based only on the wakeup.`;
      const details = {
        executionId,
        outcome: "outcome_unknown",
        profile: bounded(meta.profile, 64),
        cognitiveRole: bounded(meta.cognitiveRole, 64),
        ...(meta.workerId === undefined ? {} : {
          workerId: bounded(meta.workerId, 128),
          workerName: bounded(meta.workerName ?? "unnamed", 120),
        }),
        receiptStatus: "failed",
        receiptDiagnostic: bounded(meta.receiptFailure, 240),
        resultAlreadyReconciled: handled.has(executionId),
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

/**
 * Collection must not report a Worker success before its registry receipt settles: the child
 * process ending and the receipt landing are separate events. A non-terminal result never waits,
 * so aborting collect on a running child stays immediate.
 */
export async function receiptSafeResult({ result, executionId, terminal, receipt }) {
  if (!terminal || receipt === undefined) return result;
  const failure = await receipt.settled;
  return failure === undefined ? result : workerReceiptFailureResult(result, executionId, receipt.workerId, failure.error);
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
