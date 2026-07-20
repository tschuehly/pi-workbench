# Skill Interface Evidence Ledger

## Scope

High-level evidence for making vendored skills first-class Pi harness capabilities with optional enhanced interaction surfaces.

## Findings

1. Effective skills are self-contained folders with concise triggering metadata and instructions plus optional scripts, references, assets, and user-facing metadata. Progressive disclosure prevents every skill from permanently consuming agent context.
   - Source: [Codex skill-creator](/Users/tschuehly/.codex/skills/.system/skill-creator/SKILL.md)
2. Skill behavior has different appropriate degrees of freedom. Fragile deterministic work benefits from scripts and strong constraints; judgment-heavy work benefits from flexible guidance and evidence.
   - Source: [Codex skill-creator](/Users/tschuehly/.codex/skills/.system/skill-creator/SKILL.md)
3. Pi extensions can provide dialogs, notifications, status, text widgets, and terminal custom components. RPC clients support common dialogs and status operations but not arbitrary terminal components.
   - Sources: [Pi extension documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md), [Pi RPC documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)
4. Generalized skills and project overlays are useful separate scopes. Shared procedural behavior can remain portable while repository knowledge, commands, and conventions stay near the target project.
   - Source: [PhotoQuest skill-sync](/Users/tschuehly/IdeaProjects/PhotoQuest/.claude/skills/skill-sync/SKILL.md)
5. Real-task iteration and forward testing are necessary to determine whether a skill generalizes and which interface improvements materially help.
   - Source: [Codex skill-creator](/Users/tschuehly/.codex/skills/.system/skill-creator/SKILL.md)
6. Atelier separates task semantics from presentation: a coordinator supplies a bounded Surface Brief, while one Surface Builder owns presentation and receives compact semantic deltas rather than the full reasoning transcript.
   - Source: [Atelier skill](/Users/tschuehly/IdeaProjects/skill-incubator/skills/atelier/SKILL.md)

## Implications

- Keep skill semantics independent from any one terminal or GUI client.
- Provide common harness concepts for progress, decisions, artifacts, inputs, outputs, and actions.
- Require a complete headless and terminal path; add enhanced surfaces only where human interaction benefits.
- Keep trust-sensitive controls in the harness shell.
- Use run analysis and realistic evaluations to decide which skills and interfaces graduate into the stable distribution.
- Integrate the Atelier Surface Builder pattern as a harness capability so an agent can generate and refine native skill surfaces without transferring task judgment to the presentation worker.
- Preserve runtime flexibility through compact semantic deltas and stable surface concepts; treat successful run-local adaptations as candidates for evaluated skill promotion.
- Resolve skills in layers: preserve the upstream core and provenance, add reusable stack or framework adaptations, then apply repository knowledge and optional run-local refinement.
- Promote generic and stack-level improvements to the narrowest reusable shared scope while keeping repository-specific commands, policies, and conventions with the target project.

## Confidence

- Skill anatomy, Pi extension behavior, and RPC limitations are high-confidence implementation evidence.
- The exact interface vocabulary and packaging format remain deferred design decisions.
