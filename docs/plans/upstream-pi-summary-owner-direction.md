# Upstream Pi patch — preserve the latest owner direction in compaction summaries

Status: **prepared, not applied.** This patch belongs to Pi, not to this repository. Nothing here is
active behavior until an upgraded `@earendil-works/pi-coding-agent` ships it and the fixture below
passes against the installed dependency. Until then, threshold and overflow compaction must not be
described as fixed.

## Problem

`extensions/context-checkpoint/` only governs the explicit `compact_and_continue` boundary, where the
caller supplies a focus directive. Pi's own threshold and overflow compaction has no such directive:
it summarizes with a fixed template whose first section is `## Goal`, followed by `## Progress` and
`## Next Steps`.

In a long autonomous run, the transcript is dominated by the agent's own plans and todo lists, while
the owner's newest correction is a single late message. The template gives that correction no
privileged slot, so the summarizer folds it into `## Progress` or drops it, and the continuing model
resumes the superseded autonomous plan. The observed failure mode is a lead that keeps executing an
older self-authored todo list after the owner redirected it.

`## Constraints & Preferences` does not cover this: it collects standing preferences, not the single
most recent instruction, and it sits below `## Goal` rather than ahead of it.

## Patch

Against Pi's `src/core/compaction/compaction.ts` (shipped as
`dist/core/compaction/compaction.js`, verified against installed version `0.84.3`).

In `SUMMARIZATION_PROMPT`, insert a new first section ahead of `## Goal`:

```
## Latest owner direction
[The most recent instruction, correction, or redirection from the user, quoted or closely
paraphrased. If the user corrected, narrowed, or overrode earlier work, state what is now
superseded. Write "(none)" only if the user gave no instruction in this conversation.]
```

In `UPDATE_SUMMARIZATION_INSTRUCTIONS`, insert the same section ahead of `## Goal` as:

```
## Latest owner direction
[REPLACE with the newest user instruction found in the new messages. A newer owner instruction
always supersedes an older one and any agent-authored plan or todo list that conflicts with it.
Preserve the previous value only when the new messages contain no user instruction.]
```

and add two rules to that block's `RULES:` list:

```
- The "Latest owner direction" section is authoritative over "Next Steps"; when they conflict, the
  owner direction wins and "Next Steps" must be rewritten to match it
- Never present an agent-authored plan or todo list as owner direction
```

Both summarization paths share the template, so `branch-summarization.ts` needs no separate change.

## Fixture

A regression fixture must exercise ordering, not just presence:

1. Build a conversation whose middle contains a long agent-authored todo list ("continue through
   items 1–9 in order").
2. Append a later user message that overrides it ("stop after item 3; item 4 onward is cancelled").
3. Compact, then assert that the summary's first section is `## Latest owner direction`, that it
   carries the stop-after-item-3 instruction, and that `## Next Steps` does not direct the model
   through items 4–9.
4. Repeat through the update path, seeding a previous summary whose `## Latest owner direction`
   holds the older instruction, and assert it was replaced rather than merged.

## Local acceptance

This repository may claim threshold and overflow compaction preserves owner direction only when the
upgraded Pi dependency is installed, the fixture above passes against it, and that evidence is
recorded here. The local barrier in `extensions/context-checkpoint/checkpoint-barrier.mjs` addresses
a different defect — background child wakes racing an explicit checkpoint — and is not a substitute.
