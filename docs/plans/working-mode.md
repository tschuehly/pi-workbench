# Working Mode implementation plan

Status: proposed implementation sequence for the owner-confirmed design; no implementation has
started.

## Outcome

An attended Pi task begins visibly read-only in Discovering. Pi investigates, recommends one
Alignment value and one Checking value, and the owner chooses. Mutation remains mechanically blocked
until the selected Alignment condition is met. The current configuration and gate state stay in the
session footer and survive resume.

```text
Alignment: Vibe | Plan | Spec
Checking:  light | tests | adversarial
```

This plan adds only the two axes in [Working Mode](../foundation/working-mode.md). It does not revive
Operating Levels or the withdrawn nine-dimensional design.

## Smallest state model

One `extensions/working-mode/` extension owns a pure reducer and the Pi adapter around it:

```text
Discovering (both values unselected, read-only)
  → Vibe selected → one mutation-capable slice → Reviewing (read-only)
  → Plan selected → Plan prepared read-only → owner proceeds → Executing accepted Plan
  → Spec selected → Spec prepared read-only → owner proceeds → Executing accepted Spec
```

Vibe relocks after its slice. Plan and Spec relock on completion or a Material Question, not after
every agent turn. `Reviewing` preserves the visible configuration but blocks further mutation. The
owner may proceed under the same accepted direction, select different values for future work, or
return to Discovering.

The extension appends versioned session entries for every state transition and restores the latest
valid entry on resume. Unknown, missing, or contradictory state resolves to Discovering.

## Implementation slices

### 1. Reducer and fail-closed gate

- Define the finite states, commands, transition errors, and versioned persisted entry.
- Reuse Pi's plan-mode tool filtering and read-only Bash classifier rather than inventing another
  shell parser; add only tests for bypasses relevant to this gate.
- In every read-only state, remove `edit` and `write` and block unknown custom tools. Keep delegated
  children and generic MCP calls blocked until either has a mechanically read-only profile; a label
  such as `scout` is not confinement.
- Restore the pre-gate tool set for Vibe's one slice or for execution inside an accepted Plan or
  Spec. Relock Vibe at its slice boundary.
- Before coding Plan/Spec completion, probe Pi's lifecycle for a reliable completion-or-deviation
  signal. If none exists, stop and ask the owner to choose an explicit boundary action rather than
  silently imposing per-turn approval.

The gate enforces *when* mutation may begin. It does not infer whether a result is semantically
small or whether implementation has materially deviated from an accepted artifact.

### 2. Owner control and human-readable alignment

- Add one `/mode` chooser for both axes, `/proceed` for an accepted Plan or Spec or another approved
  slice, and `/discover` to clear the configuration.
- A model recommendation never changes state. Only an owner command may select or proceed.
- Selecting Vibe starts one bounded slice. Selecting Plan or Spec triggers a read-only turn that
  produces the corresponding artifact; `/proceed` records the accepted artifact revision before
  enabling mutation.
- Inject the selected contracts before each agent turn. Require `write-for-humans` for every
  recommendation, Material Question, Plan, Spec, and review message; make that skill a declared
  harness capability rather than relying on personal configuration.
- Treat grilling as an optional way to resolve Material Questions for Plan or Spec. It stops when
  the artifact is acceptable.
- Replace active launch prompts and tool descriptions that still teach “Level 1 Pair” with the
  canonical “attended V1 posture”; keep historical filenames and evidence titles unchanged.

### 3. Checking behavior

- Inject `light`, `tests`, or `adversarial` independently of Alignment.
- Reuse `model-orchestration` for cross-family challenge routing and consequence-based fan-out.
- Keep the first implementation truthful: Checking is prompt-guided unless later receipt tracking
  mechanically proves tests and challenge completion. The UI must not imply stronger enforcement.

### 4. Persistent presentation

- Render `Alignment · Checking · state` continuously with `ctx.ui.setStatus` in Pi's footer,
  including the unselected Discovering state.
- Project the same versioned state into a fixed PI WEB session footer on desktop and narrow layouts.
  Before changing the sibling PI WEB checkout, fetch `upstream` and `origin`; prefer a generic
  upstream extension-status seam and keep Workbench semantics in `pi-web-integration`.
- Resume and reconnect from persisted Pi session state rather than reconstructing configuration
  from chat text.

## Acceptance

1. A new task shows `Alignment: — · Checking: — · Discovering` and cannot call `edit`, `write`, a
   mutating Bash form, an unknown custom tool, or a delegated child.
2. Read-only repository investigation still works, and the reused classifier rejects its declared
   mutating commands and known bypass cases.
3. Pi can recommend values but cannot select them. The owner can select any of the nine combinations.
4. Vibe enables one owner-inspectable slice and relocks in Reviewing; further mutation requires
   another explicit owner action.
5. Plan and Spec remain read-only until `/proceed` records acceptance of the current artifact
   revision, then continue without per-turn approval until completion or a Material Question.
   Switching values affects only later work.
6. TUI and PI WEB always show the same current values and state, including desktop, narrow, resume,
   reconnect, invalid-entry, and extension-reload cases.
7. Prompt tests distinguish Vibe, Plan, and Spec; Checking tests distinguish light, tests, and
   adversarial without coupling the axes.
8. Every human-facing mode prompt is concise, leads with the decision or action, and loads
   `write-for-humans` before model-authored presentation.
9. The full repository test suite remains green, and the documentation still states that Working
   Mode grants no authority, isolation, durability, publication, or recovery guarantee.

## Non-goals

- Automatic mode selection or semantic detection of a new task.
- Operating Level presets.
- A Run Controller, workspace sandbox, durable autonomous execution, or publication authority.
- Parsing Plan or Spec content into a second planning system.
- Adding Human Attention, delegation, durability, or risk as another Working Mode axis.
