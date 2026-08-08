# AFK autopilot production failure — evidence and trial implications

Status: observed failure report; non-authoritative input to a separate operating-level decision, contract, and implementation plan.

Related evidence: [`afk-autopilot-session-ledger.md`](afk-autopilot-session-ledger.md) records an earlier AFK session that stopped during reconnaissance and independently exposed prompt-versus-plan authority tension.

## Outcome

A PhotoQuest AFK Goal run ended as Pi Goal `complete` even though no production candidate existed and production Steps 4–8 remained unfinished. The production command had been rejected before the controller, child process, model workflow, or artifact production started. The run then spent its remaining work on diagnosis, judgments, settlement records, and a terminal report.

This was a product-level failure with two independent causes:

1. an invalid top-level controller invocation stopped production; and
2. the AFK extension allowed protocol-valid experiment closure to be reported as successful Goal completion.

The AFK extension's checkpoint coordinator path itself succeeded.

## Durable evidence

- Repository `skill-incubator`, AFK extension source commit: `09794dd9ae6ca567eb0aefdc22b626b02af8c6c2`
- Repository/worktree `PhotoQuest.pi-marketing-autopilot-v1`, terminal commit: `561e682bbe37886e27763fdb2f6b416f5b193ca5`
- Same PhotoQuest worktree, terminal report: `docs/business/marketing/studio/autopilot-v1/afk-experiment/terminal-report.json`
- Same PhotoQuest worktree, failed launcher record: `.scratch/pi-marketing-autopilot-v1/runs/v1-24-dynamic-attempt-02/terminal.json`
- Machine-local target Pi session ID: `019fde3e-d5df-7523-8b14-1a5350e1e2dc`
- Machine-local observer Pi session ID: `019fde43-cd48-743e-9adc-16ba7f3cc752`

The session records and ignored scratch artifact are machine-local evidence, not repository state.

## Reconstructed sequence

1. Preflight completed, received two judgments, committed evidence, checkpointed, compacted, and continued.
2. Phase 1 composed the guarded stage launcher around the top-level controller command.
3. The launcher rejected the command in about 88 microseconds: `production-command: guarded runtime accepts only a direct Pi invocation`.
4. The launcher had already created the one-shot namespace and terminal record before command validation.
5. Independent judgments converged on mechanical recoverability but could not decide whether the approval text treated the pre-spawn rejection as consuming attempt 02. An `escalate` verdict took precedence.
6. The plan routed the human boundary into autonomous diagnostic capacity instead of yielding immediately.
7. Diagnostics confirmed the direct controller shape worked and that no production workflow or candidate existed.
8. A final audit treated bounded experiment/report completion as sufficient and called `goal_complete`; its own summary said the production ladder was unfinished.

A deterministic log replay produced the same red signal three times:

```text
checkpoints=3 compactions=3 complete_with_unfinished_production=true
```

## Coordinator observations

All three target-session boundaries through the `skill-incubator` AFK extension followed this ordering:

```text
afk_phase_checkpoint
→ agent_settled
→ ctx.compact
→ one pi-goal continuation
```

That path showed no checkpoint race, duplicate continuation, or compaction failure in this run. This evidence does not validate the separate Pi Workbench `context-checkpoint` extension. The observer used `compact_and_continue`: one accepted request stayed pending for about four minutes while further tool calls ran, and a second request was rejected as already pending. The two coordinators require separate lifecycle tests.

The production guard also correctly rejected an impermissible command before child spawn. The defect was reservation ordering and ambiguous consumption semantics, not fail-open execution.

## Failure mechanisms

### Shell composition remained model-owned

The runtime documentation placed the direct controller command near a generic guarded-launcher example using the same run identifier. The model combined them. A deterministic controller should construct irreversible command shapes; prose should not be the final enforcement layer.

### Validation followed reservation

`run-guarded-workflow.py` created the namespace before command-policy and credential validation. Static rejection therefore left evidence indistinguishable from a consumed attempt unless a human interpreted the timing and process evidence.

The evidence supports evaluating static validation before atomic reservation and defining one machine-owned attempt-consumption transition, such as accepted workflow creation or child spawn. The authoritative contract must settle which event applies.

### Terminal predicates conflicted

The generated AFK objective reserved `goal_complete` for the entire intended outcome. The PhotoQuest plan separately allowed `goal_complete` when its bounded experiment and report became terminal while explicitly leaving production Steps 4–8 unfinished. The narrower process predicate won.

A protocol-valid stop did not prove successful outcome completion. A future AFK contract could distinguish at least:

- `succeeded` — acceptance is proven;
- `attention_required` — authority or external action is needed;
- `failed` — the run ended without satisfying acceptance.

If adopted, the contract rather than an invoked plan would own those meanings.

### Judgment was captured by the plan under review

Judges evaluated evidence inside the plan's transition table. The same table defined `escalate` as a route to further diagnostic work, so the gate could verify that behavior without challenging whether the plan had overridden the execution contract. Contract-vs-plan review needs an independent predicate outside the plan.

### Tests covered mechanics, not lifecycle meaning

The `skill-incubator` AFK extension's 11 unit tests passed. The separate Pi Workbench context-checkpoint coordinator's tests also passed. Across the two modules, tests covered parsing, checkpoint settlement, compaction coordination, and event validation. They did not run a real managed Goal through human-boundary and completion states.

The AFK extension was committed and the production session launched while its final independent re-review was still running. User urgency explains the sequence but does not make it an adequate release gate.

### Observation became model-driven polling

The observer stayed read-only with respect to the target worktree and production state while writing its own ignored scratch ledger. It recorded about 25.9 million cache-inclusive tokens, 237 model turns, 197 shell calls, and about $7.01 session cost. The target lead recorded about 15.0 million cache-inclusive tokens, 172 model turns, 133 shell calls, and about $13.44 session cost, excluding its judgment children. Cache reads dominated both token totals, so token totals alone overstate the observer's relative economics; by recorded lead-session cost it was about 52% of the target lead.

The polling loop woke on almost every append, causing a model turn about every few seconds. It initially repeated the target's completion framing instead of challenging it. This evidence favors deterministic event detection with explicit, finite incident-analysis budgets over continuous model polling.

### The operating level did not match the use

Pi Workbench V1 supports attended Level 1 work and explicitly provides no background managed Runs or recovery guarantee. The AFK extension is a session-scoped experiment layered over Pi Goal. The successful checkpoint mechanics do not turn it into durable unattended execution.

## Candidate requirements for a future decision

A separate decision, authoritative contract, and implementation plan would need to evaluate:

1. validating command, credential, contract, and profile inputs before reserving a namespace;
2. defining and testing the exact machine event that consumes a production attempt;
3. giving the top-level controller one typed launch path while keeping stage launchers internal;
4. adding an AFK finalization receipt and gating raw `goal_complete` on proven success;
5. mapping `stop`, `escalate`, human boundaries, and unfinished phases to an attention state;
6. auditing product acceptance separately from process/report completeness;
7. requiring finite turn or token budgets because machine-local Pi Goal configuration had unlimited automatic turns;
8. replacing model polling with one deterministic multi-run supervisor and incident-triggered repair sessions;
9. running disposable end-to-end trials for success, attention, compaction, observer, and repair paths; and
10. collecting and reconciling the final independent review before launch.

## Trial implications

Compare executor and branch behavior without consuming production authority:

| Dimension | Control | Treatment |
| --- | --- | --- |
| Executor | plain Pi Goal | completion-gated AFK Goal |
| PhotoQuest plan | original V1 branch | AFK-plan branch |

Use four isolated worktrees, separate run roots, and unique smoke namespaces. Give every arm the same bounded, non-production controller fixture and acceptance criteria. Add separate fault trials for malformed invocation, dead-running reconciliation, attention-required finalization, and repair preparation. Trial authority should positively name each writable root and permitted terminal transition; Review Studio, delivery, publication, production attempt IDs, and other arms' workspaces stay outside that envelope.

A deterministic supervisor observes each run. A repair Pi may reproduce and prepare a tested commit in a separate worktree. Applying a patch to a frozen run, creating a successor attempt, changing routes or acceptance, accepting a candidate, delivery, and publication remain Human Attention boundaries.

## Evidence proposed for an operating-level decision

These are candidate evidence requirements, not a promotion mechanism. Pi Workbench V1 has no unattended execution posture; any production AFK capability requires a separate operating-level decision and authoritative plan. Disposable trials could inform that decision by proving:

- successful runs checkpoint, compact, continue, and finish once;
- attention fixtures cannot become Pi Goal `complete`;
- static rejection occurs before reservation;
- an authoritative machine-readable contract names the sole attempt-consumption event and trials exercise it;
- every Goal has finite turn and token limits and stops at those limits;
- steady-state observation performs no model polling, while incident analysis reports its bounded model calls and cost;
- repair work never mutates an active run and produces a hash-bound reviewable receipt;
- process restart leaves authoritative state sufficient to classify and resume or stop; and
- a completion predicate owned outside the invoked plan passes independent cross-family challenge with no unresolved authority blocker.
