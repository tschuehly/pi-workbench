# Workstream record — PI WEB prototype UX

Status: open · revision 4 · freshness current

> **This is a hand-maintained record, not managed Run state.** The Run Controller and Workstream
> Store are still under construction, so no operational store owns this Workstream and no PI WEB
> projection reads it. This file mirrors the [Workstream contract](../contracts/workstreams.md)
> shape so the work has a durable, contract-faithful home. Git history is the source of truth for
> the checkpoints below; treat this file as the ledger and current-state projection over them.

## Current state

### Sessions

- **Session 1 — Unified Chat/Workstream shell prototype** · anchor `pi-workbench · main` · active.
  - Latest confirmed checkpoint (`5dcb630`):
    - **What changed:** rebuilt the throwaway prototype into one coherent shell (three middle
      destinations: standalone Chat, Workstream brief, Workstream session); added a main-area tool
      switcher with a real file finder and git diff viewer, subagent child executions with a
      read-only inspect view, and a bottom terminal pane; tightened the Workstream brief for
      return-attention; trimmed icons to information-bearing use; made the left navigator an
      attention surface.
    - **What remains:** apply the same conciseness / write-for-humans pass to the session Context
      tab durable-task cards and the child-inspect view (see focus-handoff, HT-2); obtain human
      acceptance of the prototype direction (HT-1); only then write a production implementation plan.
    - **Next useful continuation:** run the Context/child-inspect conciseness slice, then request
      acceptance.
  - No checkpoint failure. Staleness: current.

### Durable Human Tasks

- **HT-1 — Accept the current prototype direction?** kind: yes/no/change · materiality: high
  (gates production planning) · source: Session 1 · status: **pending**.
- **HT-2 — Do the Context tab and child-inspect conciseness pass?** kind: yes/no/change ·
  materiality: medium · source: Session 1 · status: **pending** (a paste-ready focus-handoff brief
  exists in the session transcript).

### Links (referenced, not owned)

- Plan: [`docs/plans/pi-web-unified-chat-workstream-prototype.md`](./pi-web-unified-chat-workstream-prototype.md)
- Working prototype: [`docs/research/reports/pi-web-unified-chat-workstream-prototype.html`](../research/reports/pi-web-unified-chat-workstream-prototype.html)
- Read-only references: `docs/research/reports/pi-web-workbench-ux-prototype.html`,
  `docs/research/reports/pi-web-subagent-ux-prototype.html`
- Skill applied to UI copy: `~/.agents/skills/write-for-humans`

### Closure

Open. Closing this record freezes the prototype context as completed; later production work starts a
new Workstream and may reference this one.

## Ledger (append-only)

Records appended only at meaningful attention changes; routine tool activity is omitted. Each record
names its source session and the git commit that is its durable evidence.

| When | Session | Record |
| --- | --- | --- |
| Session 1 | 1 | Session associated with this Workstream (home ledger). |
| Session 1 | 1 | Checkpoint confirmed — converge prototype on one shell (`a383b6a`). |
| Session 1 | 1 | Checkpoint confirmed — add tools, subagents, bottom terminal (`fb28eaa`). |
| Session 1 | 1 | Checkpoint confirmed — tighten the Workstream brief (`430354b`). |
| Session 1 | 1 | Checkpoint confirmed — trim icons; navigator as attention surface (`5dcb630`). |
| Session 1 | 1 | Human Tasks raised: HT-1 (accept direction), HT-2 (Context/child-inspect pass). |
