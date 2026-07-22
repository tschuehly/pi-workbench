# Graphical Shell Strategy

Status: provisional candidate-selection contract.

## Decision

PI WEB and T3 Code are competing graphical-shell candidates. The Workbench does not depend on either shell, and neither candidate owns Runs, lifecycle transitions, authority, evidence, dispatch, or workspace leases.

The intended boundary is:

```text
                         +-> terminal client
Run Controller protocol +-> PI WEB client
                         +-> T3 Code client

Run Controller -> Pi Execution -> Pi sessions and processes
```

Every graphical mutation uses the controller's typed `start`, `submit`, `inspect`, and `watch` interfaces. All clients render the same canonical Run Snapshot, Attention Items, Judgment Dossier revisions, evidence references, and receipts.

## Integration Rule

Integrate T3 Code as a Workbench client domain, not by adding Pi to T3 Code's provider-driver abstraction.

A direct Pi provider connector inside T3 Code would give the shell responsibility for provider threads, turns, approvals, checkpoints, runtime modes, and worktrees while the Workbench controller separately owns Runs, Dispatches, authority, evidence, leases, and lifecycle. Those overlapping lifecycle owners would make replay, idempotency, recovery, and authority ambiguous.

The T3 Code adapter must therefore preserve these distinctions:

- A Workbench Run is not a T3 thread.
- A Workbench Dispatch is not a provider turn.
- T3 checkpoints and runtime observations are evidence, not authoritative Run transitions.
- Every control action is submitted to the Run Controller and receives a typed receipt.
- T3 Code may project diffs, previews, comments, and attention, but it cannot infer current Run state from provider or terminal output.

## Candidate Adaptation

### PI WEB

Use a browser plugin or narrow upstream extension seam to add Run status, Attention Items, Judgment Dossiers, evidence links, typed control actions, and task-shaped Review Surfaces. PI WEB's native Pi sessions, packages, terminals, machines, and mobile browser support reduce integration distance, but its plugin surface must prove structured Run observation and control.

### T3 Code

Add a distinct Workbench domain that consumes the Run protocol. Reuse T3 Code's project shell, connection runtime, ordered projections, diff review, target-anchored comments, preview annotations, and responsive clients. Do not reuse its multi-provider orchestration as Workbench execution authority.

## Selection Fixture

Candidate work begins after a controller vertical slice can execute and replay:

```text
start -> submit one decision -> durable record and receipt
      -> inspect canonical snapshot -> watch ordered changes -> replay
```

A framework-neutral TypeScript Run client and one recorded Run fixture drive both candidate adapters. The fixture covers:

- Run list and current status.
- Pending Attention Items.
- Judgment Dossier and Primary Evidence navigation.
- Diff-centered review with target-anchored typed feedback.
- Valid, duplicate, stale, and rejected control submissions.
- Ordered watch delivery, disconnect, reconnect, and snapshot reconciliation.
- Read-only behavior without the control lease.
- Terminal-equivalent outcomes for every supported graphical action.

## Selection Criteria

Choose the shell that satisfies the fixture with the smallest durable maintenance burden and no authority leaks. Compare:

1. Required invasive changes and dependence on private APIs.
2. Preservation of controller authority and domain boundaries.
3. Quality of attention, dossier, evidence, diff, preview, and feedback interactions.
4. Reconnect, replay, remote-machine, browser, mobile, and multi-workspace behavior.
5. Accessibility and terminal fallback.
6. Upstream contribution prospects and long-term fork cost.

Select T3 Code only if the Workbench can remain a distinct client domain and all mutations pass through the controller. Reject an integration that requires `Run = Thread`, `Dispatch = Provider Turn`, or T3 Code to launch and supervise Pi on the controller's behalf.

Select PI WEB only if its extension boundary can support the same typed observation, review, and control behavior without making unstable private routes part of the Workbench contract.

Until one candidate passes this evaluation decisively, the terminal client remains the reference interface and graphical shell selection remains open.

## Evidence

- [PI WEB interface evaluation](pi-web-interface-evaluation.md)
- [T3 Code evidence ledger](ledgers/t3code.md)
- [Pi ecosystem evidence ledger](ledgers/pi-ecosystem.md)
