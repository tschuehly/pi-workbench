# Agent usage retrospective — stop turning uncertainty into machinery

**Date:** 2026-08-27  
**Scope:** all 2,558 Pi session files under `~/.pi/agent/sessions` at the audit snapshot, including Pi Workbench, PhotoQuest, Studio, Marketing Autopilot, Embabel, and smaller projects; a qualitative review of large and correction-heavy roots; Pi Workbench's implemented state; and `ai-engineer` at commit `aff105925eab5566c77953fb69fa9aaae7156e4c`.

## Verdict

The main problem is not that the agents need a better orchestrator. Work whose desired outcome is still being discovered is repeatedly sent into large execution and review loops. When the concrete result reveals that the direction was wrong, the rework is treated as evidence that more plans, workers, reviews, checkpoints, skills, and durable state are needed.

This produces a loop:

`uncertain outcome → large agent run → late human correction → rework → more orchestration → greater distance from the next concrete result`

The session record is consistent with two AI Engineer labels: **velocity sickness**—output without proportionate landed value—and **cognitive debt**—the machinery becomes too extensive to understand and steer. The assistant traces were not read exhaustively, so these are diagnoses to test, not measurements of every run.

**Use the AI Engineer repo only as a hypothesis library queried after an observed failure. Do not use it as a guide, architecture, or backlog.**

The corrective is subtraction: one lead, one observable outcome, one reviewable slice, and no new reusable mechanism until repeated evidence proves it is needed.

## What the archive shows

The full-corpus scan streamed 12.3 GiB of JSONL without parse errors. Pi does not record reliable parent IDs, so “session files” below include human roots and dispatched children. Child classification is inferred from session names and standardized first-turn templates.

| Signal | Snapshot |
|---|---:|
| Session files, roots and children | 2,558 |
| July / August files | 42 / 2,516 |
| Assistant turns | 102,917 |
| Tool calls | 151,435 |
| User-role turns that are dispatch boilerplate | 44.6% |
| Parent-side `subagent` calls / collections | 2,135 / 2,002 |
| Compaction events | 305 |
| Confirmed provider transport failures | 229 |
| Tracked tokens | 13.3 billion |
| Recorded model cost | $12,433.77 |

The cost is the sum of provider-reported message costs, not an independently reconciled bill; about 96% of token volume was cache reads. In the six largest audited project groups, **74–94% of files were inferred scout, implementer, or reviewer dispatches rather than human conversations**. The earlier quantitative scanner incorrectly called every file a root merely because no parent ID exists; the qualitative pass corrected that interpretation.

The largest groups were `PhotoQuest.pi-studio-recreate` (736 files, 7.2 GB), `PhotoQuest.pi-marketing-autopilot-v1` (467 files, 2.8 GB), `pi-workbench` (436), `PhotoQuest` (182), and `embabel-realms-realm-photoquest` (147).

The continuity machinery also has a state burden. At the audit snapshot, the local store contained 29 Workstreams, 22 not closed, and 96 durable worker identities, 19 not retired. Human Task record balance implied at most 38 unresolved tasks and likely fewer because re-upserts were not deduplicated in that count. Some records are test fixtures or experiments; the point is not that every record is waste, but that the system intended to reduce reconstruction now requires its own interpretation and cleanup.

## Three causes, not one

### 1. Shared understanding arrives after execution has scaled

The most consequential questions are often asked late:

- After a multi-day Embabel Realm bake-off, the owner asks, “What is the realm actually useful for?” and concludes “there's no use in what we proved.” That value question needed to precede the benchmark design.  
  Evidence: `~/.pi/agent/sessions/--Users-tschuehly-IdeaProjects-embabel-realms-realm-photoquest--/2026-08-26T14-12-10-572Z_01a03e6a-04cc-7ae9-9bcd-ccf47683b5d6.jsonl`, message `967a8f1b`.
- A Pi Workbench AFK campaign proved harness mechanics while the owner expected the real Marketing Studio production run: “did you not actually run the real production?”  
  Evidence: `~/.pi/agent/sessions/--Users-tschuehly-IdeaProjects-pi-workbench--/2026-08-08T05-36-54-194Z_019fdfdf-cdb2-75a5-8bfa-b629b8232a1e.jsonl`, message `c94d1db1`.
- The Workbench UI was planned or reshaped several times before one production path was usable.

The user-turn evidence is consistent with agents optimizing the most legible proxy—the plan, benchmark, contract, or validation matrix—while the intended value remained less explicit and was still being discovered. The owner-side reversal is equally concrete: one Marketing Autopilot root says “I want to remove all caps,” then asks for a four-model comparison matrix about 50 minutes later (`a68938d6`, `62dc3f72`).

Exploration itself is not the mistake. Visual products and creative pipelines often require seeing a concrete version before knowing what is right. The costly part is asking one run to explore, settle architecture, implement production, delegate parallel work, create a durable plan, and persist generalized lessons.

One Studio root moves from “Did we add too much ceremony again?” to reverting, then “we went too far in simplifying,” and finally “we are running in circles” within four hours.  
Evidence: `~/.pi/agent/sessions/--Users-tschuehly-IdeaProjects-PhotoQuest.pi-studio-recreate--/2026-08-13T16-48-23-603Z_019ffc06-5e33-7acd-90de-c67828a943a7.jsonl`, messages `87d671b4`, `d13f1447`, and `87f3d176`.

The strongest cognitive-debt evidence is explicit: “I don’t understand anything anymore,” followed by a request to explain the current state simply.  
Evidence: `~/.pi/agent/sessions/--Users-tschuehly-IdeaProjects-pi-workbench--/2026-08-26T07-54-38-712Z_01a03d10-60f8-7871-99f1-c19a873d4e30.jsonl`, message `5b667fe3`. Earlier in the same root, the owner says the work went too fast and PI WEB is unusable, then orders a revert because no plan had been agreed (`028ca032`, `33283abb`). The later “I don’t understand” turn shows that the rollback alone did not restore shared understanding.

This is where judgment gets delegated alongside work. Once the owner cannot explain the current model plainly, approving more agent-produced decisions deepens rather than repairs the disconnect.

### 2. Harness and agent defects independently create rework

Not every loop is caused by an unsettled prompt. The archive contains concrete system failures:

- a smoke-test result was treated as if it satisfied the production request;
- duplicate skill names and malformed YAML were injected as user-role text before a long Goal continued;
- AFK, RPC, quota, and child-startup failures triggered large recovery sessions;
- a 2,447-assistant-turn Studio root required the owner to ask why the lead was waiting on a scout instead of doing useful work (`2026-08-18T20-35-49-069Z_01a01696-60cd-7088-b992-d84823d91153.jsonl`, message `4e6d2d02`);
- the Workbench product documents disagree about automatic versus owner-confirmed checkpoints.

The standing environment also steers leads toward process: delegate proactively, prefer background children, reconcile results, use independent review, and preserve lifecycle state. The [default-context challenge dossier](default-context-challenge-dossier.md) states that several worker-era additions came from plausible reasoning rather than observed failure.

A recent short opening Workbench question began with a 14,057-token first model call (`2026-08-27T08-06-40-610Z_01a04241-c0e2-79d5-8195-498362d48502.jsonl`). A repository-local estimate recorded on 2026-08-26 listed about 1,431 words of skill index, 762 words of subagent guidance, and 894 words across loaded `AGENTS.md` files. Cache reuse can make this affordable without preventing the text from steering behavior or conflicting.

The Marketing Autopilot complaint is therefore credible as a harness symptom, not merely frustration: “you are constantly reintroducing unnecessary shit.”  
Evidence: `~/.pi/agent/sessions/--Users-tschuehly-IdeaProjects-PhotoQuest.pi-marketing-autopilot-v1--/2026-08-10T10-49-48-037Z_019feb4a-fd05-7293-ace2-3bed4cd4a25c.jsonl`, message `29c045cf`.

### 3. Some tasks are genuinely difficult

Video quality is subjective, UI preferences emerge through interaction, model infrastructure is flaky, and cross-repository product architecture is hard to validate. A long session is not automatically waste. The qualitative sample intentionally selected painful roots and cannot estimate how often agents were simply productive.

The correct response to genuine uncertainty is earlier human-readable evidence, not pretending the task is deterministic and not removing all safeguards. Both the owner and the agents alternate between “add full ceremony” and “just vibe”; each is a global answer to a local calibration problem.

## Use agents differently

For the next ten real tasks, use only this contract:

```text
Outcome: What concrete result should exist at the end?
Evidence: What will I inspect or run to know it is right?
Keep fixed: What must not change or expand?
Ask first: Which choices still belong to me?
```

Then apply three rules:

1. **One attended lead, one reviewable slice.** Do not request subagents, a plan, a Workstream, a checkpoint, or “maximum effort.” Let the lead propose one bounded child only if it can name what context the child protects and how the result will be checked.
2. **After two directional corrections, stop.** Rewrite the four lines instead of patching the same run. If the owner says “I don't understand,” all mutation stops until the current state and next choice are clear in ordinary language.
3. **No new reusable mechanism until the same narrow failure occurs in three completed tasks.** First try deleting an instruction, narrowing the task, or using an existing tool.

For example:

```text
Outcome: Deliver one working PI WEB create → leave → return → resume flow matching `docs/plans/pi-web-unified-shell-prototype-fidelity.md`.
Evidence: I can complete that path after restarting the PI WEB web process.
Keep fixed: No new lifecycle concepts, levels, workers, or unrelated navigation redesign.
Ask first: Any interaction choice the selected prototype does not answer.
```

Exploratory UI, architecture discovery, and creative quality stay attended and end at the first concrete decision artifact. AFK is reserved for a mature queue with deterministic item-level acceptance. The Workbench's own [AFK retrospective](afk-goal-session-retrospective-2026-08-12.md) found six accepted videos in the plain Goal window—one began before that window—while wrapped runs added waits, checkpoints, and reviewer serialization without proving greater value.

## 30-day subtraction reset

**Remove from the working routine on day one:** proactive delegation, durable workers, autonomous grills, mandatory Workstream/checkpoint ceremony, AFK wrappers, and model-comparison panels. Do not delete repository history or close owner state automatically; simply stop invoking these mechanisms for ordinary work.

For 30 days:

- add no Workbench concept, skill, worker type, routing layer, or review protocol;
- use one lead per outcome;
- finish the single create/resume PI WEB path above or temporarily use the working terminal surface instead;
- after each of ten tasks, write only `outcome reached?`, `direction corrections`, and `do I understand it?` in a plain note;
- after task ten, remove standing guidance that prevented no observed failure.

This is deliberately not another operating model. It is a bounded deletion test.

## How to use the AI Engineer repo

At `aff1059`, `ai-engineer` is an LLM-maintained wiki with 1,284 concept pages from 388 processed conference videos. Its provenance discipline is useful: pages link to transcript timestamps and often state limitations. Its evidence is still dominated by vendor talks, anecdotes, and unmeasured recommendations.

Use it only in this sequence:

1. name one observed failure from a completed task;
2. retrieve two or three relevant pages;
3. follow them to source notes and limitations;
4. try the smallest reversible behavior change;
5. keep it only if comparable tasks improve.

Start with [Broken Agent Setup](https://github.com/tschuehly/ai-engineer/blob/aff105925eab5566c77953fb69fa9aaae7156e4c/data/ai_engineer_youtube/wiki/concepts/read-a-broken-agent-setup-from-babysitting-context-burn-and-slop.md), [Velocity Sickness](https://github.com/tschuehly/ai-engineer/blob/aff105925eab5566c77953fb69fa9aaae7156e4c/data/ai_engineer_youtube/wiki/concepts/velocity-sickness-is-output-without-impact.md), [Understand Agent Work to Participate](https://github.com/tschuehly/ai-engineer/blob/aff105925eab5566c77953fb69fa9aaae7156e4c/data/ai_engineer_youtube/wiki/concepts/understand-agent-work-to-participate-not-just-to-verify.md), [Surface Your Own Unknowns](https://github.com/tschuehly/ai-engineer/blob/aff105925eab5566c77953fb69fa9aaae7156e4c/data/ai_engineer_youtube/wiki/concepts/use-the-agent-to-surface-your-own-unknowns.md), and [Add Structure Where Reliability Fails](https://github.com/tschuehly/ai-engineer/blob/aff105925eab5566c77953fb69fa9aaae7156e4c/data/ai_engineer_youtube/wiki/concepts/add-structure-where-agent-reliability-fails.md).

The independent source audit suggested several low-cost Workbench additions, including new independence rules, stop-reason evidence, context caps, and an “emit nothing” terminal state. They may be reasonable later; this report deliberately overrides that backlog recommendation because adding mechanisms now would contradict the observed need for subtraction. Do not refresh the whole evidence ledger or ingest more videos during the reset.

## External cross-check

- Anthropic's [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) recommends the simplest possible solution and says complexity should be added only when it demonstrably improves outcomes. It also warns that frameworks can obscure prompts and tempt unnecessary complexity.
- GitHub's [coding-agent guidance](https://docs.github.com/copilot/how-tos/agents/copilot-coding-agent/best-practices-for-using-copilot-to-work-on-tasks) recommends clear, well-scoped problems, acceptance criteria, and relevant file directions. It lists ambiguous, learning-heavy, broadly scoped, and critical tasks as work a developer may want to retain rather than delegate wholesale.
- METR's [2025 randomized study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) found 16 experienced open-source developers took 19% longer with early-2025 AI tools on 246 tasks in familiar repositories while believing they were faster. The study is narrow and does not show that AI slows most developers; it shows that felt speed is not reliable evidence of valuable progress.

## Smallest next action

For the next real task, do not improve the harness. Start one attended Pi session with the four-line contract and stop after the first reviewable slice. Repeat before deciding what Pi Workbench needs.

## Method limits

The full-corpus pass measured structure, tool use, usage, and errors; it did not semantically read all 12.3 GiB. Qualitative conclusions come from a purposive review of about twelve large, recent, correction-heavy roots across the major project families. This demonstrates recurring mechanisms, not their prevalence across every human root. Child relationships are inferred because Pi stores no explicit parent ID. Temporary raw-prompt metrics were deleted after aggregation because they contained session text and secrets; the streaming script and non-sensitive aggregate/qualitative reports remain in `/tmp` for this session.
