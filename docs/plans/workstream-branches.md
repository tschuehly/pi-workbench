# Workstreams as git repositories (idea)

Status: idea from Thomas, 2026-11-24. Not designed or approved; nothing is built.

## Idea

A Workstream behaves like a git repository:

- **Main line:** the Workstream's own status record, meaning its overview and current state.
- **Branch:** one side effort, such as a single Chat trying something, with its own step-by-step notes.
- **Merge:** when the side effort ends, it folds a short result back into the main line. The branch's
  history stays readable but stays out of the main record.

Example: a Chat that built and trialled `/checkpoint` is a branch of the Durable rebuild Workstream. When
it ends, it merges one line into main, "`/checkpoint` shipped in `6c75e13`, live trials passed", and its
trial-by-trial notes remain on the branch.

## Why

Today every session writes its own checkpoint into the Workstream, and the Workstream's `waitingOn` is the
one on its newest checkpoint (`docs/contracts/workstreams.md`). So when several Chats work in one
Workstream, the last one to write decides what the Workstream waits on, and a reader has to piece the
main state together from per-session views.

## Open questions

- How a branch opens: automatically for each session, or only when work forks from main.
- Whether merging happens automatically at session end, or as an explicit step with a result Thomas can
  correct.
- How main shows two branches whose results conflict.
- How it maps onto the current store: session checkpoints may already be branches, and the overview
  could be the merged main line (`docs/contracts/workstreams.md`).
