# Agentic Engineering for JVM Developers — Talk Analysis

## Scope

Source-faithful reading of Thomas Schilling's Big Sky Dev Conf presentation "Agentic
Engineering for JVM Developers" (self-contained deck + speaker notes), captured
2026-07. The deck is the practitioner narrative behind the PhotoQuest evidence already
recorded in [photoquest-ralph.md](photoquest-ralph.md) and [aihero.md](aihero.md); this
file records the talk's own framing and how it maps to Workbench concepts.

- Source: external `claude-code-for-spring-developers/CURRENT_PRESENTATION.md` presentation repository

## What the source demonstrates

The talk is first-person field evidence from one JVM product (PhotoQuest: Spring Boot +
Kotlin), not a controlled study. Its reported scale (Dec 2025–Jun 2026): >3,200 commits,
>1,900 agent sessions, ~100 prompts/day, 12× commit velocity. Its central observed claim
is a phenomenon, not a tool: **once agents write most of the code, human attention becomes
the scarce resource and moves to the edges of delivery — highest during alignment, lowest
during autonomous implementation, high again during review. Judgment is the thread.**

Two failure states are reported as lived evidence, not hypotheticals:

1. **The overloaded single session.** One specification with 12 user stories in one
   implementation session degraded as context filled ("context rot"); the fix was smaller
   units of work with a fresh context per phase, not a larger context window.
2. **The un-reviewable large loop.** A 12-day loop produced 204 commits / +45,745 / −59,219
   lines of good-looking code. Line-by-line review was infeasible; ~9 further days and 115
   commits went into re-slicing it, and the refactoring was abandoned. Review pressure had
   been compressed into the same window as implementation.
   A separate generative workflow produced 600 stories that human curation reduced to 305
   over six days because the workflow had no reconciliation phase.

## Mechanisms and their Workbench destinations

| Talk mechanism | Problem it solves | Workbench destination |
| --- | --- | --- |
| Four levels: Pair / Plan / Spec / Sliced loops | Match workflow to certainty, scope, complexity | **Operating Levels** (posture), but see divergence below |
| Think-first / prototype-first modes | Align before building vs. explore one slice then curate | **alignment depth** (Working Mode) + **Scout** authority shape |
| Grill with Docs → ADRs + domain-language doc | Resolve ambiguity, then persist decisions not chats | grilling + domain-modeling skills; **Judgment Dossier**, **Learning Candidate** |
| Sliced loops, fresh context per phase | Avoid context rot; durable artifacts between sessions | **Dispatch → Episode**, **Continuation Artifact**, **Context Curator**, **Semantic Execution Graph** |
| Shaped feedback (hook + `/test` skill parses JUnit XML) | Deterministic verification without flooding context | **Episode** (compact, provenance-bearing); **Review Surface** |
| AGENTS.md router + path-scoped rules + on-demand skills | Concise always-on context; progressive disclosure | harness contract; this repo's AGENTS.md router pattern; **Model Context** |
| Failures → deterministic build guardrails (shift-left) | Stop known failures recurring; only then add autonomy | "deterministic modules own transitions and side effects"; **Watcher** |
| Reviewer board with model diversity (Opus/Fable/GPT) | Different models expose different blind spots | **Independence**, **Cognitive Role**, cross-family judgment, `gpt-adversary` |
| Verification report = contract + linked test + screenshots | Make behavior reviewable; focus human judgment | **Review Surface** + **Primary Evidence** + **Acceptance** |
| "Match judgment and verification to the task" (2×2) | Choose depth by human-judgment × agent-verification need | **Working Mode** dimensions (independently adjustable) |

## Where the talk and Workbench diverge

1. **Levels as a ladder vs. as posture.** The talk's "Choosing a level" table sorts by
   certainty/scope/complexity, then its closing section abandons the ladder and re-derives
   an independent 2×2 (human judgment × agent verification). Workbench encodes that
   correction up front: **Operating Level** is posture and explicitly *not* a maturity
   ladder; the intensity dials live in **Working Mode**'s four independently-adjustable
   dimensions. The talk arrives at the split late and as an afterthought.
2. **Static vs. live attention cadence.** The talk's 2×2 is chosen per task at the start.
   Workbench makes cadence dynamic through **In-Run Judgment** and the **Human-Attention
   Contract** — attention triggered by **Material Questions** and reversibility, not a dial
   set once.
3. **Heroic vs. mechanized review.** The abandoned large loop is the failure of review not
   scaling with output. Workbench's answer is evidence-anchored **Review Surface** +
   **Acceptance**, and at Level 4 a mechanically-governed Acceptance rather than a personal
   line-by-line effort.
4. **Missing reconciliation phase.** The 600→305 curation is a generative workflow with no
   built-in reduction step. Workbench treats reconciliation, simplification, and deletion as
   first-class evidence obligations in the **Semantic Execution Graph**, with
   **Learning Candidates** promoted at the narrowest useful scope.

## Recommendations

- **Adopt** the talk as durable Primary Evidence for the attention-at-the-edges thesis and
  for the two failure states; both already back Workbench design and are now cited.
- **Adapt** the "shape feedback for the context window" mechanism as an explicit expectation
  on Episodes and Review Surfaces: verification stays deterministic at source, but only
  actionable findings enter Model Context.
- **Adapt** "make review findings compound" into the **Learning Candidate** flow: repeated,
  expensive, or dangerous findings become tests, path rules, skills, or workflow phases at
  the narrowest scope, not recurring review work.
- **Experiment (already framed in prior design discussion):** the live cadence-shift moment
  — Pi proposing to tighten or lengthen cycles with a stated reason (uncertainty /
  reversibility / mechanical) — as the concrete upgrade over the talk's static 2×2.
  Falsifier: a human does not want that control surfaced mid-Run, or the stated reason is
  not legible enough to trust.
- **Reject** importing the four-level ladder as user-facing structure. Only Level 1 exists;
  exposing Pair/Plan/Spec/Sliced as a chooser would recreate the maturity-ladder confusion
  the talk itself corrects at the end.

## Implications

- Keep Operating Level (posture) and Working Mode (independently-adjustable dials) distinct
  in any level/intensity interface.
- Treat prototype work as a Scout authority shape, not a deep setting on a delivery Run.
- Design reduction/reconciliation into generative workflows before scaling them across a
  whole problem.
- Prefer live, reason-bearing attention cadence over a cadence chosen once at Run start.
