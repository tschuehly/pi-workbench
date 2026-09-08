# Working Mode trial and implementation plan

Status: the owner reopened the terminal control and accepted `/mode`, independent built-in
pickers, a footer indicator, next-prompt guidance, and Vibe / unset defaults. The bounded terminal
slice is implemented in `extensions/working-mode/`; behavioral evaluation continues in attended use.
Persistence, repository configuration, graphical controls, and mutation gates remain deferred.

## Outcome

Validate the smallest useful behavioral model before building machinery:

```text
Alignment:  Vibe  |  Align  |  Plan   |  Spec
Checking:   light |  tests  |  adversarial
```

Working Mode remains two independent behavioral axes and never grants permission or authority.
The terminal control makes the selected guidance visible and changeable without relying on chat
alone. Checking starts unset, meaning no floor selected by the control. Choices live only in
extension memory and apply to the next prompt. See the [extension](../../extensions/working-mode/README.md)
for reset behavior and verification; use it on ordinary attended tasks before adding machinery.

## Current trial

### Vibe

Keep ordinary interactive work unchanged. A new context starts in Vibe. Add no setup selector,
one-slice boundary, attention detector, pause guard, automatic switch, or prior-choice restoration.

### Align

Trial one concise owner question before an unconfirmed product, architecture, scope, or quality
choice becomes durable implementation or parallel work. Use the examples and decision rule in the
[Working Mode specification](../foundation/working-mode.md).

The trial succeeds only if it catches consequential wrong-direction work while remaining lighter
than a Plan. Re-evaluate it from three observations:

1. consequential choices Pi missed;
2. interruptions the owner judged unnecessary; and
3. summaries the owner could not judge quickly.

Do not infer semantic boundaries mechanically or add a mutation lock during this trial.

### Plan and Spec

Use accepted task direction for Plan and accepted behavior, constraints, and evidence for Spec.
Keep implementation details adaptive. Store no separate mutable plan file; the Pi session carries
accepted direction and a Workstream checkpoint carries fresh-session continuity.

### Checking

Use `light`, `tests`, or `adversarial` as prompt-guided minimum evidence. The terminal starts
Checking unset; owner direction, repository policy, and task consequences still apply. No
repository default configuration mechanism is selected.
Evidence may be inspected by the owner live or produced for later review without silently changing
the Checking value.

Use one model-orchestration router with conditional references:

- Binding for every delegated Subagent or Worker invocation;
- Checking for required independent challenge;
- Managed dispatch only for a future managed Run; and
- calibration only when evaluating the routing policy.

Delegation stays task-local under every Alignment value.

## Related continuity trial

`Reconcile and End` is an approved, separate trial. If the owner later authorizes its
implementation, it should write a session-local owner-facing Session Summary before any optional
compaction. It informs someone returning to the same Pi session. It is not a Workstream checkpoint,
a next-day source, automatic session-log reconciliation, or a `compound` evaluation.

This plan does not authorize that implementation.

## Deferred work

- Graphical Working Mode controls or a richer state model.
- Persistent selection or restoration of a prior Alignment choice.
- Read-only Discovering, tool filtering, `/proceed`, relocking, or any other mutation gate.
- An interactive Human Attention axis, agreement, presence detector, or inferred cadence.
- A repository configuration schema or format. If later adopted, its path is
  `.pi-workbench/config.json`.
- Repository Adaptation as architecture.
- PhotoQuest or Embabel trials or target-repository mutation.

Resume one deferred item only after the owner chooses to reopen it and observed use supplies the
missing need or acceptance evidence.

## Terminal slice verification

Automated checks cover defaults, independent changes, cancellation, invalid input, prompt delivery,
reset behavior, and non-terminal isolation. The extension changes neither tools nor permissions,
writes no settings or session entries, and labels the footer as guidance.

The next evidence is attended use: can the owner find and change each choice, does Pi act on the
selected guidance, and do Align questions catch consequential wrong-direction work without adding
unnecessary interruptions? Prompt-delivery tests do not prove model compliance. Gather those
observations before adding persistence, enforcement, repository defaults, or another surface.
