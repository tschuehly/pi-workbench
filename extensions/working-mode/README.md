# Working Mode in the Pi terminal

Run `/mode`, choose Alignment or Checking, then choose its value. Escape cancels without changes.
The footer shows both selections; changing one leaves the other unchanged. Chat instructions still
apply, but do not update the footer: use `/mode` to change its displayed selection.

- **Alignment:** Vibe, Align, Plan, Spec. Starts at **Vibe**.
- **Checking:** light, tests, adversarial, or **unset** to clear the selection. Starts **unset**.
- Selections guide the next prompt, not the running agent loop. Existing owner instructions and
  repository constraints still apply; unset does not mean no checks.
- Nothing is saved. Reload, restart, new session, resume, fork, and clone reset both selections.
  Compaction and tree navigation retain the in-memory choices, not historical selections.
- Terminal only: RPC, print, and JSON sessions are unchanged. No tools or permissions are altered.

Load the Workbench package and run `/reload` to discover the command. The behavioral contract is
[Working Mode](../../docs/foundation/working-mode.md).

## Verification

Run `npm run test:working-mode-extension` for defaults, independent choices, prompt composition,
cancellation, invalid input, lifecycle resets, and non-terminal isolation.

For attended use: run `/mode`, change Alignment to Align and Checking to tests independently, then
send a task. Verify both footer values, the alignment behavior, and reported test evidence. Clear
Checking with unset, cancel a picker, and run `/reload` to check cancellation and reset behavior.
Automated prompt assertions prove delivery of guidance, not model compliance.
