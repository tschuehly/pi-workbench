import { redact, redactDeep } from "../secret-redaction/redact.mjs";

const CUSTOM_TYPE = "pi-workbench:child-completion";
const NORMAL_ATTENTION = "terminal-results";
// Matches subagent_collect's bulk budget: the notice replaces that collect turn.
const NOTICE_MAX_CHARS = 24_000;
const AUTHORITY = "This notice authorizes no retry, relaunch, publication, or acceptance beyond that run's existing authorization.";

/**
 * One notice carries every ready result that fits the budget, in completion order; the rest are
 * named for subagent_collect. The first result is always carried: the adapter already bounds it.
 */
function composeNotice(ready, maxChars) {
  const delivered = [];
  const collect = [];
  const sections = [];
  let used = 0;
  let truncated = 0;
  for (const [executionId, entry] of ready) {
    const section = entry.text === undefined ? undefined : `${executionId} [${entry.outcome}]\n${entry.text}`;
    if (section === undefined || (delivered.length > 0 && used + section.length > maxChars)) {
      collect.push(executionId);
      continue;
    }
    delivered.push(executionId);
    used += section.length;
    if (entry.truncated) truncated += 1;
    sections.push(section);
  }
  const notes = [
    delivered.length === 0 ? "Background children finished." : `Background children finished; their results follow and are already collected.`,
    truncated === 0 ? "" : `${truncated} result(s) truncated — verification incomplete; read the full text the result names.`,
    collect.length === 0 ? "" : `Call \`subagent_collect\` without an executionId once for the results this notice could not carry: ${collect.join(", ")}.`,
    "Then resume the run that launched them at its next incomplete step.",
    AUTHORITY,
  ].filter((note) => note !== "");
  return {
    content: [notes.join(" "), ...sections].join("\n\n"),
    details: { attention: NORMAL_ATTENTION, delivered, collect },
  };
}

/** True only for the delivered coalesced normal-attention message; receipt failures never match. */
export function isNormalCompletionAttention(message) {
  return message?.role === "custom" && message.customType === CUSTOM_TYPE && message.details?.attention === NORMAL_ATTENTION;
}

/**
 * Owns session-local completion attention: normal completions coalesce into one steer
 * signal, while a Worker receipt failure keeps its own exact per-execution attention.
 * Attention stays pending until its marker is delivered (or the result is collected), so a
 * signal Pi drops from its queue is re-sent once at the next settle. The signal carries the
 * compact results that fit its budget; delivery reports them through `onDelivered`, which marks
 * them collected. A child that finishes after the signal was composed rides the next one.
 */
export function createCompletionWakeup({ sendMessage: send, onDelivered = () => {}, maxChars = NOTICE_MAX_CHARS }) {
  // A displayed custom message is persisted before any redaction hook sees it (that hook covers
  // tool results and assistant text), and child results can quote credentials, so redact here.
  const sendMessage = (message, options) => send({ ...message, content: redact(message.content), details: redactDeep(message.details) }, options);
  const handled = new Set();
  const receiptFailuresObserved = new Set();
  const reconciliationInFlight = new Set();
  // executionId → { outcome, text?, truncated? } for terminal children whose attention is pending.
  const undelivered = new Map();
  const receiptFailuresUndelivered = new Map();
  let shuttingDown = false;
  let queued = false;
  // A resend triggers a turn that settles again; a turn that settles without delivering
  // (e.g. Pi rejects the prompt) would otherwise resend forever and spin the session daemon.
  let resent = false;

  const signal = (resend = false) => {
    queued = true;
    resent = resend;
    sendMessage(
      { customType: CUSTOM_TYPE, display: true, ...composeNotice(undelivered, maxChars) },
      { deliverAs: "steer", triggerTurn: true },
    );
  };
  const collected = (executionId) => {
    reconciliationInFlight.delete(executionId);
    handled.add(executionId);
    undelivered.delete(executionId);
  };

  return {
    /** Marker delivery: the lead is looking at this attention, so it is no longer pending. */
    acknowledge(message) {
      if (isNormalCompletionAttention(message)) {
        queued = false;
        // A delivery proves the session is not spinning on resends.
        resent = false;
        const { delivered, collect } = message.details;
        // A notice without a composition list (an earlier revision's) asked the lead to collect everything.
        if (!Array.isArray(delivered)) return undelivered.clear();
        for (const executionId of collect ?? []) undelivered.delete(executionId);
        for (const executionId of delivered) if (undelivered.delete(executionId)) onDelivered(executionId);
      } else if (message?.role === "custom" && message.customType === CUSTOM_TYPE && message.details?.receiptStatus === "failed") {
        receiptFailuresUndelivered.delete(message.details.executionId);
      }
    },

    /** Agent settled: whatever is still pending was dropped or finished late, so send it once; subagent_collect still holds the results. */
    rearm() {
      queued = false;
      if (shuttingDown) return;
      if (undelivered.size > 0 && !resent) signal(true);
      for (const [executionId, [message, options]] of receiptFailuresUndelivered) {
        receiptFailuresUndelivered.delete(executionId);
        sendMessage(message, options);
      }
    },

    beginReconciliation(executionId) {
      reconciliationInFlight.add(executionId);
    },

    finishReconciliation(executionId, terminal) {
      if (terminal) collected(executionId);
      else reconciliationInFlight.delete(executionId);
    },

    markHandled(executionId) {
      collected(executionId);
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
        undelivered.set(executionId, { outcome: meta.outcome, text: meta.text, truncated: meta.truncated === true });
      }

      requiredString(meta.outcome, "outcome");
      requiredString(meta.profile, "profile");
      requiredString(meta.cognitiveRole, "cognitiveRole");

      if (!receiptFailed) {
        // One signal per attention cycle: two turn-triggering sends while idle would race into a
        // concurrent prompt. A child that finishes meanwhile rides the next signal, at the latest when the agent settles.
        if (queued) return false;
        signal();
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

      const failure = [{ customType: CUSTOM_TYPE, content, display: true, details }, { deliverAs: "followUp", triggerTurn: true }];
      receiptFailuresUndelivered.set(executionId, failure);
      sendMessage(...failure);
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
 * process ending and the receipt landing are separate events. A running snapshot never waits for
 * a receipt.
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
