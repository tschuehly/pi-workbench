# Lead service-failure recovery

At `agent_before_settle`, a failed Anthropic lead request can switch to
`openai-codex/gpt-6.1-sol` with high thinking and continue the same session.
Eligible failures: account limits, overloads, HTTP 5xx, and timeouts.
Cancellations, refusals, ordinary successful replies, and child executions are excluded.

The extension appends one visible, model-readable notice with the cause, target, and
continuation instructions. It asks the model to reconcile recorded results and actual
outcomes before repeating side effects; this is guidance, not an exactly-once guarantee.
If the target is missing or authentication/model switching fails, the notice says recovery
is unavailable and the extension does not request continuation. A failed Sol request does
not trigger another switch.

## Native retry boundary

Inspected Pi 0.99.0: `AgentSession._runAgentPrompt` runs `_handlePostAgentRun` (including
`_prepareRetry`) before `_runBeforeSettleBoundary`. The extension adds no retry loop.
Defaults: three agent retries after the initial request, with 2/4/8-second backoff
(capped at 60 seconds per delay); provider retries default to zero. Settings can override
these values or disable retries. This is an attempt bound, not a total wall-clock bound.

Pi's `isRetryableAssistantError` recognizes overloads, timeouts and selected HTTP statuses
(500/502/503/504/520/524), not every 5xx code. An otherwise eligible unrecognized 5xx,
non-retryable quota error, or retry-disabled run reaches fallback without native retries.
This extension does not change native classification or settings.

## Checks

- `npm run test:lead-fallback`: classifier and extension-hook regressions.
- Set `PI_CODING_AGENT_MODULE` to the installed runtime's absolute
  `dist/core/agent-session.js` path to also exercise its real agent loop and retry methods.
  This optional check stubs provider calls, persistence, and boundary dispatch; it verifies
  three retries precede a single fallback and covers retry-disabled behavior.
- No live provider outage, UI rendering, or promotion is exercised by these tests.

## Issue ledger / scope limits

| Issue | Finding and status |
| --- | --- |
| Lead stops after Claude transient service failure | Implemented here; classifier, hook, and native-loop checks pass against installed Pi 0.99.0. Live validation pending promotion. |
| Child service-failure recovery | Unchanged: `skills/model-orchestration/scripts/resolve-runtime-binding.mjs` selects fallback only at launch (catalog, effort, quota admission). Children retain native same-model retries, not automatic post-failure cross-provider recovery. The adapter verifies the original binding. |
| Child failure reporting | Code inspection: `packages/pi-execution-adapter/src/index.js` handles `agent_settled` via `#completeSuccess` without checking its outcome. Reproduction/fix pending separate scope; do not interpret this extension as fixing child terminal reporting. |
