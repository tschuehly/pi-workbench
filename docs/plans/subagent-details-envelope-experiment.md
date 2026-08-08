# Subagent presentation-details envelope experiment

Status: approved experiment plan; implementation not started. This is the producer-side experiment for the owner-approved conversation-native subagent cards in [`pi-web-subagent-conversation-cards.md`](pi-web-subagent-conversation-cards.md). It does not implement PI WEB cards or change Level 1 child authority.

## Outcome

Make one bounded, versioned presentation envelope available on every `subagent` progress update and terminal result. The envelope gives PI WEB stable execution facts without parsing prose or exposing raw thinking. In parallel, expose the child Pi session identifier on the adapter's initial verified-binding observation so a running child can become inspectable as soon as its runtime identity is proven.

The experiment ends at the producer seam. PI WEB rendering, read-only transcript inspection, the selected-session child index, and browser presentation remain later phases in `docs/plans/pi-web-subagent-conversation-cards.md`.

## Experiment question

Can `packages/pi-execution-adapter/` and `extensions/subagent/` produce one bounded details contract that represents every supported lifecycle state, survives live-update replay, and leaves the compact model-facing tool result unchanged?

The experiment passes only if consumers can derive lifecycle, runtime, progress, and outcome from validated fields. Labels or diagnostics may remain human-readable text, but consumers must not infer state by parsing them.

## Invariants

- One invocation still launches one fresh child Pi for one bounded attended assignment.
- The details envelope is presentation state, not a Workstream record, Episode, managed Dispatch, or durable Logical Actor.
- Raw thinking text never enters adapter observations, the envelope, fixtures, logs, or parent Model Context.
- `cancelling` remains distinct from terminal `cancelled`; `outcome_unknown` remains distinct from failure.
- A child session ID is emitted only after provider, model, and Model Effort match the resolved binding.
- `content` remains the compact model-facing result. Rich `details` must not be copied into `content` or prompt text.
- Missing, malformed, oversized, or unknown-version details must remain renderable by PI WEB's generic tool fallback later.

## Isolated workspace

Use one Workbench worktree:

Execution is attended in an `exp/subagent-details-v1` worktree created after the plan commit; never work on `main` or consume another run's state. Limit implementation to:

- `packages/pi-execution-adapter/`;
- `extensions/subagent/`;
- their focused tests and package-local documentation;
- the approved 20,000-character task bound in `docs/plans/level-1-subagents.md`; implementation must update the extension README when enforcement lands.

Do not edit `../pi-web`, Workstream schemas, or unrelated plans. Implement the pure projector and injected extension core as sibling `.mjs` modules with sibling `*.test.mjs` files under `extensions/subagent/`, which the existing root test glob executes. Keep `index.ts` as a thin construction adapter over that tested core. Add an aggregate-gated no-model load check that requires the `pi` binary, starts Pi RPC with `--offline --no-session --no-extensions -e extensions/subagent/index.ts --tools subagent` from a temporary `cwd` under a fresh temporary `HOME` and `PI_CODING_AGENT_DIR` in an allowlisted credential-free environment, sends `get_state`, requires the returned model to be unknown, fails on any `extension_error` or startup error, and closes stdin. This proves only that the real TypeScript entry point loads offline. A separate injected-API test must call the same registration adapter and assert exactly one `subagent` tool registration; no RPC command exposes a tool inventory.

## Target envelope

Use the selected plan's `SubagentExecutionDetailsV1` as the starting contract. Keep the public discriminator and version stable:

```ts
{
  kind: "pi-workbench.subagent-execution";
  version: 1;
  executionId?: string;
  acceptedAt?: string;
  input: { task; profile; cognitiveRole };
  state: "preflight" | "launching" | "running" | "cancelling" | "terminal";
  runtime?: { provider; model; effort; quotaAdmission; quotaTelemetryStatus };
  childSessionId?: string;
  observations: BoundedPresentationObservation[];
  outcome?: ExecutionOutcome;
  resultText?: string;
  diagnostic?: string;
}
```

Before implementation, lock an exact lifecycle table covering all extension tools: `subagent`, `subagent_collect`, `subagent_status`, and `subagent_cancel`. A background launch may return a compact handle envelope, but later status, collect, and cancellation must project the same execution identity and compatible state rather than inventing unrelated detail shapes.

The adapter remains the source for `profile`, `cognitiveRole`, and `acceptedAt`; extend or use `status()` rather than fabricating them. The extension-local launch map remains the source for the exact bounded task. If a collect/status path finds an adapter execution but no matching launch metadata, it returns the generic fallback with an explicit provenance diagnostic; it must not emit a V1 envelope with `"unknown"` profile/role or a fabricated timestamp.

Bounds are measured as UTF-8 bytes after JSON serialization, not only by array length. V1 accepts a task of at most 20,000 characters, keeps at most 30 envelope observations, bounds each presentation label to 500 characters, retains the adapter's 50,000-character result and 8,000-character diagnostic limits, and caps the complete serialized envelope at 128 KiB. Inputs that exceed the task limit fail preflight before child launch. The authoritative Level 1 child plan defines the approved preflight bound; this implementation adds enforcement and then updates the extension README. The extension launch map retains the exact accepted task plus a separate 200-character preview; missing launch provenance uses generic fallback rather than a truncated task presented as exact.

If the serialized envelope exceeds 128 KiB, deterministically trim `resultText`, drop oldest observations, then trim `diagnostic`, recording field-level and envelope-level truncation markers. Never remove schema, execution identity, verified child-session identity, lifecycle/outcome, timing, usage, or the exact accepted task, and never discard the whole envelope for size alone. The visible progress log renders at most 10 entries while the envelope retains at most 30. Do not expose arbitrary adapter `detail` objects.

## Delivery sequence

### Phase 0 — Freeze fixtures and lifecycle mapping

1. Capture deterministic adapter event streams for preflight failure, launching, verified binding, quota degradation, assistant/thinking progress counts, tool progress, usage, diagnostics, settlement reconciliation, cancellation requested, confirmed cancellation, success, execution failure, timeout, and unknown termination. Add one unknown-future observation type that projects to a bounded generic activity label without exposing arbitrary detail.
2. Define the public observation shape exactly as `{ sequence, at, kind, label, toolName?, isError? }`. Map adapter `type` to nested `kind`, preserve `sequence`, and derive only bounded labels from allowlisted scalar facts; the top-level `kind` remains the envelope discriminator.
3. Define lifecycle precedence for duplicate, delayed, or out-of-order terminal observations.
4. Define how background `launched`, status single/list, detached collect, resumed collect, and cancellation reuse the same projector. `launched` and `detached` are intermediate states, never terminal `ExecutionOutcome` values.
5. Add malformed and oversized fixture cases before implementing the projector.

Exit: table-driven fixtures define every public state without UI copy or prose parsing.

### Phase 1 — Expose initial child identity

1. Add `sessionId` to the first `binding_verified` observation emitted from the initial `get_state` response.
2. Keep the later success verification consistent; do not regress final result metadata.
3. Update `packages/pi-execution-adapter/src/index.d.ts` and adapter documentation.
4. Test that no `sessionId` is emitted before binding verification or after a mismatch.
5. Test that the emitted session identifier matches `status()` and the terminal result.

Exit: a running child has a verified, stable session identifier before its prompt begins.

### Phase 2 — Implement a pure envelope projector

1. Add a side-effect-free `.mjs` projector and an injected `.mjs` extension core under `extensions/subagent/`; `index.ts` supplies the real adapter and resolver.
2. Accept only typed execution inputs, receipt/binding facts, normalized observations, and optional terminal result.
3. Map adapter observations to a small allowlisted presentation vocabulary and bounded labels.
4. Enforce string, array, and serialized-size limits in one place.
5. Return immutable snapshots so later updates cannot mutate details already emitted.
6. Reject programmer-invalid lifecycle combinations in tests; degrade untrusted runtime data to a safe diagnostic rather than manufacturing success.

Exit: the projector independently passes the complete lifecycle fixture table.

### Phase 3 — Route every extension result through the projector

1. Replace ad hoc progress `details` in `streamToResult` with V1 envelopes.
2. Use the same projector for terminal results.
3. Represent preflight failures that occur before execution receipt without inventing an execution ID or child session ID.
4. Represent background launch, status, collect, detached observation, and cancel consistently. Recover profile, role, and accepted time from adapter status; require extension launch metadata for the exact task.
5. Preserve existing compact `content`, `isError`, cancellation propagation, the 30-observation envelope window, and the separate 10-entry visible progress log.
6. Ensure a failed independent child remains explicitly reported as failed to the parent.

Exit: every known extension failure with schema-valid input produces a valid V1 preflight or terminal envelope. A path missing trustworthy launch provenance produces the ordinary generic fallback with an explicit diagnostic, never guessed V1 fields.

### Phase 4 — Compatibility and real smoke evidence

1. Run adapter and extension tests, including concurrent children and cancellation, then run the unconditional no-model Pi RPC load check for `index.ts`.
2. Verify old stored tool records remain ordinary data; do not add a migration that rewrites sessions.
3. Resolve current quota/runtime bindings through `skills/model-orchestration/`. Execute one real child success and cancellation in an explicitly approved isolated session root. When no isolated session root is available, record real smoke as unavailable rather than importing credentials or writing normal Pi session storage.
4. Inspect the persisted parent tool result and prove rich details did not enter model-facing text.
5. Confirm the child transcript contains no leaked parent transcript and that the envelope contains no raw thinking.

Exit: deterministic and real evidence agree on lifecycle, identity, bounds, and context separation.

## Verification matrix

Tests must cover:

- all seven terminal outcomes;
- preflight before receipt and launch before binding verification;
- fresh and degraded quota telemetry;
- verified session identity and runtime mismatch;
- tool start/progress/end with error state;
- cancelling before confirmed cancellation;
- timeout using the cancellation path;
- outcome unknown after unconfirmed termination;
- duplicate and out-of-order observations;
- more than 30 observations and maximum-length task/result/diagnostic fields;
- the 128 KiB serialized-size limit, deterministic degradation order and markers, and no arbitrary nested detail passthrough;
- two concurrent background children with independent envelopes;
- detach, status, collect, cancel, and terminal replay;
- no raw thinking content in any public field;
- unchanged compact model-facing `content`.

Run:

```sh
npm run test:pi-execution-adapter
npm run test:subagent-extension
npm test
```

Use a fake RPC process for deterministic failure paths. Real smoke is supplementary and must use an owner-approved isolated Pi configuration/session root; it never writes normal session storage.

## Pi worker assignment and supervision

One bounded Pi worker under the governing Goal lead can own this worktree. Give it the selected implementation plan, exact module boundaries, and the requirement to stop before PI WEB work.

The supervising lead should inspect after:

1. lifecycle table and failing tests;
2. initial `binding_verified.sessionId` implementation;
3. pure projector and bounds;
4. extension integration;
5. deterministic suite;
6. real smoke evidence.

Pause the worker if it changes Workstream state, adds child continuation/resume behavior, exposes raw adapter details wholesale, changes model-facing output materially, or presents prompt instructions as sandbox enforcement.

## Completion criteria

The experiment is complete when every supported subagent lifecycle with trustworthy launch provenance produces one bounded V1 details envelope, missing provenance falls back without guessed values, a running child session ID appears only after binding verification, compact parent context remains unchanged, deterministic registration/projector tests and the real `index.ts` offline load gate pass, and quota-gated real evidence either passes or is explicitly unavailable. PI WEB can then implement its projection from fields rather than prose. Promotion to the PI WEB card phase requires an independent consumer review of the frozen fixture contract.
