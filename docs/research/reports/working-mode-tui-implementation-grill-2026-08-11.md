# TUI-first Entry Preset implementation grill — 2026-08-11

**Status: SUPERSEDED 2026-08-26.** Do not implement any part of this document.

Workstream `ws-multidimensional-working-mode`, revision 6, recorded the owner's 2026-08-25
acceptance of the bounded three-value `Optimize for: Feedback | Balanced | Assurance` experiment.
No implementation followed. On 2026-08-26 the owner grilled the design from first principles and
could no longer read those three value names back — the shape was right, the naming was not. The
settled replacement names the axis by behavior (`Checking: light | tests | adversarial`) and binds
configurations to Operating Levels: Decision 69 and
[operating levels](../../foundation/operating-levels.md).

TUI-D1–TUI-D13, the selection schema, reducer, policy module, and staged PI WEB seams below were
never built and must not be built from this document. See the
[owner verdict and reset history](working-mode-owner-verdict-and-reset-history-2026-08-26.md).
The acceptance does not settle the multidimensional Working Mode proposal, prior grill items,
Operating Levels, or standing-context policy.

Workstream: `ws-multidimensional-working-mode`.

## Target and boundary

The owner wants an on-the-fly control that favors fast feedback at one end and more model challenge, evidence, independent review, bounded remediation, and richer human presentation at the other. The first implementation should work in Pi's TUI and later receive a native PI WEB surface.

The audited recommendation is a bounded **Level 1 Entry Preset experiment**, not the full Working Mode, an Operating Level selector, an authority grant, or an unattended-execution control:

```text
Optimize for: Feedback | Balanced | Assurance
```

Candidate command: `/optimize-for`.

The values intentionally order one discretionary assurance-versus-feedback-latency bias. Repository safety requirements, material-claim Independence, permissions, authority, child lifetime, workspace protection, and managed-recovery guarantees do not move with the selection. `Assurance` is not a correctness guarantee, and `Feedback` is not permission to weaken fixed requirements.

The strongest rejected alternative is a static **Attended Pair** disclosure with no three-value control. It preserves simpler product language but cannot satisfy the owner's need to change feedback and assurance posture during one session. The owner's 2026-08-25 verdict selected the three-value experiment over this alternative; the later reset pauses further design and implementation.

## Audited decision tree

### TUI-D1 — Product and naming

Expose the control as `Optimize for`, not `Working Mode` or `Mode`. Persist selections as `workbench.entry-preset`. Keep the full Working Mode challenge separate.

**Historical owner verdict:** accept the three-value experiment. Final naming and implementation remain unsettled after the reset.

### TUI-D2 — Honest Level 1 disclosure

The compact TUI presentation is approximately:

```text
Optimize:Balanced · L1 attended
```

`/optimize-for status` must expose the complete boundary:

- Human Attention contract: Level 1 attended; actual human presence is not detected.
- Active Subagent and Worker execution ends with the attended session.
- A durable Worker identity and Pi session reference may persist; no Worker process or active execution survives.
- Children use the shared checkout and local-machine trust boundary.
- Pi tool allowlists and the host capability ceiling apply, but filesystem, process, and network sandboxing are absent. An unrestricted shell may mutate despite analysis-oriented instructions.
- Managed Run authority, workspace isolation, crash recovery, and Publication authority are absent.

AFK and outcome-only attention values remain absent. They require a separate decision and their own fail-closed governance, aggregate budget, completion, restart, and Human Attention gates.

### TUI-D3 — TUI interaction

A missing selection is normal `implicit-baseline` state using current Balanced behavior. V0 performs no automatic first-prompt append, no mandatory startup selector, and no global-default read.

- `/optimize-for` opens a selector only in TUI and only by explicit owner action.
- `/optimize-for feedback|balanced|assurance` applies a direct selection.
- `/optimize-for status` inspects effective and degraded state without mutation.
- No default keyboard shortcut is added.
- The command handler itself requires `ctx.isIdle()`; RPC can otherwise invoke extension commands while a turn is active.
- A TUI selector captures the current selection revision, then rechecks both idle state and expected revision before applying the choice.
- RPC receives no unsolicited dialog. A no-argument RPC invocation returns usage and disclosure; direct enum arguments remain an attended smoke path, not the future native PI WEB protocol.
- A non-persistent notice or startup-header hint may advertise `/optimize-for`. A remembered owner default is a later experiment justified only by observed repetition.

Every successful activation emits host-neutral human-facing disclosure. In PI WEB today this travels through the extension notification inbox. Notification is best-effort presentation, not a typed command receipt.

### TUI-D4 — Branch-local state and compatibility

Use versioned Pi custom entries that stay outside Model Context and reduce only the active branch. An explicit selection record contains:

```text
schemaVersion
selectionId       # generated before append
presetId
origin
policyRevision
```

Derived disclosure is not persisted. The pure reducer returns:

- `valid`: a recognized explicit selection;
- `implicit-baseline`: no selection exists; or
- `degraded`: a selection exists but its schema or policy revision is unsupported.

Unknown records remain preserved. Degraded state visibly uses current baseline behavior without an experimental routing variant. Compatibility covers a finite declared policy window; every semantic or text change increments `policyRevision`.

The adapter recomputes state on `session_start`, `session_tree`, `before_agent_start`, and every child or Worker launch. Tree navigation immediately updates status and notifies only when the effective semantic policy changes. It never treats an abandoned branch as current state or appends a transition during navigation.

A transition follows:

```text
parse and inspect
→ reject active lead
→ capture expected selection revision
→ validate
→ append only a genuine change
→ reduce the active branch again
→ verify the expected selection
→ present human disclosure
```

The pure transition result is typed internally as `applied`, `unchanged`, or `rejected`, with a stable code and previous/resulting selection IDs. Pi's current extension-command protocol supplies no typed host result; a future capability seam will.

### TUI-D5 — Deep module seam

Create one host-neutral pure module with a small conceptual interface:

```text
reduce(records) -> snapshot
proposeTransition(snapshot, request) -> entry data or rejection
resolvePolicy(snapshot, capabilities) -> disclosure + lead guidance + child routing variant
```

The module owns schema parsing, branch reduction, transition validation, disclosure, finite compatibility, and preset policy. It imports no Pi session type and owns no mutable session state, Run state, UI, append, authority, or model selection.

The Pi extension adapts lifecycle, TUI, notifications, and custom entries. `subagent` and `worker_dispatch` import the module and reduce `ctx.sessionManager.getBranch()` once at launch. A required `pi.events` request/reply bridge was rejected as untyped and failure-prone.

PI WEB must not parse raw session entries or footer text.

### TUI-D6 — Behavior above fixed floors

Universal invariants remain outside all three values:

- ask Human Attention only for Material Questions;
- seek the cheapest decision-changing evidence first;
- preserve repository, authority, and independent-verification requirements;
- represent the shared checkout honestly;
- permit only one mutating child at a time as an advisory operating constraint until a scheduler or workspace isolation mechanically enforces it;
- bound review and remediation; and
- keep the result task-shaped.

Preset guidance changes discretionary orchestration:

- **Feedback:** favor critical-path-improving bounded background investigation and mechanics; avoid habitual heavy review beyond material-claim and risk floors; return concise Primary Evidence.
- **Balanced:** preserve the current selective delegation and evidence-directed review posture.
- **Assurance:** raise the discretionary assurance bias through the cheapest valid falsifying probe; use autonomous grilling only for consequential uncertainty; use cross-family review only when it breaks a named failure correlation; keep remediation finite.

No preset creates a fixed pipeline. `Assurance` can correctly choose one discriminating probe and one independent judgment. The preset never changes active tools, the lead model or thinking level, permissions, authority, Cognitive Role, workspace claims, or fixed safety requirements.

### TUI-D7 — Child routing and calibration

Extend routing with an optional Entry Preset input and launch provenance, but initially map all values to today's bindings. This proves propagation without claiming unvalidated model or Model Effort improvements.

Then produce shadow candidate bindings and evaluate representative role/model/effort cases. Admit an effort variant only after it meets a declared outcome threshold. The resolver never rewrites Cognitive Role or Independence. Mechanics, consequential design and escalation, and independent-role floors remain unchanged unless later evidence validates a bounded variant.

An omitted selection uses current binding with `implicit-baseline`. An unsupported selection uses current binding with visible `degraded` status. Routing policy remains at `skills/model-orchestration/references/routing-policy.json`.

### TUI-D8 — Prospective switching and launch provenance

A switch affects future lead runs and launches only. Active children continue under their immutable launch snapshot:

```text
entryPreset: {
  presetId,
  selectionId,
  policyRevision,
  status: valid | implicit-baseline | degraded
}
```

Subagent launch/status/terminal details and bounded Worker Registry receipts retain this provenance, including `outcome_unknown`. They do not store policy prose, disclosure, or raw custom entries.

**Pending owner decision:** either block `/tree` while a child is running or terminal-but-unreconciled, or allow cross-branch collection while recording the launch branch and policy provenance explicitly. Blocking is simpler; provenance-aware import preserves more flexibility.

### TUI-D9 — PI WEB path

Slash-command forwarding and extension notifications provide smoke evidence only. Native PI WEB control needs a typed producer and host seam.

Staging:

1. Prototype a qualified, versioned Pi extension capability producer.
2. Exercise it with Entry Preset and a second fixture or real extension.
3. Only then stabilize the smallest generic PI WEB session-extension host with bounded `inspect`, ordered `watch`/disposal, and revision-checked `execute`.
4. Include capability availability, schema version, session identity, expected revision, typed rejection, reconnect, and disposal.
5. Let the Workbench adapter render a shell-status action and bounded selector. PI WEB remains a client and stores no authoritative current selection in browser preferences.

A Workbench-only endpoint, raw custom-entry parsing, footer parsing, and an arbitrary extension RPC tunnel were rejected.

### TUI-D10 — Delivery and evidence

**Gate 0 — owner verdict and experiment admission**

Approve:

- the three values and final copy;
- exact stable system-prompt policy blocks;
- exact activation, status, limitation, failure, and degraded-state disclosures;
- owner, observables, dated review, and adopt/revise/remove criteria; and
- the open cross-branch child decision.

This locally applies the still-pending standing-context admission criterion without globally settling it.

**Phase 1 — pure policy and TUI**

Implement the reducer/policy module, `/optimize-for`, TUI selector and footer, branch restoration, compatibility, host-neutral notifications, and stable `before_agent_start` guidance.

**Phase 2a — propagation without changed bindings**

Add optional preset input to routing, preserve current bindings, attribute Subagent and Worker launches and receipts, and emit shadow candidates.

**Phase 2b — calibrated routing variants**

Admit only evidence-backed effort variants. Dogfood the three policies and perform a dated adopt/revise/remove review before adding a remembered default or startup selector.

**Phase 3 — PI WEB experiment**

Build the qualified producer and bounded host probe. Stabilize a public generic host only after a second use proves the seam.

AFK remains separate.

### TUI-D11 — Review failure semantics

V0 deliberately adds no new obligation ledger, verification state, waiver state, completion gate, or managed Attention Item.

- If independent review is required by an existing repository, Goal, AFK, or other fixed mechanism and cannot launch, that mechanism remains unsatisfied. The lead reports the blocker and never substitutes self-review.
- If an Assurance-only extra review cannot launch, its typed failure remains Primary Evidence. The lead reports that the requested extra assurance was not obtained and offers retry, prospective preference change, or acceptance with that residual limitation. It never claims the review happened or downgrades the requested independent role silently.
- Status reports selected preference, not policy fulfillment.

A tracked branch-local assurance-condition ledger was rejected as premature completion-state machinery. Reconsider it only if dogfood shows failures are routinely lost across turns or compaction, or advisory guidance is routinely ignored.

### TUI-D12 — Model-facing guidance

`before_agent_start` returns a modified `systemPrompt` with one compact deterministic Workbench segment generated by `resolvePolicy`. It does not append a custom message or session entry.

The segment names the selected bias, universal invariants, advisory assignment/review behavior, and TUI-D11 failure disclosure. It does not duplicate tool descriptions. Decision 99 remains the transport rule: active Subagent and Worker tool guidance chooses background versus foreground execution; Entry Preset guidance changes which assignments and reviews are selected.

The Workbench segment is byte-stable for a preset, policy revision, and capability class. Generated selection IDs, origins, timestamps, usage, and quota telemetry stay out. Routing telemetry belongs in bounded child launch evidence. Byte stability does not guarantee provider cache hits because other prompt inputs may change.

The complete historical system prompt and host capability set are ephemeral provider-request input, not persisted or claimed reconstructible. Only retained immutable Workbench policy revisions can reconstruct the Workbench segment.

### TUI-D13 — Host-neutral disclosure

Every successful explicit activation presents the selected bias and compact Level 1 boundary at the decision point. `/optimize-for status` provides reinspection, reconnect recovery, implicit/degraded diagnosis, and notification-loss recovery.

The handler checks idle state itself, validates selector revisions, verifies branch persistence before reporting success, and never rolls back a valid append because presentation failed. TUI footer status is progressive enhancement only; correctness never depends on footer or widget rendering.

## Verification matrix

Implementation acceptance requires:

1. pure tests for valid, implicit, degraded, malformed, finite compatibility, no-op, transition, and branch-divergence behavior;
2. exact snapshot tests for stable policy and disclosure text;
3. TUI tests for direct activation, selector idle/revision races, status, semantic tree notifications, reload, resume, fork, image and skill prompts, and notification failure after append;
4. RPC tests proving no unsolicited dialog or mutation, no-argument usage, direct activation, status, and human-readable rather than typed command feedback;
5. invariant tests proving all values preserve authority, tool, role, workspace, sandbox, and material-claim floors;
6. routing tests for backward-compatible omitted input, current-binding behavior, shadow candidates, quota, catalog, effort verification, Independence, and degraded fallback;
7. provenance tests for Subagent and Worker success, every typed failure, `outcome_unknown`, registry compatibility, and bounded storage;
8. real TUI and RPC lifecycle evidence before routing variation;
9. measured comprehension, elapsed time, token/cost use, child count, review yield, remediation, correction rate, fixed-floor violations, and cache misses; and
10. later PI WEB capability version, inspect/watch/execute, stale revision, reconnect, disposal, keyboard, narrow/mobile, and protected-control evidence.

## Dissent and residual risks

1. The values remain mentally rankable. `Assurance` may sound safest and `Feedback` unsafe.
2. One optimization preference still bundles several behaviors.
3. “Attended” is a contract, not detected presence.
4. Shared-checkout one-mutator behavior remains advisory until mechanically enforced.
5. No effort variant is calibrated; initial routing must remain current binding.
6. Exact cross-branch child collection behavior remains unsettled.
7. A generic PI WEB capability can become arbitrary RPC; it must earn stability through a second use.
8. System-prompt guidance is advisory and may be ignored or over-applied.
9. Lightweight review-failure reporting can be lost across compaction; tracked conditions remain deferred pending evidence.
10. Workbench dogfood users may understand these distinctions better than ordinary users, so comprehension evidence may not generalize.
11. Full Working Mode adoption, the prior 2026-08-08 grill verdicts, and a global standing-context admission rule remain separately pending.

## Method and evidence

The attended lead inspected Pi's complete extension, TUI, keybinding, RPC, session-format, and settings documentation plus the preset and plan-mode examples; current Workbench execution, routing, Worker Registry, Workstream, and PI WEB integration code; and PI WEB's plugin and extension-dialog host seams.

The grill used durable advisor Worker `working-mode-tui-grill-advisor` for five bounded design rounds, followed by three fresh cross-family closing audits. Material audit findings were returned to the advisor or resolved as explicitly bounded new branches. The third independent audit reported **no material gap**. The advisor Worker was then retired.

Primary repository anchors:

- `docs/research/reports/multidimensional-working-mode-proposal.md`
- `docs/research/reports/working-mode-grill-decisions-2026-08-08.md`
- `docs/foundation/vocabulary.md`
- `docs/foundation/decisions.md`
- `docs/foundation/principles.md`
- `docs/plans/level-1-subagents.md`
- `extensions/subagent/index.ts`
- `skills/model-orchestration/SKILL.md`
- `skills/model-orchestration/references/routing-policy.json`
- `docs/integrations/pi-web/customization-plan.md`
- sibling PI WEB `src/plugin-api.ts` and `src/server/sessions/piSessionService.ts`

No implementation begins until the owner walks the decision frontier, starting with TUI-D1.
