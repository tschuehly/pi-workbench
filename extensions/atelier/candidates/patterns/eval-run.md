# Run and grade an eval

Candidate Pattern · ME · Owner-spec. An offered arrangement, not a Registry admission or
content rule (107/117). Choose and change it for the task; no prescribed word count or page schema.

## When it helps
Choose an automated eval, follow its progress and keep human corrections distinct from judge output.

## Components and hierarchy
1. [observation-stamp](../components/observation-stamp/README.md) precedes [run-request](../components/run-request/README.md): build, config and truth snapshot before queueing.
2. [progress-groups](../components/progress-groups/README.md) reports turns complete; [review-filter](../components/review-filter/README.md) selects pending work.
3. [evidence-disclosure](../components/evidence-disclosure/README.md) contains reply, Calls, log and raw record; [grade-axes](../components/grade-axes/README.md) separates Correct/Complete/Taste.
4. [item-pager](../components/item-pager/README.md) moves to the next item; confirmed-collapse remains a page-local choice.
5. [decision-context](../components/decision-context/README.md) handles a disputed test; [edit-set](../components/edit-set/README.md) proposes bulk edits.
6. [action-dialog](../components/action-dialog/README.md) keeps start/stop/arm or diagnostics apart from ordinary grading.

## Kernel / Keys
set-ID/turn-ID for definitions; run-ID/turn-ID/axis for results. Criteria hash in atl-ver. Verdict Record does not wake the agent; an explicit Request starts diagnosis or issue creation.

## Evidence for and against
[ME §2 T1–T6/T8](../SOURCES.md#use-cases), manual owner grading and B briefing; no eval studio existed at cutoff. AgentClick supplies ID-bound edits, not a mandatory app framework.

## Boundaries
Required override note, judge prefill and saved-state auto-advance need the integration work listed in INTEGRATION.md. One-heavy-job queue belongs to the domain. A form never executes arbitrary commands.
