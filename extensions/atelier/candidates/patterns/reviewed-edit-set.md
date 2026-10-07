# Review a proposed edit set

Candidate Pattern · ME WC · Mechanism. An offered arrangement, not a Registry admission or
content rule (107/117). Choose and change it for the task; no prescribed word count or page schema.

## When it helps
Collect ID-bound edits to a list while keeping the adoption decision on the affected item.

## Components and hierarchy
1. [source-reference](../components/source-reference/README.md) identifies the original set revision.
2. [edit-set](../components/edit-set/README.md) collects modify/remove/skip/insert-after with rationale; [diff-excerpt](../components/diff-excerpt/README.md) previews exact changes.
3. [decision-context](../components/decision-context/README.md) asks rewrite / keep / both or adopt / do not / adapt where the choice belongs.
4. [revision-summary](../components/revision-summary/README.md) reports what the agent changed and what still needs checking.

## Kernel / Keys
Item Keys survive reordered lists. Source version travels in the Request envelope; a stale edit is reviewed rather than blindly applied. Comments and Verdicts are not serialized into authored HTML.

## Evidence for and against
[AgentClick](../SOURCES.md#agentclick) plan edit-set schema; [ME §2 T5](../SOURCES.md#use-cases) actual wrong-question discussion; [html-plan](../SOURCES.md#html-plan) decision-on-row. No owner trial of this form.

## Boundaries
ID validation and application to YAML/JSON are project handlers. A Request proposes work; it is not approval to make arbitrary file changes. No auto-learning into memory or whole-payload overwrite.
