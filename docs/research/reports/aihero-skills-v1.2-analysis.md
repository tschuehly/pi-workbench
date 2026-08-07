# AI Hero Skills v1.2 — analysis awaiting judgment

Analysis of Matt Pocock's Skills v1.2 (released 2026-08-05) against the Pi Workbench setup,
performed 2026-08-07 after the watched-source signal in
[`../sources/README.md`](../sources/README.md) fired. Source claims with citations live in
[`../sources/aihero.md`](../sources/aihero.md). This report holds the recommendations that
need a human decision; everything already settled is listed only for completeness.

## Already settled (no judgment needed)

- **Adopted** via the 2026-08-06 skill-incubator refresh (`4e000d5`, upstream pinned in
  `vendored/MANIFEST.json`): frontier-round grilling, `writing-for-agents` restructure with the
  "cache" pruning term, structural invocation control (`disable-model-invocation` /
  Codex sidecars), setup improvements.
- **Rejected** by deliberate exclusion from vendoring: `/ask-matt` (Workbench `AGENTS.md` is the
  router), `/implement` (own flow + `tdd`), `/grill-me`, `/wait-what`,
  `/resolving-merge-conflicts`, `/to-questionnaire`.
- **Experiment started**: `/wizard` vendored at v1.2 (skill-incubator `53f35e0`) and linked into
  Claude, Codex, and Pi. Falsifier: on the next credentials/CI/third-party-setup task, is the
  generated wizard actually better than numbered chat instructions? If not, unlink and drop it.

## Awaiting human judgment

### 1. Frontier-batched Material Questions (adapt)

v1.2 grilling asks the whole dependency frontier of answerable questions as one numbered round
instead of one question per turn, and recomputes the frontier from the answers. That is the
Semantic Execution Graph's ready-set applied to human questioning.

- **Proposed change:** when a Run has several pending Material Questions whose prerequisites are
  settled, the attention surface presents them as one batched round rather than serial
  interrupts.
- **Destination:** `docs/contracts/graphical-attention.md` (attention surface behavior), with
  vocabulary alignment if "round" or "frontier" becomes a domain term.
- **Why:** fewer human turns for the same judgments; matches Principles 1 and 3 (attention
  follows judgment leverage; shortest path to decision-changing evidence).
- **Validation:** human turns per Run for equivalent judgment load drop without decision quality
  loss.
- **Unchanged:** controller authority over lifecycle; a question whose prerequisite is open still
  waits.

### 2. Phase-boundary decision tree (adapt)

v1.2 orders the end-of-phase options as an explicit tree: **continue > clear > handoff >
subagent > compact**, with continue preferred as the only option that keeps the conversation a
primary source, handoff narrowed to work that must travel, and compact the last resort. The tree
lives in `/ask-matt` (`PHASE-BOUNDARIES.md`), which was deliberately not vendored — so the
lesson is currently lost locally.

- **Proposed change:** fold the ordered tree into the guidance that governs session boundaries —
  candidates are the `workstreams` skill (checkpoint guidance) and the `focus-handoff` skill
  (handoff-is-narrow correction).
- **Why:** sharpens existing `compact_and_continue` discipline; "continue keeps the conversation
  a primary source" is a better stated rationale than any local formulation.
- **Validation:** fewer premature compactions/handoffs observed in practice; guidance reads as a
  decision, not a menu.
- **Unchanged:** Workstream checkpoint semantics and the no-managed-recovery claim.

### 3. Branch-kept prototype and research evidence (experiment, optional)

v1.2 keeps prototype output on `prototype/<name>` branches and research findings on
`research/<name>` branches with context pointers, instead of deleting them ("throwaway no longer
means deleted"). At Level 1 — before the Artifact Store exists — branches are a pragmatic
findable evidence store.

- **Proposed change:** trial branch-plus-pointer retention for the next prototype or research
  burst at Level 1.
- **Why:** preserves runnable evidence without polluting main; consistent with Principle 12
  (generated state expires or promotes).
- **Risk:** branch accumulation without a cleanup policy — the same gap the ledger already notes
  for specs and tickets. The Artifact Store remains the intended durable home; do not let
  branches become a second authoritative evidence system.

### 4. Watched-sources practice as a decision (record-keeping)

The watched-sources list exists as research-directory convention
([`../sources/README.md`](../sources/README.md)). If it should carry decision status —
"an update from a watched source triggers re-analysis, never default adoption" — it belongs as a
short entry in `docs/foundation/decisions.md`. Only record it there once actually settled.
