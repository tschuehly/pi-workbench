# Background completion wakeup smoke evidence

Date: 2026-08-11

A real Pi RPC lead loaded `extensions/subagent/index.ts`, used `openai-codex/gpt-5.4-mini` at low effort, and launched one `mechanics` Subagent with `background: true`. A repeat smoke asked it to follow registered tool guidance without naming the execution posture; the lead still selected `background: true`. Runtime routing selected `anthropic/claude-haiku-4-5-20251001` at low effort for the child.

The first lead turn returned `LAUNCHED` without collecting. After the child reached terminal `success`, the session received exactly one `pi-workbench:child-completion` custom message. That message triggered a second lead turn, which called `subagent_collect` exactly once, received the child sentinel, and returned `RECONCILED_WAKE_SMOKE_OK`. The smoke observed one launch, one completion message, one collection, no extension error, and no remaining parent or child process.

Deterministic extension tests additionally cover terminal deduplication, bounded Subagent and Worker metadata, detached-collection re-arming, cancellation and shutdown suppression, Worker receipt-before-wakeup ordering, and bounded `outcome_unknown` attention on receipt failure.
