# Receipt-safe child collection

Status: proposed.

## Goal

Two changes to `subagent_collect`, in this order:

1. A background Worker must never be collected as `success` while its registry receipt is unsettled or failed.
2. `subagent_collect` with no `executionId` reconciles every reconcilable child, so the lead never restates identifiers it was just shown.

Step 1 fixes a live defect and stands alone. Step 2 depends on it.

## Problem

**A collected Worker success can be wrong for a short window.** `subagent_collect` waits only for the child process to end (`extensions/subagent/index.ts:299-307`). A background Worker's registry receipt settles on a separate promise (`extensions/subagent/index.ts:526-556`). Collect inside that window returns `success`. If the receipt then fails, separate attention arrives afterwards carrying `resultAlreadyReconciled: true` and instructing the lead to treat the outcome as `outcome_unknown`, so the record is corrected — but the lead may already have acted on a success that was never real. The foreground dispatch path does not have this hole: it awaits the receipt and converts a failure through `workerReceiptFailureResult` (`extensions/subagent/index.ts:552-571`).

**Reconciliation depends on the lead transcribing identifiers.** After the coalesced completion signal, the lead reads the roster from `subagent_status` and retypes one `executionId` per `subagent_collect` call. A skipped or mistyped identifier silently orphans a finished child result, and no later signal names it, because its completion is already in the `handled` set. Decision 98 exists to prevent exactly that loss, and the extension already knows the reconcilable set deterministically.

## Design

### Step 1 — collect awaits the Worker receipt

Background collection does what foreground dispatch already does. Keep a per-execution completion record when a background Worker is dispatched. In `subagent_collect`, after the child result resolves, await that record; if the receipt failed, return `workerReceiptFailureResult(...)` so the outcome is `outcome_unknown` and the child text is marked inspection-only.

A Subagent has no receipt and is reconcilable as soon as it is terminal. Waiting collapses the pending case into settled or failed, so no new state machine is needed. The wait is a local registry write, and collect remains abortable through its existing signal.

### Step 2 — collect with no identifier

`executionId` becomes optional. Without it, collect reconciles every child that is not running and not already collected, in launch order, each exactly once, through the same receipt-safe path as Step 1.

The result is one bounded aggregate: a compact result plus completion receipt per child, with a total cap that names any child to collect individually when it trips. Children still running are listed as not collected. The single-identifier form is unchanged.

## Done when

- A background Worker whose receipt fails cannot be collected as `success`; collection during the receipt window returns only after the receipt settles.
- No-argument collect reconciles every terminal child exactly once, leaves running children alone, and reports nothing to reconcile on a second call.
- `npm test` passes.
- Real smoke: three background children produce one coalesced signal, one no-argument collect returns all three results, and `subagent_status` then reports zero uncollected.

## Not doing

No automatic collection without a tool call, no result injection into lead context, no new module, dependency, timer, scheduler, retry, or reminder loop, no upstream Pi change, and no change to the coalesced completion signal itself.

## Rejected in review

Two adverse reviews on `openai-codex/gpt-5.6-sol`, independent of the authoring model family, rejected two related proposals:

- **Adding "finish your current step first" to the completion signal.** The signal arrives at a model boundary, so the instruction means "continue what was already intended", which the finished child may have invalidated. Interrupting is sometimes correct, and message text cannot decide which case applies.
- **Printing uncollected children to the terminal when the agent settles.** It is visible only in the interactive host, leaving RPC and graphical hosts with no signal, and `subagent_status` already reports `N terminal and uncollected` as the recovery path.

## Effort

About 30–45 minutes per step including tests, assuming the existing test files cover the new cases.
