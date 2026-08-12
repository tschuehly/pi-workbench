# Deepsec adoption experiment

Status: proposed experiment; implementation and adoption are not approved.

## Outcome

Determine whether a pinned Deepsec changed-file review adds enough confirmed, security-specific evidence to justify a risk-triggered place in the Pi Workbench implementation loop.

The experiment evaluates one bounded harness capability. It does not make Deepsec a universal verification step, replace deterministic checks or independent review, add another authoritative workflow, or grant Deepsec Run authority. Promotion requires owner review of measured finding yield, false positives, cost, Human Attention, and boundary compliance.

The source evidence and current recommendation are in [`../research/sources/deepsec.md`](../research/sources/deepsec.md).

## Experiment question

For an immutable implementation candidate containing security-relevant changes, does Deepsec's direct changed-file processing find confirmed material defects that the repository's deterministic checks and existing review would otherwise miss, at acceptable model-cost, elapsed-time, and Human Attention cost?

Baseline verification and review finish before Deepsec findings are revealed. A finding counts as useful only when Primary Evidence confirms it and identifies a required correction, changed residual risk, or missing verification obligation.

## Intended loop position

If the experiment succeeds, the capability would occupy this narrow position:

```text
implementation candidate
→ repository deterministic checks
→ risk-triggered Deepsec changed-file review
→ bounded finding disposition and, when justified, one correction/revalidation pass
→ required independent review and owner-facing evidence audit
```

Deepsec does not replace a repository safety floor. A scan with no findings proves only that this bounded scan produced no findings. A finding is a model claim until the affected code and behavior are inspected.

## Admission triggers

Admit only immutable candidate commits with a named base commit and at least one changed file involving:

- authentication, authorization, identity, permissions, or tenant boundaries;
- credentials, token handling, cryptography, or sensitive-data exposure;
- HTTP, RPC, webhook, queue, command-line, or agent-tool ingress;
- input validation, serialization, file paths, archive handling, or process execution;
- outbound network requests, redirects, proxying, or server-side request forgery risk;
- CI workflows, package installation, dynamic loading, sandboxing, or privilege boundaries; or
- another security obligation declared by repository policy.

Exclude routine prose, styling, generated output, snapshots, and low-risk mechanical changes except as negative controls. Process only trusted local candidates. The experiment does not execute untrusted pull-request code with a provider credential in scope.

## Invariants

- Pi remains the only model-worker runtime. Force Deepsec's `pi` backend; disable `codex`, `claude`, and Claude-only triage.
- Resolve provider, model, and Model Effort immediately before execution through `skills/model-orchestration/`. Deepsec defaults cannot select the binding.
- Launch from a minimal allowlisted environment. Remove gateway selectors and inherited provider secrets including `AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN`, `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `OPENAI_API_KEY`; pass the resolved provider and its narrowly named credential source explicitly. Any gateway-preference override, unknown-model gateway pass-through, credential-chain fallback, or observed binding mismatch fails closed.
- Phase 0 must resolve whether Deepsec's internal Pi session orchestration is compatible with Decisions 25, 71, 87, and 88. The experiment cannot silently bypass Workbench's Level 1 child-execution and model-binding boundaries.
- Deepsec is a bounded security-verification capability, not a Run Controller, Workflow Contract, Semantic Execution Graph, Workstream Store, Repository Workspace, Artifact Store, Acceptance authority, or publication client.
- The pinned Deepsec Pi backend must retain source-inspection-only tools. Shell, write, target-execution, unrestricted network, extension, ambient-skill, prompt-template, or context-file access fails the experiment gate.
- Deepsec installation, state, logs, generated matchers, file records, findings, and reports stay under an owned machine-local experiment root. Set `DEEPSEC_DATA_ROOT` to an absolute owned path and launch with a child working directory outside the target; nothing creates `.deepsec/`, `data/`, configuration, or another file in the target repository.
- Authentication remains in the existing machine-local Pi runtime. Copy no credential, auth file, session, provider key, or subscription state into the repository, experiment evidence, command arguments, or Model Context.
- Keep the target candidate immutable during a scan. Evidence names the base and candidate commits, exact manifest and source hashes, Deepsec version, model binding, and limits. Candidate drift invalidates the result.
- Findings never advance a lifecycle transition automatically. Every material finding receives an evidenced disposition.
- Perform no GitHub comment, status, push, pull-request, Publication, or remote-sandbox action.
- Allow one initial scan and at most one justified correction plus revalidation. Do not scan and remediate until models stop finding issues.

## Phase 0 architecture gate

Direct adoption is allowed to proceed only if one of these truthful execution shapes is compatible with current decisions:

1. **Bounded external Pi capability:** a Workbench-owned adapter launches pinned Deepsec, whose inspected Pi backend creates fresh in-memory, source-read-only Pi sessions. Workbench owns admission, binding, limits, observation, result normalization, and cleanup; Deepsec owns only internal security-analysis mechanics and generated local evidence.
2. **Scanner-only adaptation:** Workbench uses only Deepsec's deterministic scanner signals and assigns semantic security review through the existing Subagent mechanism. This preserves Decision 87 more strictly but changes Deepsec's essential review mechanism and must be evaluated separately.

If neither shape fits current decisions without creating a second child-execution owner or bypassing binding validation, reject integration. Because shape 1 reuses Deepsec's workflow and processing ledger, it conflicts with Decision 87 as currently written. Selecting it requires a prior owner-approved, dated candidate amendment in `docs/foundation/decisions.md` that names the external verification-capability exception and remains inactive until its adapter and tests land. The experiment plan itself cannot amend or weaken an agreed decision.

## Candidate capability seam

If Phase 0 selects the external-capability shape, create `packages/deepsec-adapter/`. The package owns deterministic preflight, launch, observation, timeout, normalization, and cleanup around a pinned external package. It does not reproduce Deepsec's scanner, prompts, coordinator, or state model.

```ts
interface DeepsecAdapter {
  inspect(request: DeepsecInspectionRequest, signal?: AbortSignal): Promise<DeepsecInspectionResult>;
}

interface DeepsecInspectionRequest {
  repositoryRoot: string;
  baseCommit: string;
  candidateCommit: string;
  files: string[];
  ignorePolicy: "default" | "no-ignore";
  cognitiveRole: "independent-review";
  limits: {
    maxFiles: number;
    maxTurns: number;
    batchSize: 1;
    concurrency: number;
    timeoutMs: number;
    maxOutputBytes: number;
  };
}
```

The model-facing request accepts no concrete model, shell fragment, arbitrary Deepsec subcommand, credential, publication option, workspace path, or mutable Git reference. The adapter resolves the binding itself immediately before launch, resolves an owned workspace from repository identity and capability version, invokes the executable directly without a shell, passes an exact `--files-from` manifest and explicit ignore policy, forces `--agent pi`, `--batch-size 1`, the resolved provider, provider-qualified model, and mapped effort, and enforces timeout externally.

The normalized result contains:

- execution outcome: `succeeded`, `cancelled`, `timed_out`, `failed`, or `outcome_unknown`;
- successful finding state: `findings` or `no_findings`;
- base and candidate commits plus manifest and source digests;
- `requestedFiles`, `investigatedFiles`, and bounded `droppedFiles: [{ path, reason }]`;
- the explicit ignore policy;
- pinned package version, source revision, and package integrity;
- requested and observed provider, model, and effort when available;
- Deepsec processing identifiers and machine-local evidence references;
- bounded findings with severity, affected file and lines, claim, recommendation, and provenance;
- usage, reported cost, duration, retries, refusals, and truncation when available; and
- cleanup status without embedding raw logs or repository content.

A malformed result, model-binding mismatch, changed manifest, refusal, quota stop, timeout without confirmed termination, corrupt workspace, unsupported source version, or missing evidence fails closed. Every requested file must appear in `investigatedFiles`; a dropped file is accepted only when its exact reason was declared before launch, and no accepted drop can be part of a measured seeded control. Deepsec exit code `1` alone cannot distinguish findings from an incomplete run. `outcome_unknown` cannot satisfy verification.

## Finding disposition

Each net-new finding receives exactly one disposition:

- `confirmed-remediated`: Primary Evidence establishes the defect and the candidate is corrected and reverified;
- `false-positive`: Primary Evidence shows the claim does not hold;
- `duplicate`: an existing test, review finding, or tracked obligation already covers the same defect;
- `accepted-residual-risk`: the owner or existing repository policy accepts the evidenced residual risk; or
- `deferred-material-question`: evidence is insufficient or the required judgment is outside the experiment.

A model's severity, confidence, or revalidation verdict is not Primary Evidence. Every disposition names the relevant source, test, command output, prior finding, or owner judgment. A deferred Material Question remains visible and cannot be presented as a pass.

Use Deepsec revalidation only when it is the shortest safe route to clarify a material claim after direct source inspection. It remains another model judgment, not a substitute for direct evidence.

## Experiment corpus

Use two sets:

1. **Seeded controls:** six immutable fixture commits with one known security defect each and six matched negative controls. Cover authorization omission, command or argument injection, path traversal, unsafe parsing or deserialization, server-side request forgery, and credential or sensitive-data exposure without real secrets or external effects. Before freezing the corpus, use `ignorePolicy: "no-ignore"` and prove every requested fixture path becomes an investigated `FileRecord`; otherwise replace the fixture path.
2. **Real candidates:** at least ten security-triggering implementation candidates from Workbench or another owner-approved trusted repository. Historical accepted fixes may fill gaps. Preserve the original base, candidate, deterministic verification, and pre-Deepsec review evidence.

Do not tell the baseline reviewer which seeded defect is present. Reveal Deepsec findings only after baseline evidence is sealed. Mix positive and negative controls so each invocation cannot presume a vulnerability.

## Measurements and decision rule

Record per candidate:

- admitted files and risk trigger;
- baseline deterministic and independent-review findings;
- Deepsec findings by disposition and severity;
- confirmed material defects unique to Deepsec;
- seeded-defect detection and negative-control false positives;
- binding, turns, tokens, reported cost, retries, elapsed time, and cache behavior;
- Human Attention spent understanding and disposing findings;
- corrections caused by Deepsec and defects introduced by those corrections; and
- workspace, credential, process, network, and cleanup results.

Before the measured corpus begins, use one calibration fixture to propose an owner-approved per-run and campaign budget. Do not infer a hard dollar ceiling from Deepsec setup controls: direct `process` exposes file, turn, batch-size, and concurrency flags, while the adapter supplies the external process deadline; direct processing does not expose the same setup-level cost limit.

Recommend **adopt** only when all conditions hold:

1. every boundary and cleanup check passes;
2. at least four of six seeded defects are detected;
3. at least five of six negative controls avoid a false-positive material finding;
4. at least one confirmed material finding in the real-candidate set was missed by baseline checks and review;
5. at least half of material findings are confirmed or duplicate rather than false-positive or deferred;
6. elapsed time, cost, and disposition attention remain within the owner-approved budget; and
7. no Deepsec-driven correction introduces an equal-or-higher-impact defect.

Recommend **adapt** when value is limited to a narrower trigger, language, or subsystem. Recommend **reject** when Deepsec finds no unique material defect, misses more than half the seeded defects, exceeds the false-positive or budget bounds, cannot preserve Pi-only routing and source-read-only tools, leaks state or credentials, or cannot terminate and clean up reliably.

These thresholds govern promotion to a maintained risk-triggered capability. They are not a general security benchmark.

## Delivery phases

### Phase 0 — Compatibility, provenance, and calibration

1. Pin the Deepsec package version, source commit, package integrity, license, and transitive lock. Preserve Apache-2.0 notices for adapted material; prefer invoking the package over copying code.
2. Resolve the architecture gate above against current decisions and record the selected or rejected execution shape.
3. Verify from source and runtime observation that `--agent pi` creates fresh in-memory Pi sessions with only read, grep, find, and list tools and no ambient resources.
4. Prove a Workbench-resolved provider-qualified model and Model Effort can reach Deepsec under the allowlisted environment and explicit provider override. Exercise and reject ambient gateway preference, unknown-model gateway pass-through, direct-key gateway fallback, and observed binding mismatch.
5. Create an owned temporary Deepsec workspace and absolute `DEEPSEC_DATA_ROOT` outside the target, launch from outside the target, process one synthetic changed file with `--batch-size 1`, export a bounded result, and delete the workspace. Confirm Git state is unchanged and no target `.deepsec/`, `data/`, or other untracked path appeared.
6. Interrupt installation, processing, and cleanup separately. Classify every outcome and prove no live child remains after confirmed cancellation or timeout.
7. Inspect process environment, arguments, logs, Pi storage, and workspace files for credential or auth-state copies. Confirm no persisted Pi model session is created.
8. Measure one positive calibration fixture and obtain owner approval for file, turn, concurrency, timeout, output, per-run cost, and campaign bounds.

**Gate:** stop before adapter implementation if the execution shape, Pi-only binding, source-read-only tools, external workspace, credential handling, termination, or binding evidence cannot be proven.

### Phase 1 — Deterministic adapter and fake protocol

1. Create `packages/deepsec-adapter/` with injected process, filesystem, Git, clock, and binding-verifier seams.
2. Write failing interface tests for immutable commit resolution, manifests, limits, no-shell launch, binding mismatch, malformed output, response bounds, refusals, quota stops, cancellation, timeout, unknown termination, and cleanup.
3. Add a fake executable that emits bounded fixtures for every result. Tests must not install Deepsec, invoke a model, read normal Pi state, or contact a provider.
4. Keep the package outside the five deep modules of Decision 65. Do not add a skill, PI WEB surface, or default loop integration.

**Exit:** deterministic tests establish the adapter boundary without trusting Deepsec behavior.

### Phase 2 — Isolated live smoke

1. Install the pinned package under a fresh machine-local experiment root.
2. Resolve one current `independent-review` binding, force the Pi backend, and inspect observed metadata.
3. Run one positive and one negative calibration fixture with fixed manifests, `ignorePolicy: "no-ignore"`, `batchSize: 1`, verified requested/investigated equality, and fixed limits.
4. Normalize and disposition findings, inventory generated files and processes, and clean up.
5. Run the Workbench root suite and prove no repository manifest, configuration, skill catalog, Workstream record, or normal Pi session changed.

**Exit:** live observations agree with the adapter contract and remain within the approved calibration budget.

### Phase 3 — Blinded seeded controls

1. Freeze the twelve seeded candidates and hidden expected outcomes only after every requested fixture file survives resolution and creates a corresponding `FileRecord` under `ignorePolicy: "no-ignore"`.
2. Run deterministic checks and baseline independent review first; seal their results.
3. Run Deepsec with identical limits, then disposition every finding against fixture evidence.
4. Record misses as well as findings. Do not tune prompts, matchers, models, or limits between fixtures.
5. Calculate detection, false positives, duplicate yield, cost, elapsed time, and Human Attention.

**Gate:** stop before real candidates if a boundary fails, fewer than three seeded defects are detected, or more than two of six negative controls produce false-positive or deferred material findings.

### Phase 4 — Real-candidate comparative pilot

1. Select at least ten candidates through the admission triggers without selecting for likely Deepsec success.
2. Seal baseline verification and review before each Deepsec run.
3. Run the pinned capability against the exact candidate manifest.
4. Disposition findings and permit at most one correction/revalidation pass.
5. Capture unique yield, duplicate yield, later-discovered misses, correction quality, cost, elapsed time, and Human Attention.

No result is published externally. Real-candidate evidence remains in its owning repository or machine-local experiment store unless a sanitized aggregate is explicitly approved.

### Phase 5 — Evaluation and promotion

1. Evaluate every decision threshold, including negative and inconclusive results.
2. Ask a fresh cross-family reviewer to challenge dispositions, baseline fairness, boundary evidence, and the recommendation.
3. Present `adopt`, `adapt`, or `reject`, the narrowest trigger set, expected recurring cost, blind spots, and removal conditions for owner judgment.
4. Only after owner adoption, update `docs/contracts/harness.md`, record a settled decision in `docs/foundation/decisions.md`, add a repository or Working Mode trigger, and create the smallest relevant skill or presentation.
5. If rejected, remove the experimental package and machine-local installation while retaining the source ledger and sanitized evaluation.

## Verification matrix

Deterministic and live evidence together cover:

- exact base and candidate commit resolution;
- changed, deleted, renamed, ignored, generated, oversized, and out-of-root files;
- empty and over-limit manifests;
- provider, model, and effort match and mismatch;
- rejection of ambient gateway preference, unknown-model gateway pass-through, and credential-chain fallback;
- enforced Pi backend and rejection of other backends;
- source-read-only model tools and absence of target execution;
- no-shell launch and argument handling;
- absolute `DEEPSEC_DATA_ROOT`, an external child cwd, and absence of target `.deepsec/`, `data/`, configuration, untracked paths, or Git changes;
- machine-local workspace corruption, reuse, and cleanup;
- requested/investigated file equality and explicit reasons for every dropped manifest entry;
- silent ignore-filter and missing-`FileRecord` drops;
- malformed, partial, oversized, duplicate, contradictory, and refused results;
- exit `0` with no findings, overloaded exit `1`, and other runtime failures;
- cancellation before launch, during processing, and during cleanup;
- timeout with confirmed termination and `outcome_unknown` without it;
- stale-result invalidation after candidate or manifest changes;
- missing, stale, degraded, and exhausted quota evidence;
- source-path, snippet, log, and output bounds;
- no credential, auth, or normal Pi-session copy; and
- positive controls, negative controls, baseline misses, and correction regressions.

## Stop conditions

Stop and request owner judgment if:

- neither execution shape fits current Level 1 decisions;
- Deepsec cannot use the exact Workbench-resolved Pi binding without fallback;
- the Pi backend exposes mutation, shell, target-execution, ambient resource, or unrestricted network tools;
- a credential or auth artifact must be copied, serialized, or exposed to Model Context;
- the target must contain generated Deepsec state;
- untrusted code must execute with provider credentials in scope;
- cancellation or timeout cannot distinguish confirmed termination from unknown outcome;
- findings cannot be tied to immutable source and producing evidence;
- the experiment would create a second canonical ledger, lifecycle, Acceptance gate, or publication path;
- campaign spend or Human Attention reaches the approved bound; or
- Phase 3 reaches its early failure gate.

## Out of scope

- A whole-repository legacy-code audit.
- Deepsec as a mandatory step for every implementation.
- Deepsec Codex, Claude, triage, Vercel Sandbox, GitHub comment, and CI publication paths.
- Automatic remediation, repeated reinvestigation waves, or scanning until models stop finding issues.
- Treating Deepsec severity, confidence, revalidation, or a zero-finding run as authoritative verification.
- Adding managed Runs, a Run Controller, new Workflow Contract semantics, or a PI WEB security dashboard.
- Copying Deepsec orchestration, state, prompts, branding, or source code into Workbench.
