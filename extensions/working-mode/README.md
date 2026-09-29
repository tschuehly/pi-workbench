# Working Mode in Pi

`/mode <axis> <value>` sets one axis; values are case-insensitive. In the terminal, `/mode` without
arguments opens axis and value pickers; Escape cancels without changes. The terminal footer shows
all four values.

`/mode send` delivers the pending change now instead of with the next prompt. When the agent is
idle, it starts a turn; when the agent is working, it steers the running turn after the current tool
calls. The sent block also asks the agent to acknowledge the change in one sentence and continue.
When the model already sees the selection, it only notifies "Working Mode unchanged".

| Axis | Values (starting value first) |
| --- | --- |
| Alignment | **Default**, Align, Plan, Spec |
| Attention | **Default**, Focused, Switching, Phone, AFK |
| Checking | **Default**, Exercise, Test, Challenge |
| Orchestration | **Main**, Subagents, Workers |

- **Delivery:** when the selection differs from the last block the model can still see, the next
  prompt carries one `<working-mode seq="N">` message with the full selection and the guidance for
  every value that differs from its starting value. The block says it replaces every earlier block.
  The system prompt never changes, so the provider's prompt cache survives a mode change. A block
  sent with `/mode send` counts as seen, even while it waits in the steer queue, so the next prompt
  does not repeat it; if the run ends without delivering it, the next prompt attaches it.
- **Persistence:** blocks are saved in the session. Resume, reload, and fork restore the selection
  from the latest block on the branch. After compaction summarizes a block away, the next prompt
  attaches the current one again. A new session starts at the starting values.
- **Status:** each start, selection, and prompt publishes a snapshot (schema version 2, `selected`,
  `applied`, and `aligned`) through status key `working-mode` and the `pi-workbench:working-mode` event.
- **Alignment gate for AFK:** with Attention AFK and Alignment Align, Plan, or Spec, the block tells
  the agent to prepare instead: stay in the conversation, present the agreement (Align bullets or
  a persisted plan or specification) with its checklist and every foreseeable question, and wait.
  After Thomas confirms, the agent calls `alignment_reached`; its result carries the AFK rules and
  the next block says alignment is reached. Changing the Alignment value clears it, and the agent
  calls `alignment_reset` when the work turns to a new task that needs a new agreement. With Alignment
  Default, AFK starts at once. The snapshot's `aligned` field reports the state.
- Guidance only: the `alignment_reached` and `alignment_reset` tools record state; no permissions or skill catalog change.

The behavioral contract is [Working Mode](../../docs/foundation/working-mode.md).

## Verification

`npm run test:working-mode-extension` runs a real Pi session against a scripted model and checks the
unchanged system prompt, block numbering and replacement, resume, compaction, invalid commands,
per-value guidance, the terminal picker, and `/mode send` while idle, while streaming, with nothing
pending, and with a queued or dropped steer. Automated checks prove delivery, not model compliance.
