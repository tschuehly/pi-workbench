# Pi Package Catalog Evaluation

## Verdict

Pi Workbench should delegate **commodity execution mechanics**, not Run authority.

Use `pi-agent-browser-native` as the browser capability, adapt `pi-mcp-adapter` as a restricted MCP transport, and pilot `@narumitw/pi-lsp` for diagnostics. Build the Pi Execution sandbox adapter on `@carderne/sandbox-runtime` rather than adopting the interactive `pi-sandbox` policy layer.

Do not adopt package-level workflow, subagent, worktree, memory, plan-mode, permission, or dashboard systems. Those packages often implement useful products, but in Workbench they would create a second lifecycle, authority system, ledger, workspace owner, or client model.

## Catalog snapshot and method

The catalog was fetched on 2026-07-28 before evaluation:

- Source: [pi.dev package catalog](https://pi.dev/packages)
- Reproducible fetcher: [`scripts/fetch-pi-packages.py`](../../../scripts/fetch-pi-packages.py)
- Machine-readable index: [`pi-packages-index.json`](../generated/pi-packages-index.json)
- Human-readable index: [`pi-packages-index.md`](../generated/pi-packages-index.md)
- Observed packages: **5,398** over **108** server-rendered pages
- Declared resource tags: 3,070 extension, 357 skill, 108 theme, and 78 prompt occurrences; 2,039 catalog cards did not declare a resource type

The first pass screened every catalog card by name, description, resource type, downloads, version, author, and repository link. Keyword groups were deliberately overlapping: the catalog contains hundreds of packages mentioning orchestration, context, review, browser, UI, permissions, Git, and memory. This establishes coverage, not quality.

The second pass inspected the npm tarballs and central implementation paths of the packages most relevant to Workbench boundaries. Repository heads and test layouts were also sampled. Monthly downloads were used only as an adoption signal; they are neither security review nor evidence of architectural fit.

The catalog itself warns that Pi packages have full system access. Every adopted extension therefore needs an exact version, source review, health check, dispatch-scoped activation, and an explicit promotion decision before entering the curated harness.

## Maturity mismatch

The shortlisted packages are implemented and published. Their narrow mechanisms have source and, in several cases, substantial tests. Pi Workbench's core packages are currently placeholders while its contracts are substantially specified. A working package is therefore better evidence for a narrow mechanism than a planned local implementation.

The reverse applies at the system layer. None of the reviewed packages implements Workbench's fixed Controller Lifecycle, canonical projection, typed Dispatch/Episode protocol, immutable evidence, workspace landing contract, or Human-Attention Contract. Download counts cannot make a package authoritative for those concerns.

## Recommendations

### Adopt: native browser capability

**Package:** [`pi-agent-browser-native` 0.2.72](https://pi.dev/packages/pi-agent-browser-native) ([source](https://github.com/fitchmultz/pi-agent-browser-native), release commit `211a012c9b199d758768e8ba729f35e11e661f65`)

The package turns the external `agent-browser` executable into a native Pi tool. Its implementation adds managed-session lifecycle, stale-reference guards, bounded output and spill artifacts, credential-aware redaction, structured failure categories, artifact verification, Electron support, and platform doctor/smoke commands. The inspected release repository contained 56 test files and 90 extension source files.

- **Destination:** harness capability catalog and browser-capable Execution Profiles.
- **Delegate:** browser process/session handling, accessibility snapshots, interactions, screenshots, network inspection, browser evidence capture, and Electron automation.
- **Keep:** controller-approved capability resolution, URL/domain policy, credentials outside the repository, artifact promotion, and claim/evidence semantics.
- **Validation:** pin the package and compatible `agent-browser` version; run its doctor and macOS/Ubuntu smoke suites; execute a Workbench fixture that captures a screenshot and structured observation, then prove only the referenced Dispatch receives the capability.

This avoids building a browser driver and a Pi-native wrapper while preserving Workbench authority.

### Adapt: MCP transport and OAuth, not MCP authority

**Package:** [`pi-mcp-adapter` 2.15.0](https://pi.dev/packages/pi-mcp-adapter) ([source](https://github.com/nicobailon/pi-mcp-adapter), release commit `e588296e28b36a22b081d40fcfba76f418d6f84e`)

The package already implements stdio, HTTP/SSE, and Unix-socket transports; OAuth and bearer authentication; server lifecycle; direct and proxy tools; sampling/elicitation controls; immutable SDK config snapshots; output guards; metadata-only bounded traces; and stale HTTP-session recovery. The release repository contained 85 test files. Its default output guard caps inline MCP text and retains larger output outside Model Context.

- **Destination:** a restricted external-tool adapter used by Pi Execution.
- **Delegate:** MCP protocol framing, connection lifecycle, OAuth, tool discovery, output bounding, and transport recovery.
- **Adapt:** pass a controller-resolved immutable server snapshot; expose only allowlisted tools required by the Work Packet; disable sampling auto-approval; keep traces metadata-only; treat MCP UI as an optional projection.
- **Keep:** Publication, credentials, permissions, side-effect idempotency, and Run transitions outside MCP. A Worker must not receive arbitrary mutating Linear, GitHub, Sentry, or filesystem tools merely because a server exposes them.
- **Validation:** contract-test tool allowlists, oversized and malicious results, cancellation, stale sessions, missing credentials, and attempted calls outside the Work Packet. Prove a mutating MCP tool cannot bypass a controller-approved Publication action.

This can replace custom MCP client and OAuth work. It cannot replace deterministic external-system adapters where mutation receipts and idempotency are required.

### Adapt: OS sandbox engine, not interactive permission ownership

**Libraries:** [`@carderne/sandbox-runtime` 0.0.69](https://www.npmjs.com/package/@carderne/sandbox-runtime) and the [`pi-sandbox` 0.6.1](https://pi.dev/packages/pi-sandbox) integration as reference

`pi-sandbox` wraps bash with macOS `sandbox-exec` or Linux Bubblewrap and checks Pi file tools against allow/deny policy. Its underlying Apache-2.0 runtime is a maintained fork of Anthropic's experimental sandbox runtime. This is useful enforcement code, but the extension itself allows session toggles and interactive writes to global/project policy. That would let a Pi session alter authority independently of the Work Packet.

- **Destination:** `packages/pi-execution/` sandbox adapter.
- **Delegate:** platform sandbox construction and process confinement to `@carderne/sandbox-runtime`.
- **Adapt:** generate the policy solely from the controller-validated Execution Profile, Work Packet, workspace lease, and external-domain allowlist. Fail closed if confinement cannot initialize.
- **Keep:** permission grants, profile selection, workspace paths, and policy changes under controller authority. Do not expose `/sandbox-disable`, `--no-sandbox`, or package-authored persistent allowances to a Worker.
- **Validation:** escape tests on macOS and Linux; symlink and nonexistent-descendant cases; denied secret paths; network allowlists; subprocess inheritance; and deterministic refusal when the runtime is unavailable.

This is a strong deepening opportunity: Workbench owns one narrow `execute under resolved policy` interface while the library hides platform-specific sandbox machinery.

### Experiment: narrow LSP diagnostics

**Package:** [`@narumitw/pi-lsp` 0.35.0](https://pi.dev/packages/@narumitw/pi-lsp) ([source](https://github.com/narumiruna/pi-extensions))

The extension starts configured language servers only for a tool call, supports push and pull diagnostics, bounds discovery and timeouts, and shuts servers down afterward. It can also compute or write source fixes; writes default to false. The repository has focused LSP client/integration tests, but substantially less evidence than the browser and MCP candidates.

- **Destination:** verification-oriented Ship and independent-verification Execution Profiles.
- **Pilot:** expose `lsp_diagnostics`; block `write: true` source fixes unless a Ship Work Packet explicitly permits them. Prefer repository-native Gradle, TypeScript, and test commands as Primary Evidence.
- **Why not `pi-lens` initially:** `pi-lens` is broad and capable, but it combines LSP, linting, formatting, autofix, structural analysis, dependency installation, read guards, and agent nudges. Those automatic mutations and policy surfaces make fingerprint invalidation and causal evidence harder to reason about.
- **Falsifier:** reject the package if diagnostics are materially slower or less reliable than repository-native commands, if server setup becomes repository-specific maintenance, or if tool writes cannot be constrained mechanically.

LSP output is supporting evidence, not acceptance or verification authority.

### Experiment only outside authoritative judgment: structured questions

**Package:** [`@juicesharp/rpiv-ask-user-question` 2.1.0](https://pi.dev/packages/@juicesharp/rpiv-ask-user-question) ([source](https://github.com/juicesharp/rpiv-mono), inspected head `ae7936b5f9036c813d20d4000f272bbcbe3f52c5`)

The package provides a typed questionnaire, validation, cancellation envelopes, a polished terminal UI, RPC/ACP fallback to native dialogs, localization, and prompt lifecycle events. The inspected repository contained 30 package test files.

It should not carry Principal Judgment or In-Run Judgment directly: its answer returns to Model Context, its no-UI mode removes the tool, and it does not persist an Attention Item or revision-checked controller command.

A bounded pilot may use it for non-material intake clarification in an interactive Scout. For authoritative Workbench judgments, adapt its questionnaire schema and progressive fallback ideas into the Run protocol and clients so the answer is durably recorded before a model continues.

## Explicit rejects

| Package class or example | Decision | Reason |
| --- | --- | --- |
| Workflow/subagent/team/goal systems: `pi-subagents`, `@quintinshaw/pi-dynamic-workflows`, `pi-crew`, `pi-taskflow`, `pi-autopilot` | Reject | They duplicate Pi Execution actors, Semantic Execution Graph policy, budgets, retries, or coordination. Workbench must not add a second harness or controller. |
| Worktree and Git orchestration packages | Reject | Repository Workspace alone owns leases, candidate fingerprints, landing, and release. A package may supply Git parsing utilities but not choreography. |
| Permission extensions such as `@gotgenes/pi-permission-system` or the full `pi-sandbox` extension | Reject as authority | Prompt hooks and session toggles cannot define or expand the Autonomy Envelope. Reuse confinement mechanics beneath controller policy instead. |
| Memory systems such as `@remnic/plugin-pi`, `pi-hermes-memory`, `pi-memory`, and `open-zk-kb` | Reject | They create another durable knowledge/state channel and can silently promote generated conclusions. Continuation Artifacts, Primary Evidence, records, and explicit Learning Candidate promotion already define the boundary. |
| [`@plannotator/pi-extension`](https://pi.dev/packages/@plannotator/pi-extension) | Reject as workflow; study UI | Its annotations and code-review UI are useful evidence for Review Surface design, but its plan mode owns planning/execution phase, appends its own session entries, gates writes, and auto-approves when interactive review is unavailable. That conflicts directly with controller authority and terminal fallback requirements. |
| `pi-lens` | Defer | Broad automatic analysis and mutation make it harder to bind evidence to an exact candidate. Reconsider only after the narrow LSP pilot. |
| Cloud memory and default cloud tracing, including `@braintrust/pi-extension` | Reject by default | The inspected Braintrust extension can transmit user, assistant, tool-call, and tool-result content. Workbench telemetry should begin local and metadata-only; external export requires explicit configuration and data policy. |
| Pi web UIs, dashboards, sidebars, and alternate shells | Reject for Run semantics | PI WEB is the selected Run-protocol client direction. Another shell must not reinterpret Runs as native sessions or become authoritative state. |
| Generic Pi lifecycle notification packages | Reject for Workbench attention | Notifications based on `agent_end` or raw session events can disagree with canonical Attention Items. Reuse OS notification libraries behind the deterministic Watcher/client adapter instead. |
| Direct Linear, GitHub, Jira, or Sentry worker integrations | Reject for Publication | Read-only import may use restricted MCP/official SDK plumbing. Mutations need Workbench-owned idempotent adapters and receipts. |

## What should remain Workbench-owned

Packages cannot safely replace these deep modules and contracts:

1. **Run Controller:** legal lifecycle, revisions, idempotency, reconciliation, canonical state, control lease, and durable Attention Items.
2. **Pi Execution:** controller-mediated Dispatch/Work Packet/Episode contract, Cognitive Role resolution, continuity, independence, and bounded attempts.
3. **Repository Workspace:** workspace leases, contamination checks, candidate fingerprints, landing, and fail-closed release.
4. **Artifact Store:** immutable objects, provenance, retention, pinning, and evidence invalidation.
5. **Human-Attention Contract and Review Surfaces:** durable, revision-aware Principal and In-Run Judgments across terminal and graphical clients.
6. **Publication adapters:** explicit idempotent side effects and receipts for GitHub, Linear, Sentry, CI, and similar systems.

## Smallest useful next action

Create one curated harness package manifest with **only** pinned `pi-agent-browser-native` and a restricted `pi-mcp-adapter` configuration. Add capability health checks and run a Scout fixture that:

1. receives browser and one read-only MCP capability through its Execution Profile;
2. captures browser evidence and a bounded MCP result;
3. returns references in a typed Episode;
4. proves neither capability can mutate Run state or perform Publication.

After that fixture passes, implement the `@carderne/sandbox-runtime` adapter and run the narrow LSP experiment. Do not install the catalog wholesale or make any selected package globally active in every Dispatch.
