# Working Mode in Pi

In the terminal, run `/mode`, choose Alignment or Checking, then choose its value. Escape cancels
without changes. In the terminal or RPC, apply a value directly with
`/mode alignment <vibe|align|plan|spec>` or
`/mode checking <unset|light|tests|adversarial>`. Argument-free RPC use returns this usage instead of
opening a picker. The terminal footer shows both selections; changing one leaves the other unchanged.
Chat instructions still apply, but do not update the footer: use `/mode` to change its displayed
selection.

- **Alignment:** Vibe, Align, Plan, Spec. Starts at **Vibe**.
- **Checking:** light, tests, adversarial, or **unset** to clear the selection. Starts **unset**.
- Selections guide the next prompt, not the running agent loop. Existing owner instructions and
  repository constraints still apply; unset does not mean no checks.
- On each next prompt in this checkout or a descendant workspace, the extension filters only Pi's
  generated automatic skill catalog. It never changes installed skills, `/skill:name` expansion,
  tools, permissions, settings, or skill files. Real-path containment rejects sibling paths and
  symlinks that escape the checkout. `/mode` guidance remains available outside that trial scope.
- The [accepted mapping](../../docs/foundation/working-mode.md#skill-discovery-trial) hides 21 skills
  in every mode. code-review and ponytail-review appear only for adversarial; tdd appears for tests
  or adversarial. Alignment does not affect discovery. Unknown skills retain Pi's existing behavior.
- Filtering only removes entries already present; it does not override installation-level
  manual-only flags. Hidden installed skills remain explicitly callable. Discovery permits
  task-triggered use, not mandatory invocation.
- Nothing is saved. Reload, restart, new session, resume, fork, and clone reset both selections.
  Compaction and tree navigation retain the in-memory choices, not historical selections.
- RPC direct commands apply the same next-prompt guidance without changing the checkout-scoped
  skill catalog. Print and JSON sessions remain unchanged. No tools or permissions are altered.
- Each reset, selection, and next-prompt application emits a versioned
  `pi-workbench:working-mode` snapshot with selected and applied state for session-local consumers.

Load the Workbench package and run `/reload` to discover the command. The behavioral contract is
[Working Mode](../../docs/foundation/working-mode.md).

## Verification

Run `npm run test:working-mode-extension` for every 4x4 dial state, TUI and RPC commands,
next-prompt restoration, state snapshots, exact-catalog filtering, installation flags, explicit Pi
skill expansion, unknown skills, malformed/non-catalog text, real-path scope, defaults, independent
choices, lifecycle resets, and print/JSON isolation.

For attended use: run `/mode`, change Alignment to Align and Checking to tests independently, then
send a task. Verify both footer values, the alignment behavior, and reported test evidence. Clear
Checking with unset, cancel a picker, and run `/reload` to check cancellation and reset behavior.
Automated prompt assertions prove delivery of guidance, not model compliance. Already loaded skill
instructions remain in context after a dial change. Filtering conservatively leaves the catalog
unchanged when Pi's generated catalog is absent, duplicated, or no longer matches verbatim after
another extension's changes; it never guesses which prose to remove. Linked worktrees outside the hosting checkout are outside this bounded trial.
