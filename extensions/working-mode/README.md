# Working Mode in Pi

`/mode <axis> <value>` sets one axis; values are case-insensitive. In the terminal, `/mode` without
arguments opens axis and value pickers; Escape cancels without changes. The terminal footer shows
all four values.

| Axis | Values (starting value first) |
| --- | --- |
| Alignment | **Default**, Align, Plan, Spec |
| Attention | **Default**, Focused, Switching, Phone, AFK |
| Checking | **Default**, Exercise, Test, Challenge |
| Orchestration | **Main**, Subagents, Workers |

- **Delivery:** when the selection differs from the last block the model can still see, the next
  prompt carries one `<working-mode seq="N">` message with the full selection and the guidance for
  every value that differs from its starting value. The block says it replaces every earlier block.
  The system prompt never changes, so the provider's prompt cache survives a mode change.
- **Persistence:** blocks are saved in the session. Resume, reload, and fork restore the selection
  from the latest block on the branch. After compaction summarizes a block away, the next prompt
  attaches the current one again. A new session starts at the starting values.
- **Status:** each start, selection, and prompt publishes a snapshot (schema version 2, `selected` and
  `applied`) through status key `working-mode` and the `pi-workbench:working-mode` event.
- Guidance only: no tools, permissions, or skill catalog change.

The behavioral contract is [Working Mode](../../docs/foundation/working-mode.md).

## Verification

`npm run test:working-mode-extension` runs a real Pi session against a scripted model and checks the
unchanged system prompt, block numbering and replacement, resume, compaction, invalid commands,
per-value guidance, and the terminal picker. Automated checks prove delivery, not model compliance.
