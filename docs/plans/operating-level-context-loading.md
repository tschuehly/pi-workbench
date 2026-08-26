# Operating Level context loading

Status: **proposed, not agreed.** Nothing here is authorized. Phase 0 is a probe that can kill the
whole design; no later phase starts until it answers. Two owner questions at the end remain open.

Settled input: [operating levels](../foundation/operating-levels.md) and Decision 69 define one
`Checking: light | tests | adversarial` axis, with a named configuration across axes being an
Operating Level. This plan is about *how a Level reaches a session*, not what the Levels mean.

## The idea

A Level selects **what context loads**, not just extra guidance appended on top. Level 1 should load
**less** than a session does today, not more.

An earlier attempt (reverted at `622698f`; see reflog `48331fa`, `fc19ec6`) appended guidance in
`before_agent_start`. That was additive, built without an agreed plan, and is not this design.

## Why it matters — measured 2026-08-26

| Source | Words | Owner |
|---|---:|---|
| Skills index (~47 loaded) | 2807 | mixed |
|  — video/media skills | 1376 | not Workbench |
|  — general dev skills | 865 | not Workbench |
|  — ponytail family | 361 | not Workbench |
|  — Pi Workbench's own | 205 | Workbench |
| `AGENTS.md` project / global / nested | 894 | Workbench + user |
| `extensions/subagent` guidelines + descriptions | 762 | Workbench |
| `extensions/context-checkpoint` | 139 | Workbench |
| PONYTAIL MODE block | ~700 | not Workbench |

Pi Workbench authors roughly 1,679 words; about 3,300 more come from things it does not own. The
largest single block — 20 video-production skills at 1,376 words — has no relevance to this
repository and is charged to every turn.

## Phase 0 — Probe: can an extension subtract context?

**The assumption the design rests on.** `event.systemPromptOptions` is documented as mutable and
exposes `.skills`, `.selectedTools`, `.toolSnippets`, `.promptGuidelines`, `.contextFiles`. But
`before_agent_start` runs *after* the prompt is built — the docs state `event.systemPrompt`
"reflects the chained system prompt as of the current handler" — so mutating options there may have
no effect.

Build one throwaway extension that drops all but three skills and prints the assembled prompt size.
Reference: `examples/extensions/prompt-customizer.ts`.

- **Passes** → the design is reachable; continue.
- **Fails** → Levels can only append. Stop and reconsider rather than rebuild the additive version.

## Phase 1 — Cut what is irrelevant regardless

Scope the 20 video/media skills so they load in video projects and not here. Independent of Phase 0
and worth doing even if the probe fails.

## Phase 2 — Decide the admission rule

Answer `task-challenge-default-context` in `ws-workbench-guiding-principles-20260807`, using the
[default-context challenge dossier](../research/reports/default-context-challenge-dossier.md).
Candidate rule: *standing text requires mechanical enforcement or observed failure evidence;
otherwise it starts as a skill or doc.*

This precedes Phase 3 because it decides what each Level's context set may contain — and it applies
to `extensions/subagent`, which is 45% of the Workbench's own standing footprint and which the
dossier records as landing on plausible reasoning rather than observed failure.

## Phase 3 — Define three context sets

| Level | Context |
| --- | --- |
| 1 — light | minimal skills and guidelines |
| 2 — tests | plus testing and verification skills, plus delegation guidance |
| 3 — adversarial | plus review and independence skills, full guidelines |

Contents are an owner decision, not a derivation.

## Phase 4 — Build the switch

`/level` plus `pi.registerShortcut` to cycle. Small, and only after 0–3 settle.

## Phase 5 — Use it and judge it

Does Level 1 with less context work better? That evidence decides whether the axis earned its place,
and whether a second axis is ever justified.

## Open owner questions

1. **Phase 1 before Phase 0?** Phase 1 is the larger immediate win and carries no risk; Phase 0 is
   the gate everything else waits on. They are independent.
2. **Is Phase 2 in scope now?** It is a real decision with its own dossier and could consume a
   session. The alternative is choosing context sets by judgment and deferring the general rule.
