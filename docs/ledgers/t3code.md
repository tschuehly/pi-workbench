# T3 Code Evidence Ledger

## Scope

Source, tests, and official repository material from `pingdotgg/t3code` at commit [`32c6012dabdbd0eb178b25ea4225d889ec8f6475`](https://github.com/pingdotgg/t3code/commit/32c6012dabdbd0eb178b25ea4225d889ec8f6475), reviewed on 2026-07-22. The review focuses on orchestration, durable projections, provider boundaries, checkpoints, diff review, preview feedback, and suitability as a Pi Workbench shell.

## Findings

1. T3 Code is an implemented web, desktop, and mobile coding-agent shell with project, thread, provider, worktree, checkpoint, diff, review, and preview concepts.
   - Sources: [README](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/README.md), [architecture overview](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/docs/architecture/overview.md)
2. Its server accepts commands through a decider, persists resulting events and projections transactionally, records command receipts for idempotency, and publishes ordered changes after persistence.
   - Sources: [OrchestrationEngine](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/apps/server/src/orchestration/Layers/OrchestrationEngine.ts), [engine tests](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts#L365-L465)
3. The connection runtime separates transport, synchronization, projection, and client consumption. This is a useful implementation reference for Workbench `submit`, `inspect`, and `watch` behavior.
   - Source: [connection runtime](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/docs/architecture/connection-runtime.md)
4. T3 Code has a multi-provider driver boundary for Codex, Claude, Cursor, Grok, and OpenCode. Its provider sessions and turns are execution concepts owned by T3 Code.
   - Sources: [ProviderDriver](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/apps/server/src/provider/ProviderDriver.ts), [README](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/README.md)
5. The orchestration event catalogue primarily describes project and thread lifecycle rather than the Workbench Run lifecycle, authority envelope, dossier, attention, evidence, dispatch, and cleanup contracts.
   - Source: [orchestration contracts](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/packages/contracts/src/orchestration.ts)
6. Its checkpoint reactor records hidden Git references, turn diffs, and receipts. These mechanisms are useful observations and review inputs but do not establish Workbench authority or lifecycle state.
   - Source: [CheckpointReactor](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/apps/server/src/orchestration/Layers/CheckpointReactor.ts)
7. Diff review supports comments anchored to concrete targets, and preview annotations have structured contracts. These are strong foundations for Workbench Review Feedback and artifact-centered surfaces.
   - Sources: [review comment context](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/apps/web/src/reviewCommentContext.ts#L399-L438), [preview annotation contract](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/packages/contracts/src/ipc.ts#L864-L895)
8. The default runtime mode in the reviewed contracts is `full-access`. Workbench permissions must instead come from controller-validated named profiles and workspace leases.
   - Source: [runtime mode contract](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/packages/contracts/src/orchestration.ts#L117-L123)
9. The project describes itself as very early, warns users to expect bugs, and does not currently accept contributions. A permanent fork would carry meaningful integration and upstream-tracking cost.
   - Source: [README](https://github.com/pingdotgg/t3code/blob/32c6012dabdbd0eb178b25ea4225d889ec8f6475/README.md)

## Workbench Implications

- Use T3 Code's command-receipt, transactional projection, ordered-watch, diff-review, and preview patterns as implementation evidence.
- Treat T3 Code as a possible client shell with a distinct Workbench domain over `start`, `submit`, `inspect`, and `watch`.
- Represent target-anchored comments and preview annotations as durable typed Review Feedback connected to evidence and artifact revisions.
- Treat checkpoints, provider events, terminal output, and runtime receipts as observations or evidence that the controller reconciles.
- Compare a T3 Code adapter and a PI WEB adapter against one framework-neutral Run client and recorded fixture before selecting a shell.

## Rejected Transplants

- Do not add Pi as a T3 Code provider. That would create competing ownership between T3 Code threads and turns and Workbench Runs and Dispatches.
- Do not make T3 Code's provider layer, worktrees, checkpoints, approvals, or runtime modes authoritative Workbench state.
- Do not equate `Run` with `Thread` or `Dispatch` with `Provider Turn`.
- Do not adopt the multi-harness runtime. Pi remains the only model-worker harness.
- Do not accept `full-access` runtime mode as a substitute for the Autonomy Envelope, named execution profiles, or controller-issued workspace leases.
- Do not commit to a permanent T3 Code fork before the adapter fixture demonstrates a decisive product advantage over PI WEB and quantifies maintenance cost.

## Confidence and Limits

- Findings backed by implementation and tests are high confidence for the reviewed commit.
- T3 Code is moving quickly, so file layout, provider support, APIs, and contribution policy are time-sensitive.
- The source proves T3 Code's native thread workflow, not compatibility with the Workbench Run protocol. Adapter feasibility remains an experiment.
