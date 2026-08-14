# Deterministic supervision for unattended Goal sessions — 2026-08-14

**Status:** proposed operating pattern and future managed-design input. It does not expand the supported V1 boundary.

## Direction

Do not assign a second model to babysit an unattended Goal. Use an ordinary Pi Goal for continuous work and keep resumability, idempotency, attempt limits, artifact checks, and terminal settlement in the project controller, as required by Decision 100.

For unmanaged Goals today, supervision is a launch discipline plus passive observation. A future managed implementation belongs to the canonical **Watcher** and **Run Controller**: the Watcher classifies observations mechanically and creates durable actionable requests; the controller alone owns state transitions and recovery. Terminal-screen parsing, periodic model summaries, and ad hoc steering are not authoritative supervision.

## Field observation

The PhotoQuest pipeline benchmark exposed the failure mode:

- execution started before the independent contract review had settled;
- later reviews found real safety and isolation defects, so several contract revisions were injected into the live session;
- Terminal automation queued steering text while the model was busy, including one malformed prefix;
- the lead inferred status from rendered terminal contents rather than canonical Goal and project-controller state;
- the benchmark eventually produced eight successful masters, but preserved historical isolation violations correctly barred a success outcome;
- additional Review Studio work then continued as ordinary manual work while the original Goal remained blocked.

The recovery preserved evidence, but it was expensive and changed the execution conditions after launch. This is not a reusable supervision model.

## Supported near-term pattern

### 1. Lock before launch

Before sending `/goal`:

1. Freeze the referenced contract and record its content hash and starting commit.
2. Finish risk-required independent review and resolve every blocking finding.
3. Run the project controller's preflight for credentials, tools, budgets, isolation, and evidence paths.
4. Start one concise Goal that references the frozen contract.

A contract correction after mutation begins is a new revision boundary. Pause or settle the current Goal, preserve its evidence, and start an explicitly revised run. Do not pile corrections into a moving session.

### 2. Observe without inventing authority

Passive observation may report:

- canonical Goal state;
- project-controller receipts and queue state;
- session activity, usage, and provider errors;
- repository HEAD and authorized dirty paths;
- required test and artifact receipts.

Observation does not grant managed recovery, Acceptance, or authority to mutate the objective. Raw session events and terminal output remain evidence, not current state.

### 3. Intervene only on actionable conditions

An intervention requires one of these conditions:

- a Material Question;
- an authority or safety-boundary violation;
- unavailable credentials, model capacity, or required external capability;
- a no-progress guard already enforced by the Goal extension or a repeated-error threshold already enforced by the project controller;
- a project-controller attention state;
- a canonical Goal terminal or waiting state.

Routine progress causes no model turn. The same deduplicated condition causes at most one intervention until new evidence changes it. For controlled experiments, the intervention policy is identical across cells and every intervention is costed and recorded.

### 4. Respect terminal state

`complete`, `blocked`, `paused`, `usage_limited`, and `budget_limited` are distinct outcomes. A wakeup or assistant summary never proves success. Success remains unproven until the Goal state reconciles with project-controller receipts, repository state, required verification, and external effects.

A blocked Goal is not a container for unrelated follow-up work. Preserve its outcome, pause or close it as appropriate, and start post-run corrections or interface improvements as a new attended task or new Goal.

## Future managed shape

The future managed design uses existing Workbench boundaries rather than a new orchestration product:

```text
Pi execution observations ─┐
project-controller receipts ├─> deterministic Watcher ─> Attention Item / action request
repository and timer state ─┘                                  │
                                                               v
                                                        Run Controller
```

The Watcher:

- consumes typed observations, timers, leases, and project-controller receipts;
- deduplicates routine activity and repeated failures;
- records the source observation before acknowledging it;
- requests a bounded action such as continue, retry, cancel, reconcile, or seek Human Attention;
- never edits project files, changes the Workflow Contract, accepts outcomes, or publishes.

The Run Controller validates every requested action against the control lease, Workflow Contract, Autonomy Envelope, attempt budget, workspace state, and current revision. PI WEB and notifications consume the resulting canonical projection and Attention Items rather than interpreting transcripts independently.

## Minimum evidence record

A supervised execution needs one append-only record stream containing:

- run, Goal, session, contract-hash, and start-revision identity;
- accepted preflight receipt;
- observation cursor and canonical Goal transitions;
- project-controller receipts and repository fingerprints;
- intervention condition, deduplication key, requested action, and result;
- token, cost, timeout, and retry accounting;
- terminal audit and unresolved Attention Items.

This record is an evidence input to a managed Run ledger, not a competing source of truth.

## Bounded experiment before implementation

Do not implement a general supervisor in V1. If managed execution becomes an approved scope, first run one isolated experiment that:

1. observes Pi through typed lifecycle/session events rather than Terminal rendering;
2. applies a small deterministic rule set with no model calls;
3. proves duplicate suppression and one-control-lease behavior;
4. drills process loss, stale contract revision, provider exhaustion, unauthorized mutation, blocked Goal, and response loss;
5. demonstrates that project-controller safety remains authoritative and the Watcher can be removed without changing execution semantics.

Success means lower Human Attention without false completion, hidden failure, or a second controller. Until then, continuous AFK production defaults to an ordinary Goal with project-controller safety.
