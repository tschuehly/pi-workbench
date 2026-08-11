# Ponytail Minimality-Guidance Evidence Ledger

Reviewed on: 2026-08-11
Workbench baseline first inspected: `22636f0b81c891a0e23f8e0a9cbcf8d5ebbc7630`

**Research only. No recommendation in this ledger is accepted, and no decision is recorded by it.**
Every candidate below is explicitly labelled unaccepted. Adopting, adapting, experimenting with, or
rejecting any of them requires a separate owner decision recorded in
[`docs/foundation/decisions.md`](../../foundation/decisions.md).

This ledger expands one source referenced by the
[DODOREACH Pi tool-shaping ledger](dodo-reach-pi-tool-shaping.md), which remains the parent analysis
of the surrounding thread.

## Verdict

Ponytail is the best-evidenced piece of prompt guidance in this source set, and the evidence is good
partly because the author rebuilt the benchmark specifically to be able to disprove the skill. Its
mechanism is narrow and honest: a persistent ladder that asks whether code is needed at all before it
is written, plus an explicit list of things that must never be simplified away.

The measured effect is real but sharply bounded: large savings appear only where a native platform
feature can replace a hand-built one, backend tasks converge to no effect, and the whole result rests
on one model, one repository, one harness, and four samples per cell.

For Pi Workbench the interesting question is not "should code be smaller." It is whether an
always-injected behavioral ruleset belongs in a system whose future managed posture resolves skills
and capabilities **per Dispatch**, while V1 loads resources selected for the attended task. Ponytail's
delivery mechanism — roughly 5.2 KB appended to the system prompt on every single turn — is the
standing-context pattern Decisions 51 and 71 are intended to avoid in that future boundary. The *ladder* may be worth an experiment; the
*always-on injection* is the part to argue about.

## Source identity

| Field | Value |
| --- | --- |
| Source | [`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail) |
| Package | `@dietrichgebert/ponytail` |
| Version | `4.9.0` |
| Revision inspected | [`2ed6c52`](https://github.com/DietrichGebert/ponytail/tree/2ed6c52c9d7e5e56942508591085fd45dea277d3) (`feat: add Grok Build native skills adapter (revive #561) (#661)`, 2026-08-07) |
| Author | Dietrich Gebert |
| License | MIT |
| Pi surface | `pi.extensions: ["./pi-extension/index.js"]`, `pi.skills: ["./skills"]` |
| Primary benchmark | [`benchmarks/results/2026-06-18-agentic.md`](https://github.com/DietrichGebert/ponytail/blob/2ed6c52c9d7e5e56942508591085fd45dea277d3/benchmarks/results/2026-06-18-agentic.md) |

The repository HEAD equals the revision pinned by the parent ledger, so this analysis and the thread
describe the same code. Repository-wide, Ponytail is deliberately multi-harness: its shared rule body
is adapted across roughly twenty documented hosts through package extensions, lifecycle hooks, MCP,
and instruction-file fallbacks. Pi is one adapter among many. That portability strategy is distinct
from the single Claude Code harness used by the benchmark and conflicts with Workbench Decision 25's
Pi-only model-worker runtime; it is source context, not a distribution pattern to transfer.

## Scope and method

Read in full: `AGENTS.md`, `pi-extension/index.js`, `hooks/ponytail-config.js`,
`hooks/ponytail-instructions.js`, `package.json`, and `benchmarks/results/2026-06-18-agentic.md`.
Listed the six bundled skills and the fifteen root-level test files.

Executed locally at `2ed6c52`:

- `node --test tests/*.test.js` → 84 tests, 83 pass, **1 fail**.
- `node --test ./test/*.test.js` in `pi-extension/` → 23 tests, 23 pass, 0 fail.

The single failure is `csv: correct pandas one-liner passes` in `tests/correctness.test.js`. It is an
environment dependency, not a source defect: `benchmarks/correctness.js` shells out to `python3`, and
the local interpreter has no `pandas` (`ModuleNotFoundError: No module named 'pandas'`). Reported here
rather than smoothed over, because a ledger that hides its own red test is not evidence.

Measured locally: `getPonytailInstructions(mode).length` returns 5,202 / 5,229 / 5,267 characters for
`lite` / `full` / `ultra`. `skills/ponytail/SKILL.md` is 6,637 bytes.

Not executed: the agentic benchmark itself. It requires Claude Code, provider credentials, and paid
runs. Its numbers below are the author's retained results, read from the published report.

## Mechanisms

### M1 — The minimality ladder

**Problem.** Coding agents over-build: they hand-write a component that a native platform control
already provides, invent abstractions nobody requested, and add dependencies to avoid a one-liner.

**Inputs.** The task, plus the code it touches.

**State.** None. The ladder is a decision procedure, not a store.

**Actions.** Stop at the first rung that holds: (1) does this need to exist at all; (2) does it
already exist in this codebase; (3) does the standard library do it; (4) does a native platform
feature cover it; (5) does an already-installed dependency solve it; (6) can it be one line; (7) only
then write the minimum code that works. The ladder is explicitly ordered *after* understanding:
"read the task and the code it touches, trace the real flow end to end, then climb."

**Outputs.** Smaller diffs; a `ponytail:` source comment whenever a deliberate simplification cuts a
real corner, naming the ceiling and the upgrade path.

**Failure behavior.** None mechanically. This is guidance; a model may ignore it.

**Authority.** None. It shapes what gets built, never who decides. The instructions say so
explicitly: "Ponytail governs what you build, not how you talk."

**Assumptions and costs.** Assumes the model can be trusted to climb the ladder honestly rather than
declaring a rung satisfied to avoid work. Costs Model Context on every turn (M3).

### M2 — Retained safety obligations

**Problem.** "Write less code" is a dangerous instruction on its own — the shortest version of a path
join is the one without the traversal check.

**Actions.** An explicit never-simplify list: understanding the problem, input validation at trust
boundaries, error handling that prevents data loss, security, accessibility basics, hardware
calibration, and anything the user explicitly asked for. Plus a completion rule: non-trivial logic
must leave exactly ONE runnable check behind — an assert-based self-check or one small test file, no
frameworks, no fixtures. And a root-cause rule: fix the shared function once rather than guarding
each caller.

**Evidence.** This is the mechanism the benchmark's second axis was built to test, and it is where
the result is most interesting (see below).

**Assumptions and costs.** The list is a floor, not a proof. The author says so.

### M3 — Persistent injection with runtime modes

**Problem.** Guidance that only appears at session start drifts away over a long session.

**Inputs.** A mode: `off`, `lite`, `full`, `ultra` at runtime; `review` is skill-only. Resolution
order for the default is `PONYTAIL_DEFAULT_MODE` env → `$XDG_CONFIG_HOME/ponytail/config.json`
(or `~/.config/...`, or `%APPDATA%\...`) → `full`.

**State.** The active mode is persisted **into the Pi session itself** via
`pi.appendEntry("ponytail-mode", { mode })`. On `session_start`, `resolveSessionMode` scans branch
entries in reverse for the most recent such entry. So the mode survives resume and follows the branch.

**Actions.** On `before_agent_start`, the extension appends `getPonytailInstructions(currentMode)` to
`event.systemPrompt` — **every turn**. `filterSkillBodyForMode` strips intensity-table rows and worked
examples belonging to other modes, keeping ordinary rule bullets verbatim (with a documented guard so
a rule bullet that merely *starts* with a mode word is not silently dropped).

**Outputs.** A modified system prompt; a status-bar indicator showing mode and active/idle state.

**Failure behavior.** Defensive: a null event or missing `systemPrompt` yields a plain-prefix result
rather than the literal string `undefined` (issues #439, #440); the status-bar sync is wrapped in
try/catch specifically because "pi-web theme proxy [may throw] before initTheme."

**Authority.** None. Deactivation requires the *whole message* to be `stop ponytail` or `normal mode`
— an earlier version matched the phrase anywhere and turned itself off mid-task during an ordinary
request like "add a normal mode toggle."

**Assumptions and costs.** ~5.2 KB of standing system prompt on every turn, roughly 1.3K tokens. In
a cached-prefix regime that is cheap per turn but permanently present; in V1, global activation makes
it standing context rather than a resource selected for the attended task.

### M4 — Companion skills as explicit commands

`/ponytail-review`, `-audit`, `-debt`, `-gain`, `-help` are registered Pi commands that forward to
`/skill:<name>` via `pi.sendUserMessage`, queued as `followUp` when the agent is not idle. These are
opt-in, per-invocation, and therefore the opposite of M3 in delivery shape.

## Implementation and test evidence

**Implementation.** The Pi extension is 211 lines and does exactly what is described: register
commands, track a mode, persist it as a custom session entry, render a status chip, and prepend
instructions at `before_agent_start`. Nothing hidden.

**Local test evidence.** 23/23 pass in `pi-extension/test/` — covering `resolveSessionMode` ordering
and fallback, XDG config read/write, quiet-startup resolution, and three `filterSkillBodyForMode`
cases including the "do not drop a rule bullet whose label matches a mode name" regression. 83/84 pass
in `tests/`, with the one failure attributable to a missing local `pandas` (see method).

**Benchmark evidence — the agentic run, 2026-06-18.** Setup: Claude Code `2.1.177` headless, Haiku 4.5
(`claude-haiku-4-5-20251001`), `tiangolo/full-stack-fastapi-template` @ `cd83fc1` (MIT), four arms
(`baseline`, `ponytail`, `caveman` terse-prose control, `yagni-oneliner`), fresh repo copy and fresh
context per cell, `n=4`, LOC measured as `git diff` added lines.

Aggregate over 12 feature tasks, versus a no-skill baseline of 191 LOC / 349K tokens / $0.097 / 69s
per task:

| Arm | LOC | Tokens | Cost | Time |
| --- | --: | --: | --: | --: |
| `caveman` | −20% | +7% | +3% | +2% |
| **`ponytail`** | **−54%** | **−22%** | **−20%** | **−27%** |
| `yagni-oneliner` | −33% | −14% | −21% | −30% |

Per-task spread is enormous and honestly reported: date picker −94% (404 → 23), color picker −92%,
dropzone −62%, but `search items by title` is 44 → 44 and `count user's items` 21 → 17. The savings
concentrate exactly where a native `<input type="date">` replaces a hand-built component.

Safety axis, 5 security tasks × 4 runs, scorer executes the produced function against adversarial
input (path traversal, SQL injection, forged token, malformed CSV row, quota exhaustion):

| Arm | Safe |
| --- | --: |
| baseline | 20/20 |
| `caveman` | 20/20 |
| **`ponytail`** | **20/20** |
| `yagni-oneliner` | 19/20 |

The whole thesis sits in one cell: on `safe-path`, `yagni-oneliner` wrote 6 lines and let a `../../`
escape through once in four; `ponytail` wrote ~9.5 lines and was safe 4/4. The ~3 extra lines *were*
the traversal check.

**Why this benchmark deserves more trust than most.** It was rebuilt in response to a public critique
(issue #126) and structured to be disprovable. It reports a contamination bug the author found in his
own earlier numbers — a `SessionStart` hook firing on every arm, including the baseline, which had
made the gap look like ~4% — and explains the fix (`--setting-sources project,local` plus one
`--plugin-dir` per arm). It reports the places ponytail does *not* win. It retracts the original
80–94% single-shot claim as a chatty-baseline artifact. It lists its own limitations: one model, safety
as a floor not a proof, `yagni-oneliner` being the author's paraphrase, `n=4` nondeterminism, and four
of 192 LOC cells hit by a Windows process-timeout bug.

**What the benchmark does not establish.** Any result on Sonnet, Opus, GPT, or Gemini; any result in
a second repository; any result under Pi rather than Claude Code; maintainability, review burden, or
rework over time; and whether −54% LOC correlates with better outcomes at all rather than merely
smaller ones.

## Pi Workbench baseline

**Implemented and exercised.** Pi Workbench delivers behavioral guidance through two implemented
paths, neither of which is always-on model-authored injection:

- Repository `AGENTS.md` routers (root and nested) that state invariants and route by task.
- Per-tool `promptSnippet` / `promptGuidelines` registered by `extensions/context-checkpoint/` and
  `extensions/subagent/`, which enter context with their tools.

Skills under `skills/` are invoked explicitly. `grep -rn "before_agent_start\|systemPrompt" extensions/`
returns nothing: **no Workbench extension modifies the system prompt.** The repository suite passed
during this review — `npm test` ran eight `node --test` groups totalling 189 tests with 0 failures,
plus the model-routing resolver check; `extensions/context-checkpoint/coordinator.test.mjs` passed 6/6
and is not wired into `npm test`.

**Specified but unimplemented.** Per-Dispatch capability resolution is the governing specification
here and it is not built: Decision 51 ("Skills are resolved and activated per dispatch… their
instructions leave active context when the episode ends"), Decision 71 (harness availability flows
through repository approval → Working Mode → Execution Profile → Work Packet), and the
[harness contract](../../contracts/harness.md) ("Availability in the harness or repository does not
place a skill in every model context"). V1 has no Dispatch, so today the distinction is enforced by
convention, not by a resolver.

**Also relevant and unimplemented.** Decision 27 and `skills/compound/` describe evidence-backed
Learning Candidates. `skills/compound/` exists as a skill and is manual; there is no automatic
promotion of a behavioral rule into standing context, and Decision 79's "higher numbers are different
postures, not quality rankings" is the same instinct that should apply to `lite`/`full`/`ultra`.

**Maturity mismatch.** Ponytail is a working, tested, benchmarked, and versioned package. Daily use is an author claim, not independently measured evidence.
Pi Workbench's competing model — capability resolution per Dispatch — is a specification with no
resolver. So this comparison pits measured guidance against an unbuilt allocation policy.

## Honest comparison

| Dimension | Ponytail | Pi Workbench today |
| --- | --- | --- |
| Evidence for the guidance itself | **Much better**: paired arms, adversarial safety scorer, published limitations, a self-reported contamination bug | No comparable measured evidence for any Workbench guidance |
| Persistence against drift | Dynamically rebuilds the body every turn and persists the selected mode in the session branch | `AGENTS.md` content remains in the system prompt across turns; comparative drift is unmeasured |
| Model Context discipline | **Worse under global activation**: ~5.2 KB stands on every turn without task selection | V1 can select resources for the attended task; future managed resolution is specified per Dispatch |
| Authority separation | Equivalent: both are guidance with no authority | Equivalent |
| Adaptability across repositories | Worse: one global ruleset, mode is the only dial | Better in principle: repository packages and `AGENTS.md` overlays are the specified mechanism |
| Cross-model / cross-harness generality | **Unknown effect**: Haiku 4.5, Claude Code, one repository; the package nevertheless ships many host adapters | Unknown; Decision 25 deliberately permits only Pi as the model-worker runtime |
| Safety under minimality pressure | Demonstrated floor: 20/20 vs `yagni-oneliner`'s 19/20 | Untested; nothing pushes Workbench agents toward minimality today |
| Runtime controllability | Better: `/ponytail off|lite|full|ultra`, persisted per session | No equivalent runtime guidance dial |

Where Ponytail is plainly better: it *measured* its own effect, including the cases where it does
nothing, and it measured whether the instruction is dangerous. Very little Workbench guidance has that.

Where Pi Workbench is better: its stated context economy. "Model Context is also scarce" is the
system overview's second problem statement, and Ponytail's delivery mechanism spends it
unconditionally.

Where evidence is insufficient: everything about transfer. One model, one repository, one harness,
`n=4`. Nothing in the source predicts what happens on a JVM/Spring codebase under Pi with a different
model — which is exactly the Workbench setting.

Bias check. **Novelty bias:** a good benchmark makes a universal rule feel earned; but −54% on
frontend component tasks in a FastAPI template says little about a repository whose work is mostly
irreducible backend logic, where the same benchmark shows convergence. **Architecture bias:**
"per-Dispatch resolution" is an elegant principle with no implementation, and it would be dishonest to
use it to dismiss the only measured guidance result in this source set.

## Unaccepted candidates

None of the following is accepted. Each is a proposal for a future owner decision.

### Unaccepted — experiment: task-scoped minimality guidance under Pi

**Change.** Run paired Pi tasks in representative Workbench-relevant repositories with and without a
Workbench-authored minimality ladder, delivered as an explicitly invoked skill rather than as standing
context.

**Owner.** `skills/`, with results recorded through `skills/compound/` as Learning Candidates.

**Why it could improve the setup.** If the frontend-style over-build trap exists in Workbench
repositories, the saving is in changed lines, review burden, and Human Attention spent reading diffs.

**Proving evidence.** Acceptance checks passed, added and changed lines, files touched, dependencies
introduced, review findings, rework rate, tokens, and time. Paired arms, fresh context per cell, and a
terse-prose control arm so the effect is not confused with brevity — the `caveman` control is the most
transferable methodological idea in the whole source.

**Falsifier.** If backend-dominant repositories converge (as they do in the source's own numbers) and
review findings do not fall, reject the guidance for those repositories rather than tuning it.

**Must remain unchanged.** Explicit requirements, input validation at trust boundaries, security,
accessibility, repository verification commands, and deep-module design must stay outside the scope of
any minimality rule. The source itself insists on this, and the safety axis is the evidence for why.

### Unaccepted — reject: always-on system-prompt injection

A default global `full` mode adds ~5.2 KB of standing context without task selection. In V1 the
applicable harness rule is that the attended Pi loads resources selected for the task; Decisions 51
and 71 describe future managed Dispatch behavior and cannot be used as current enforcement. A
session- or task-selected Level 1 experiment is not categorically prohibited, but global default
activation would bypass the selection discipline the harness intends.

### Unaccepted — reject: `lite` / `full` / `ultra` as a named intensity ladder

A numbered or graded intensity dial invites the same misreading Decision 79 already guards against for
Operating Levels: treating a higher setting as better rather than different. If a Workbench version
needs a dial, it should name postures by what they change, not by intensity.

### Unaccepted — adapt: the retained-obligations list, independent of minimality

The never-simplify list — trust-boundary validation, data-loss handling, security, accessibility,
root-cause over symptom, one runnable check for non-trivial logic — is defensible on its own evidence
and is not a minimality rule at all. It is closer to a repository-package quality floor
([harness contract](../../contracts/harness.md), Repository Package). Worth considering separately
from anything about code size.

### Unaccepted — adapt: the disprovable-benchmark method, not the skill

The most valuable transferable artifact here is the benchmark design: a control arm that isolates the
confound (terse prose), a second axis that tests whether the instruction is *dangerous*, published
per-task results including the null cases, a published contamination bug, and a published retraction
of the earlier inflated claim. Decision 27 and Decision 70 both want evidence of this shape. This is a
method Workbench could reuse for any guidance change, including its own.

### Unaccepted — reject: the cross-host portability layer

Ponytail's adapters for many coding-agent harnesses solve a distribution problem Workbench has
explicitly declined. The benchmark may still inform a Pi-only skill experiment; the host adapters,
MCP fallback, and multi-harness lifecycle hooks should not become a Workbench template.

### Unaccepted — adopt: nothing

No mechanism in this source is compatible with Pi Workbench without translation. Nothing is proposed
for direct adoption.

## Open questions

1. Does the over-build trap that produces Ponytail's −94% cases exist in Workbench-relevant
   repositories at all, or is it specific to frontend component work in a React template?
2. Does the effect survive a change of model, a change of harness (Claude Code → Pi), and a change of
   repository — and if it only survives on weaker models, is it guidance or a capability patch?
3. Can task-scoped invocation deliver the anti-drift benefit that motivates per-turn injection, or is
   persistence the actual active ingredient?
4. Is minimality even the right objective for a system whose stated design vocabulary prefers deep
   modules? A smaller diff and a better interface are not the same thing.
5. Does reduced LOC correlate with reduced review findings and rework, or only with reduced reading?
6. What is the smallest Workbench mechanism that could reproduce this benchmark's paired-arm rigor for
   *any* guidance change, and does that belong in `skills/compound/`?

## Confidence and limitations

High confidence in the implementation description: the extension and config modules were read in
full at a pinned revision, and 23/23 of its own tests passed locally. High confidence in the injected
payload size, which was measured directly rather than estimated.

Moderate confidence in the benchmark's internal validity. It is unusually well constructed for a
skill benchmark, it controls the confound its critic named, and it discloses its own failures — but it
was not reproduced here, and reproducing it requires paid Claude Code runs.

Low confidence in external validity. One model (Haiku 4.5), one repository, one harness (Claude Code,
not Pi), `n=4`, LOC as the primary metric. The safety result is a floor of one slip in twenty on a
deliberately small task set; the author says plainly that a deterministic check is not a proof of
security. Nothing here supports a universal execution rule, and the parent ledger's judgment — a
bounded Pi-only experiment, not an always-on rule — remains the honest reading of this evidence.
