# FirstMate Evidence Ledger

## Scope

Official material and source from `kunchenguid/firstmate` covering its coordinator contract, worker isolation, supervision, current-state reconciliation, dispatch shapes, profiles, recovery, and cleanup. Reviewed on 2026-07-18.

## Findings

1. FirstMate gives the user one coordinating agent and delegates project work to workers in isolated Git worktrees. The coordinator is explicitly read-only over target projects and communicates with workers rather than performing project mutations itself.
   - Sources: [README](https://github.com/kunchenguid/firstmate), [Operating contract](https://github.com/kunchenguid/firstmate/blob/main/AGENTS.md)
2. A deterministic shell watcher classifies worker signals without a model turn, absorbs routine or provably active work, and wakes the coordinating model only for actionable conditions. Actionable wakes are durably queued before detector state advances.
   - Sources: [Architecture](https://github.com/kunchenguid/firstmate/blob/main/docs/architecture.md), [Watcher source](https://github.com/kunchenguid/firstmate/blob/main/bin/fm-watch.sh)
3. Append-only worker status lines are wake events rather than current-state truth. A separate reconciliation command computes current state from structured run state and live endpoint observations; dead or contradictory evidence produces `unknown` instead of reviving a stale event.
   - Sources: [Architecture](https://github.com/kunchenguid/firstmate/blob/main/docs/architecture.md), [Current-state source](https://github.com/kunchenguid/firstmate/blob/main/bin/fm-crew-state.sh)
4. FirstMate emits one structured fleet snapshot and derives its human-readable and bounded status views from that contract rather than making each view parse raw runtime files.
   - Source: [Architecture](https://github.com/kunchenguid/firstmate/blob/main/docs/architecture.md)
5. Project work has two authority shapes. A `ship` task changes and delivers a project; a `scout` investigates, plans, reproduces, or audits, produces a self-contained report, and never publishes. Separately authorized implementation promotes the existing scout rather than creating duplicate work.
   - Sources: [Operating contract](https://github.com/kunchenguid/firstmate/blob/main/AGENTS.md), [Architecture](https://github.com/kunchenguid/firstmate/blob/main/docs/architecture.md)
6. Dispatch profiles select a concrete harness, model, and effort tuple from natural-language project rules. The model applies the task judgment while deterministic launch code validates the selected concrete values.
   - Sources: [Architecture](https://github.com/kunchenguid/firstmate/blob/main/docs/architecture.md), [Configuration](https://github.com/kunchenguid/firstmate/blob/main/docs/configuration.md)
7. One session lock protects fleet mutation. A session that cannot acquire it remains read-only and cannot dispatch, steer, merge, drain attention, or repair shared state.
   - Source: [Operating contract](https://github.com/kunchenguid/firstmate/blob/main/AGENTS.md)
8. Worktree cleanup is fail-closed. Dirty or unlanded ship work is retained, and scout scratch space is not released until its report and completion conditions exist.
   - Sources: [Architecture](https://github.com/kunchenguid/firstmate/blob/main/docs/architecture.md), [Operating contract](https://github.com/kunchenguid/firstmate/blob/main/AGENTS.md)
9. FirstMate uses a turn-end guard to prevent a coordinating session from silently settling while tasks are in flight without a healthy, identity-matched watcher. Its Pi adapter reacts to structured lifecycle events, while several other runtime adapters require terminal or backend-specific fallbacks.
   - Source: [Turn-end guard](https://github.com/kunchenguid/firstmate/blob/main/docs/turnend-guard.md)

## Specification Implications

- Make the coordinator structurally non-mutating by withholding project-workspace write leases. Deliverable repository mutation occurs only through controller-approved ship dispatches; scouts may receive explicitly disposable scratch scope.
- Add `scout` and `ship` as dispatch authority shapes independent of coordinator, worker, and subagent execution profiles. A scout report does not authorize implementation; promotion is an explicit transition on the existing work item.
- Let the deterministic controller reduce immutable events and live observations into one canonical current-state snapshot. Raw logs and model messages may support reconciliation but never define current state directly; uncertainty remains `unknown`.
- Persist actionable attention before acknowledging its source event. Routine progress and duplicate signals remain observable without consuming a coordinator turn.
- Require one active control lease and one healthy supervision loop while work is in flight. Other clients remain read-only.
- Give the initial repository package a finite set of named execution profiles. The coordinator chooses among them and the controller validates the fully resolved dispatch rather than accepting invented permission combinations.
- Keep workspace release fail-closed until delivery, explicit discard, or a sealed scout report satisfies the workflow contract.
- Produce terminal summaries, notifications, AFK digests, and later graphical views from the same canonical run snapshot and attention records.

## Rejected Transplants

- Do not add multiple coding-agent harnesses, terminal multiplexers, backend adapters, or terminal-screen parsing. Pi is the only model runtime and provides structured lifecycle events.
- Do not add persistent coordinator hierarchies, social-media ingress, unlimited concurrency, or a blanket autonomy switch.
- Do not weaken independent verification for a faster delivery path. Delivery authority and autonomy remain subordinate to the workflow's quality envelope.
- Do not move operational invariants into a large always-loaded prompt. The controller enforces authority, state, supervision, and cleanup mechanically.

## Confidence and Limits

- The repository documentation and source agree on the central operating contracts, so the behavioral findings are high confidence.
- FirstMate's shell and terminal implementation solves a broader multi-harness problem than Pi Workbench and is evidence for the contracts, not a suitable runtime dependency.
- Its restart behavior includes process and backend reconciliation beyond Pi Workbench's confirmed V1 durability boundary. The workbench adopts live-host supervision behavior without expanding that boundary.
