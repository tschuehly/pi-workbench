# Default-context challenge dossier

**Status:** session-preparation dossier for the pending challenge of everything Pi Workbench adds
to a session's standing Model Context by default — project instructions, tool descriptions, prompt
guidelines, and the skills index. It persists scope, inventory, provenance, and stakes only and
records no verdict. Every cited addition remains in force until the challenge is resolved.

Workstream: `ws-workbench-guiding-principles-20260807`. Companion to the
[Working Mode challenge dossier](working-mode-challenge-dossier.md); the same grilling session
should take up both subjects.

## Required outputs

The grilling session must produce:

1. a verdict on `task-challenge-default-context` — keep / prune / restructure the standing
   default-context additions, item by item;
2. an explicit admission policy for future standing-context additions — the candidate rule under
   challenge: a standing guideline must be backed by mechanical enforcement or observed failure
   evidence, otherwise it starts as a skill, doc, or tool description;
3. a decision on whether guideline effectiveness gets an observable (for example worker-registry
   receipts as the over/under-delegation signal) per decision 77's attended-use evaluation.
   No document edits during the grilling itself.

## Subject under challenge

Standing context the Workbench injects into every session where the harness loads:

| Addition | Source | Shape |
| --- | --- | --- |
| Project instructions: router table and invariants | [`AGENTS.md`](../../../AGENTS.md) | Injected whole into every session in this repository |
| Subagent tool surface: description plus six guidelines, including the delegation decision policy (when to work inline, delegate, or use a worker) | [`extensions/subagent/index.ts`](../../../extensions/subagent/index.ts) | Per-tool `promptGuidelines` merged into the standing prompt |
| Worker tool surface: four tool descriptions, five dispatch guidelines, reuse-before-create guidance | same | same |
| Checkpoint tool guidance | [`extensions/context-checkpoint/`](../../../extensions/context-checkpoint/) | same |
| Skills index: one description line per available skill | `skills/` and user-level skills | `available_skills` list in every session |

Adjacent but externally owned, in scope only as accretion evidence: the goal and AFK-gate
extensions and the web-access tools contribute comparable standing guideline blocks that the
Workbench neither authors nor bounds.

## Provenance of the challenged accretion

The worker-era additions all landed on plausible reasoning, none on observed failure — which is
exactly the admission question:

| Commit | Addition | Trigger |
| --- | --- | --- |
| `57cd91b` | Worker tool descriptions and five dispatch guidelines | Implementation of [level-1-durable-workers.md](../../plans/level-1-durable-workers.md) |
| `0493eee` | Reuse-before-create guideline on `worker_create` | Anticipated cross-session worker sprawl; never observed |
| `5c0f620` | Delegation decision policy on `subagent` | Observed gap: two live sessions used the tools correctly but only under explicit human briefing; no evidence yet that the added policy produces good unbriefed delegation |

## Behavioral evidence

- Two sessions (the durable-worker build session and an independent gpt-5.6-sol verification
  session, 2026-08-08) used every worker and subagent tool correctly from tool-attached guidance
  alone — but both were told what to exercise. There is no observation of spontaneous delegation
  choice under the new policy.
- The worker registry (`~/.pi-workbench/workers`, machine-local) records per-dispatch receipts;
  scopes with exactly one dispatch are the concrete over-eager-worker signal available today.
- [`AGENTS.md`](../../../AGENTS.md) already carries the incumbent admission policy for its own
  content ("Do not add task progress… or information already easy to discover"), and the
  [writing-for-agents skill](../../../skills/) is the incumbent authoring standard; neither governs
  tool guidelines.
- Pi's extension mechanics ([extensions docs](https://github.com/earendil-works/pi): `promptSnippet`,
  `promptGuidelines`, `before_agent_start`, `systemPromptOptions`) make every standing addition
  inspectable and per-turn priced; skills remain the on-demand alternative for procedure-shaped
  guidance.

## Challenge agenda

1. **Earn-its-place:** for each inventory item, what observed behavior would differ without it?
   Which items answer an observed failure, and which only anticipate one?
2. **Per-turn cost:** standing text taxes every turn of every session. Which guidelines should
   demote to a skill, a tool description, or documentation loaded on demand?
3. **Redundancy and contradiction:** "prefer fresh subagents" appears in a description, a
   guideline, and a README; the delegation policy says delegate proactively while the attended
   posture keeps the lead accountable. Where does duplication or tension mislead?
4. **Truthfulness:** prompt text is steering, not enforcement. Does any standing claim exceed what
   mechanics enforce (locks, schema rejection, preflight), violating the boundary that deterministic
   modules own transitions?
5. **Ownership seams:** what belongs in a tool description (contract), a guideline (behavior),
   `AGENTS.md` (repository routing), a skill (on-demand procedure), and docs (authority)? The
   admission policy should assign each seam.
6. **External blocks:** should the Workbench accept, bound, or wrap the large guideline blocks
   contributed by extensions it does not own?

## Authoritative state at stake

- [decisions.md](../../foundation/decisions.md) — D77 (V1 evaluated through attended use), D80
  (attended posture and accountability), D87–89 and D93 (child execution and durable workers whose
  tool surfaces carry the challenged text).
- [contracts/harness.md](../../contracts/harness.md) — harness distribution owns what ships into
  sessions.
- [contracts/execution.md](../../contracts/execution.md) — the V1 delegation posture the standing
  policy paraphrases; divergence between prompt text and contract is a defect on one side.
- [`AGENTS.md`](../../../AGENTS.md) — both a challenged item and the incumbent self-governance
  precedent.
