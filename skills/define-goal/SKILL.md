---
name: define-goal
description: Define or refine a concrete, verifiable objective before goal-backed work. Use when the user asks to set a goal, use `/goal`, prepare unattended or overnight AFK work, clarify success criteria, or turn a fuzzy intention into an outcome.
---

# Define Goal

Turn the user's intent into an objective Pi can pursue honestly. Favor observable outcomes, bounded scope, and evidence over activity descriptions. This skill defines objectives; Pi Goal lifecycle tools belong to execution.

## Establish the objective

First confirm goal definition is useful. Apply this skill for an explicit `/goal` request or when the user wants an intention sharpened into a verifiable objective. For ordinary implementation work, proceed directly.

Restate the likely objective. A usable objective states:

- the outcome that will be true;
- the affected artifact, system, repository, environment, or behavior;
- verification evidence and its required pass condition;
- material scope bounds; and
- the escalation condition: a Material Question that changes the outcome, scope, or verifier.

Use quantitative thresholds where they express real success: named test commands, benchmarks and runs, review criteria, affected paths, environments, output formats, or acceptance conditions. Prefer an honest binary validator to decorative precision.

## Repair before starting

Rewrite a vague objective when local context makes the interpretation safe. Ask one concise question only when an unresolved Material Question would risk the wrong outcome or validation. Resolve discoverable details from the repository or supplied context first.

Replace activity goals such as “make progress” or “investigate” with an observable result. For example:

> Resolve the documented checkout slow path with the smallest safe server-side change, then verify `npm run test:checkout` passes and the local benchmark reports p95 below 250 ms in three consecutive runs.

For bugs, name reproduction and a failing-then-passing validator when possible. For research, name the decision it must enable, source scope, and evidence standard. For operations, name the healthy state, observation window, failure threshold, and escalation trigger.

## Define an AFK objective

For continuous unattended work, default to an ordinary `/goal`. Keep the objective to one concise page or less:

1. observable outcome and binary evidence;
2. repository and owned scope;
3. authority boundary and forbidden external effects;
4. continuous loop, including how one terminal item yields to the next;
5. stop-new-work and final-audit deadlines; and
6. the Material Question or human-only condition that pauses work.

Reference stable controller and project policy instead of copying it. Project controllers own resumability, idempotency, concurrency, acceptance, and settlement. Do not add phase checkpoints, compaction cadence, reviewer retry loops, or a second finalization protocol to the objective. Reviewer unavailability may prevent acceptance of an artifact; it does not stop unrelated reversible work unless the project controller proves a shared safety dependency.

Use `execute-plan-afk-goal` only when the owner explicitly chooses that experiment.

## Hand off to Pi Goal accurately

If the current prompt declares an active Goal, refine or continue that objective rather than creating a duplicate. Otherwise, present one concise, ready-to-paste `/goal` objective and let the user or client initiate goal-backed work.

Do not assume Codex-specific `get_goal` or `create_goal` tools exist. Do not invoke Pi Goal completion, waiting, or blocked-state tools here; those are valid only during the corresponding execution lifecycle.

**Complete when:** the user has a concrete objective with outcome, evidence, scope, and escalation condition, or has the one Material Question needed to establish it.

## Provenance

Adapted for the Pi harness from OpenAI’s [`define-goal` skill](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/define-goal/SKILL.md), retrieved 2026-08-09. The adaptation replaces Codex goal-tool assumptions with Pi’s user/client-started `/goal` lifecycle.
