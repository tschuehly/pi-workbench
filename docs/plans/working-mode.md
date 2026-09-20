# Working Mode trial and implementation plan

Status: the owner reopened the Working Mode control and accepted `/mode`, independent built-in
terminal pickers, direct RPC commands, a terminal footer indicator, next-prompt guidance, and Vibe /
unset defaults. The extension foundation is implemented in `extensions/working-mode/`; behavioral
evaluation continues in attended use.
The owner also accepted a checkout-scoped terminal skill-discovery trial on 2026-09-09.
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

The model-orchestration router now loads separate Binding and Checking references conditionally.
Binding applies to each delegated invocation; Checking applies to required independent challenge.
Policy evaluation and provenance remain separate conditional branches. Managed Dispatch remains
future controller behavior; there is no new managed-dispatch implementation.

Delegation stays task-local under every Alignment value.

### Skill discovery

The [accepted mapping](../foundation/working-mode.md#skill-discovery-trial) covers all 41 reviewed
skills: 17 task-triggered in all modes, 21 manual-only, two adversarial-only, and `tdd` at tests or
adversarial. All Alignment values use the same mapping. Retain `customize-pi-web-presentation` as
manual-only legacy tooling rather than deleting it.

The bounded trial filters only the automatic catalog on the next prompt in this extension's
checkout. Keep `/skill:name`, repository requirements, tools, non-terminal contexts, other
repositories, and unreviewed skills unchanged. Do not override installation-level manual-only flags.
No configuration loader or saved dial choice is introduced.

Verification covers all 16 dial combinations, restored discovery after changing Checking,
explicit skill expansion, prompt preservation, and scope isolation. Prior skill instructions
remain in context; prompt-delivery checks do not establish behavioral compliance. Evaluate whether
this discovery reduction helps attended use before generalizing it.

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

Automated checks cover defaults, picker and direct-command changes, cancellation, invalid input,
TUI and RPC prompt delivery, reset behavior, state snapshots, and print/JSON isolation. The
extension changes neither tools nor permissions, writes no settings or session entries, and labels
the footer as guidance.

The next evidence is attended use: can the owner find and change each choice, does Pi act on the
selected guidance, and do Align questions catch consequential wrong-direction work without adding
unnecessary interruptions? Prompt-delivery tests do not prove model compliance. Gather those
observations before adding persistence, enforcement, repository defaults, or another surface.
