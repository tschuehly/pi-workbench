# Current Quality Loop Evidence Ledger

## Scope

Local inspection of the `quality-loop`, `claudex-quality-loop`, and agent-orchestration contracts on 2026-07-16 to identify durable quality requirements and run-specific orchestration choices.

## Observed Contract

1. The Quality Loop dispatches a fixed progression through Design, semantic Chapters, System Story, and Delivery using `next.sh` and ledger-bound session scopes.
2. It requires exact Design approval before implementation and exact System Story acceptance before the final pull request.
3. It prescribes fresh-session boundaries, default role bindings, review-board roles, a one-time Craft pass, and Chapter-level RED-to-GREEN coherence.
4. It preserves valuable invariants: durable run state, explicit decisions and deviations, one writer at a time, structured findings, primary evidence, independent verification, human authority, and explicit delivery.
5. Agent orchestration adds validated handoffs, workspace and process leases, durable checkpoints, bounded role ownership, and reconnect-based resumption.
6. The Design and System Story artifacts provide valuable before-and-after judgment surfaces even when their fixed position in the execution sequence is not required.

## Classification

### Quality and safety invariants

- Durable state is authoritative; conversations are disposable execution context.
- Every mutation has an authorized actor and non-overlapping workspace lease.
- Material completion claims have primary evidence and independent scrutiny.
- Human authority controls impact expansion, material decisions, acceptance, and external publication.
- Deviations, retries, findings, dispositions, and skipped work are recorded.
- Analysis, compounding, promotion, sealing, and cleanup close the run.

### Run-specific orchestration choices

- Whether the task needs a separate design artifact.
- Whether work should be split into Chapters or another decomposition.
- Which worker roles, models, and review lenses are useful.
- Which steps run sequentially or in parallel.
- Whether a prototype, test-first slice, browser check, architecture review, or security review is warranted.
- When a fresh context is more valuable than a persistent specialist.

## Specification Implications

- The repository workflow defines a quality and authority envelope rather than a universal phase sequence.
- A Pi coordinator proposes a typed, versioned execution graph from current evidence.
- The deterministic controller validates graph mutations and worker dispatch without deciding the semantic work sequence.
- Quality scales with repository policy, task risk, reversibility, and evidence needs.
- Graph revisions and their rationales become inputs to run analysis and workflow compounding.
- Preserve the strongest pre-implementation and post-implementation reasoning in one versioned judgment artifact, with agent disagreements and responses retained as evidence-linked deliberation threads.

## Confidence

- The observed Quality Loop behavior and agent-orchestration contracts are high-confidence local evidence.
- The quality-versus-orchestration classification is a design judgment to validate through pilot runs.
