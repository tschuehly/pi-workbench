# Working Mode redesign and delivery plan

Status: Thomas confirmed the behavioral model on 2026-09-21, then added Orchestration. The
144-combination preview slice below was delivered at `a10e664` and reviewed in a private Atelier.
Defaults (2026-09-24) and the channel, AFK, question, delivery, and skill-discovery points
(2026-09-25) are settled; see [Decided for the runtime slice](#decided-for-the-runtime-slice).
The runtime slice is implemented in `extensions/working-mode/`; see
[Runtime slice delivered](#runtime-slice-delivered).

## Confirmed outcome

Make the controls change useful behavior while preserving a neutral Alignment baseline:

| Control | Confirmed values |
| --- | --- |
| Alignment | Default / Align / Plan / Spec |
| Attention | Focused / Switching / Phone / AFK |
| Checking | Exercise / Test / Challenge |
| Orchestration | Main / Subagents / Workers |

The [Working Mode specification](../foundation/working-mode.md) owns the meanings. In particular:

- Keep Align as a lightweight shared-understanding exercise, not just a permission question.
- Plan and Spec are persisted agreements accepted before implementation. Spec includes user
  stories, behavior, and acceptance criteria. Record lasting Align decisions in existing docs
  without requiring a full plan/specification.
- AFK advisors may help adapt the approach while preserving the accepted outcome. If advice
  fails, permit low-cost reversible local fallback; missing owner preferences pause affected work.
- Test requires automated proof, including adding a relevant test when needed. Challenge adds
  independent scrutiny rather than replacing that proof.
- Orchestration guides primary execution: work in the main session, delegate bounded tasks to
  fresh subagents, or coordinate scope-owning workers that use subagents. It does not require teams
  for trivial work; Main still permits required advisors and independent checks.
- Open owner questions follow the Attention channel; they are not persisted as Human Tasks
  (changed 2026-09-25). A dedicated cross-session inbox and new storage are not prerequisites.

The [owner answer record](../research/reports/working-mode-owner-grill-2026-09-21.md) preserves the
source decisions and distinguishes them from the superseded advisor proposals.

## Next slice: inspect the four-axis proposals in the existing explorer

**Done when:** Thomas can open the existing explorer, select any of the 144 confirmed-value
combinations, inspect exactly what each axis adds, and compare two selections without mistaking
candidate text for active runtime behavior or a comparison selection for a product default.

### 1. Pia consolidates the candidate guidance

Use the confirmed behavior and the completed Fable/Astra proposals; do not restart the design
debate. Put one concise draft contribution per value in a preview-only definition module, plus
shared question-handling guidance once. Record expected task artifacts separately from prompt
text; paths and expectations must not masquerade as loaded document bodies.

Keep Attention/Checking/Orchestration defaults visibly unresolved. Keep the inherited base catalog
unchanged for this first candidate set and label the redesigned skill mapping unresolved. This
isolates guidance for comparison; it neither adopts Astra's no-filter policy nor Fable's proposed
skill additions. The first item in a selector is only a comparison choice.

### 2. A Sol worker implements candidate generation

Reuse `extensions/agent-audit/` to create a separate immutable candidate preview set:

- Generate 4 × 4 × 3 × 3 = **144 combinations**, with exact saved per-axis contributions.
- Reuse base-prompt input collection, provenance, existing storage, CLI export, and privacy controls.
- Provide an explicit preview-only entry point; generate no provider request and install no
  transport observer merely to build candidates.
- Leave `extensions/working-mode/index.ts`, existing 16-combination preview generation, old frozen
  exports, and the A–G prototype assets unchanged.

First restore the documented test dependencies if needed; the previously missing Pi package is
an environment prerequisite, not a reason to waive checks or change the active installation.

### 3. A Sol worker extends the existing explorer

After the candidate record shape is settled in step 2, update `tools/agent-audit/explorer.mjs`
and its existing Surface—not a new UI:

- Render four selectors from the saved definitions, candidate/unsent labels, and unresolved defaults.
- Show exact guidance contributions and differences between arbitrary selections.
- Keep available skills, advertised catalog, loaded-body evidence, and unchanged tool schemas distinct.
- Display the inherited-catalog treatment as a preview assumption, not a chosen runtime mapping.
- Avoid repeating the complete 144-preview set inside every displayed record; keep the full JSON
  available through the existing export/download path.

Reuse the same Sol worker when its retained pipeline context is useful. Do not create additional
workers just to match the number of steps.

### 4. Pia and the Sol worker verify and hand back the result

Automated checks must prove the 144 combinations are unique and reachable, prompts compose from
exact saved contributions, one-axis changes leave other contributions unchanged, the inherited
catalog/tool schemas are preserved, and no unselected default is claimed. Run the existing audit,
export, and explorer checks; verify that old preview evidence remains unchanged.

Pia exercises the existing Surface at desktop and phone widths using text/DOM checks: all four
selectors, comparisons, disclosures, and JSON access work without console errors or horizontal
overflow. Only then open the review URL for Thomas and report exact commands/results and any gaps.
Do not claim this demonstrates provider delivery or model behavior; those need later evidence.

**Execution models:** use the requested Sol workers for implementation and tests and Luna-high
subagents for bounded delegated assistance. Per-call subagent `modelOverride` landed on `main` at
`7898202` (2026-09-22), so Luna can be selected without changing shared routing. No mandatory
“Luna review” gate exists.

### 5. Thomas decides after seeing the candidates

Thomas judges the exact guidance and chooses the remaining defaults and skill-discovery policy.
Pia records those decisions and proposes the separate runtime-activation slice. Runtime changes,
real provider-request capture, and behavioral evaluation follow that acceptance—not the preview
build. No A–G representation is promoted by this work.

## Decided for the runtime slice

The [Working Mode specification](../foundation/working-mode.md) records these owner decisions:

- **Defaults (2026-09-24):** Alignment, Attention, and Checking start at a neutral `Default`;
  Orchestration starts at `Main`.
- **Channel (2026-09-25):** the Attention value alone selects the channel. Only Phone uses the
  phone tools; AFK never contacts Thomas.
- **AFK (2026-09-25):** advisor-backed judgment may settle open product, architecture, scope, or
  quality questions within the accepted outcome.
- **Questions (2026-09-25):** no Human Task persistence; questions follow the Attention channel.
- **Skill discovery (2026-09-25):** deferred. Every value advertises the same catalog; the old
  filter is not carried forward.
- **Delivery (2026-09-25):** numbered, tagged `<working-mode>` conversation messages attached on
  change, each replacing earlier blocks, instead of a system-prompt suffix. Saved in the session,
  restored on resume, and re-attached after compaction.

Thomas accepted the runtime slice on 2026-09-25. It does not authorize a new inbox, repository
configuration, or changes to global instructions.

## Behavioral evaluation

Automated tests cover delivery (item 4 except the last sentence). The remaining checks need
observed use:

1. **Context effects:** show the exact guidance and catalog changes for each selected value and
   for the eventual defaults. Preserve unrelated prompt text. Test delivery separately from
   observing model behavior.
2. **Alignment:** a moderately ambiguous task produces shared understanding under Align, a
   persisted accepted plan under Plan, and a persisted accepted behavior specification under Spec.
   Existing accepted direction is reused; trivial work does not trigger a full grill.
3. **Attention:** the same uncertainty is asked readily under Focused, batched under Switching,
   escalated to the phone only when it is a real blocker, and handled by advisor-backed decisions
   or a recorded reversible fallback under AFK, without contacting Thomas.
4. **Delivery:** a mode change attaches one tagged block without changing the system prompt;
   resume restores the latest selection; compaction re-attaches it. In a long session, switching
   from Align to Default mid-session stops the grilling, showing that the latest block wins.
5. **Checking:** Exercise supplies direct evidence; Test adds missing automated proof when needed;
   Challenge also supplies independent scrutiny. Unavailable evidence is a reported gap, never a
   success claim. Changing Attention does not lower Checking.

6. **Orchestration:** primary execution follows the selected structure when useful; Main still
   permits required consultation and independent checks. Workers retain scope context and use
   leaf subagents without extending the supported hierarchy or creating unnecessary teams.

The frozen context export contains unsent previews, not captured provider requests. Do not claim
request inclusion or loaded skill bodies from that export. A real-request capture may verify
prompt delivery later; Thomas did not choose it as a prerequisite for this design discussion.

## Runtime slice delivered

`extensions/working-mode/` replaces the two-axis trial with the four axes, their starting values,
and message delivery described in the [specification](../foundation/working-mode.md#delivery-in-the-session).
It no longer appends a system-prompt suffix or filters the skill catalog. The status snapshot
(`working-mode`, schema version 2) carries all four axes. The agent-input audit keeps a frozen copy
of the old renderer only to regenerate legacy 16-preview sets.

`npm run test:working-mode-extension` drives a real Pi session with a scripted model: the system
prompt stays byte-identical across changes, each change posts one numbered block, resume restores
the selection without re-posting, and compaction re-attaches the block.

**Follow-up:** the PI WEB Working Mode buttons still send two-axis values and parse schema
version 1; they need the four axes before they work again. Typing `/mode` in PI WEB works.

## Separate and deferred work

- The seven context views remain prototypes; Thomas has not selected one for promotion.
- `Reconcile and End` remains a separate approved but unimplemented session-summary trial.
- Saved dial settings beyond session restoration, a new attention inbox, repository
  configuration, mutation gates, managed execution, and recovery are outside this slice.
- If repository-level configuration is later adopted, the previously reserved path remains
  `.pi-workbench/config.json`; no schema or loader is selected here.
- No PhotoQuest or Embabel repository changes are part of this work.

Persisted task documents complement Workstream checkpoints. They neither replace canonical
Workstream continuity nor imply saved mode selections.
