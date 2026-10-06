# Storage-aware agents on worktrunk (plan)

Status: accepted 2026-10-06 (simplified after two Sol reviews). Workstream `ws-treehouse-storage-awareness-20261005`.

## Problem

The disk keeps filling unattended. On 2026-10-05 it reached 89% (49 GB free). No single leak causes this; every agent action leaves something behind and nothing removes it:

| Consumer (2026-10-05/06) | Size | Why it grows |
| --- | --- | --- |
| Linked worktrees across `~/IdeaProjects` (78 entries; 19 merged ones removed by hand) | many GB | Agents create worktrees with `git worktree add`; nobody removes them after merge |
| `~/.pi-workbench/tmp` (PI_TMP) | 32 GB → 21 GB after manual cleanup | The 7-active-day sweep keeps everything in busy projects with big sessions; no size cap |
| `PhotoQuest/.scratch` | 13 GB | Gitignored, never cleaned; also hosts 5 task worktrees |
| Docker volumes (56, 52 unused) | 12–20 GB | PhotoQuest's `wt.toml` `post-remove` stops branch containers but keeps `photoquest_<branch>_data` volumes |
| Docker images, npm/Gradle/Homebrew caches | ~10 GB | Regenerable; nothing prunes them |
| `~/.pi-workbench/installed` (8 prunable snapshot registrations), `reports` 4.4 GB, `evals` 2.7 GB | ~10 GB | Promotion and evals keep every revision/run |

Agents also do not know the disk state: nothing tells them free space before a Docker build, a video render or a new worktree.

## Goal and done-when

Agents create and remove worktrees with worktrunk and clean up what their Workstream owns, with no hard limits. **Done when** a week of normal use leaves free space flat or rising with no cleanup by the owner.

Out of scope: CPU/heavy-job limits, worktree pools (Treehouse), PI WEB grouping by lease.

## Rules

- A Workstream **owns** what it links to (checkpoint references and links): its worktrees, its Docker containers and volumes, its scratch `~/.pi-workbench/scratch/<workstream-id>/`, its sessions' PI_TMP folders.
- The owning agent decides by its own judgment what to delete, including scratch, volumes and unmerged work. Anything another open Workstream links to stays. If the Workstream Store cannot be read, nothing is deleted.
- Things no open Workstream links to may be cleaned by any agent working in that repository.
- Only the owner cleans installed snapshots, `reports/` and `evals/`.
- A merged worktree may be removed even if old chats ran in it, once the checkpoint records branch and commit; `wt switch --create <branch> --base <commit>` recreates it at the same path to continue a chat.

## The four parts

1. **Report.** `mac-storage-workspaces --workstream <id>` in [mac-storage-maintenance](/Users/tschuehly/IdeaProjects/mac-storage-maintenance) lists free space, what the Workstream owns with sizes and pins, and unlinked worktrees in the same repositories. Bounded `du`, fast enough for a checkpoint.
2. **Checkpoint and orient.** Both skills run the report; the agent cleans up and writes one line in the checkpoint saying what it kept and why.
3. **Storage hook.** A `storage-guard` Pi extension: below 50 GB free, `before_agent_start` adds one line ("Disk low: N GB free; this Workstream owns M GB") and `agent_before_settle` appends a cleanup request and continues once at every run end (never twice in a row).
4. **Worktrunk.** Rules in harness.md, global `AGENTS.md`, the workstreams skill and PhotoQuest `CLAUDE.md`: create with `wt switch --create`, remove with `wt remove` after merge; `wt merge` is not used. Before removal the agent moves what it needs from `.scratch/` into the Workstream's scratch; a user-level `pre-remove` hook in `~/.config/worktrunk/config.toml` moves any leftover there and aborts removal if the move fails.

The 6-hourly `mac-storage-candidates.sh` job stays as it is.

## Checks

1. Report: run for this Workstream and one PhotoQuest Workstream; sizes match `du`; finishes in seconds.
2. Checkpoint/orient: one real checkpoint shows the list and the agent acts on it.
3. Hook: with a faked free-space value, the line appears and the run continues exactly once.
4. Worktrunk: create and remove a worktree with `wt`; leftover `.scratch` lands in the Workstream's scratch; a failed move aborts removal.

## Deferred (add when the named problem shows up)

- Waking idle Chats from the 6-hourly job — if the disk fills while all chats are idle.
- `PI_SCRATCH` variable in every session type — if agents keep getting the scratch path wrong.
- Locking around worktree removal — if a removal ever hits a chat opening.
- Recording the owner when a worktree is created — if Workstream links prove unreliable.
- Per-repo cache-copy config (`.worktreeinclude`) — if new worktrees start slowly.
