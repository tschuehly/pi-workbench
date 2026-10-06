# Storage-aware agents on worktrunk (plan)

Status: draft 2026-10-06, revised after two Sol adversarial reviews (both REWORK; findings folded in, owner decisions marked **Decision**), Workstream `ws-treehouse-storage-awareness-20261005`. Owner decisions so far: use [worktrunk](https://worktrunk.dev) (`wt`, v0.74 installed) instead of Treehouse, with our own management in Workbench; scratch lives per Workstream outside the worktree (S2); routine cleanup touches only regenerable data (no Docker volumes or unmerged work without the owner).

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

Agents create and remove worktrees through worktrunk, every artifact an agent creates has an owner, and agents are told what they own and clean it up themselves, with no hard limits. **Done when** a week of normal use leaves free space flat or rising with no cleanup by the owner beyond approving the short list of unowned items, and `storage-report` explains every category above 1 GB.

Out of scope: CPU/heavy-job limits (resource-guard branch), firstmate, worktree reuse/pools, PI WEB grouping by lease.

## Safety rule

- **Unattended (scheduled job):** only dangling Docker images (`docker image prune`, never `-a`) and build cache, npm/Homebrew via the job's existing guarded paths, stale `git worktree` metadata, and the existing PI_TMP sweep.
- **Owning agent (attended, at checkpoint):** only its own merged worktree (§2 retire) and its own branch containers. Ownership = the Workstream that created the item (recorded at creation, §2). Any other Workstream's reference is a **retention pin**, not permission; a pinned, shared or unknown item is kept. An unreadable Workstream Store or session inventory means keep everything (fail closed).
- **Owner only, per item:** Workstream scratch, Docker volumes, unmerged or dirty worktrees, installed snapshots, `reports/`, `evals/`, tagged Docker images.

## Design

### 1. Report: extend the existing `mac-storage-workspaces`

Reuse, do not rebuild. Workstream `ws-mac-cleanup-reproducibility-20260807` already ships [mac-storage-maintenance](/Users/tschuehly/IdeaProjects/mac-storage-maintenance): `mac-storage-workspaces` (commit 1677cc3) is a read-only cross-check of worktrees, open-Workstream references, Pi session activity and running processes, sized from an OpenDisk scan; `mac-storage-candidates.sh` runs every 6 h from launchd and removes only regenerable caches; `mac-storage-analyze` is the full owner-approved audit.

Add to `mac-storage-workspaces`:
- `--workstream <id>`: only items that Workstream created (worktrees, its branches' containers/volumes, its scratch, its sessions' PI_TMP folders and background-job logs) plus pins from other Workstreams, sized with a bounded `du` (< 10 s, fits a checkpoint).
- Full mode: missing categories (`reports/`, package caches, Docker images/volumes) and sizes from the last OpenDisk scan when no scan argument is given (today sizes are empty).
- Per worktree: ignored content present (`git status --ignored`) and stored Pi sessions under that exact path. `--json` for scripts.
- Called by absolute path from launchd and skills (`~/.local/bin` is not on the LaunchAgent's PATH).

Free space always comes from a fresh `statfs`.

### 2. Worktrunk as the worktree engine

- User config `~/.config/worktrunk/config.toml`: sibling `worktree-path` template producing today's `<repo>.<branch-slug>` paths, so PI_TMP project names and PI WEB workspaces keep working.
- Project `.config/wt.toml` in pi-workbench, pi-web and `me` (PhotoQuest has one): `pre-start` runs `wt step copy-ignored` **with a required `.worktreeinclude` allowlist** of dependency caches, copying PhotoQuest's pattern (bare `copy-ignored` copies every ignored file). `post-remove` removes the branch's Docker **containers only**; volumes stay and appear in the report. (Findings 1, 9.)
- **User-level hooks** in `~/.config/worktrunk/config.toml` (run first, need no approval, apply to every repo and to legacy branches): `post-start` records the creating Workstream (`workstreams link` with kind `worktree`); `pre-remove` rescues `.scratch/` (§4). Agents never pass `--no-hooks`.
- No PI_TMP deletion in hooks: PI_TMP is keyed per project, not per branch. (Finding 6.)
- Rules: harness.md "Development worktrees", global `AGENTS.md`, the workstreams skill's retire section and PhotoQuest `CLAUDE.md`: create with `wt switch --create <branch>` and link the path to the Workstream; after the PR merges, the owning agent retires it with `storage-retire <path>`, which takes a lock file, re-checks ownership, pins, cleanliness, landed commit and that no process has its cwd inside, then runs `wt remove`. Residual race (a session opening in that second) is accepted; `ponytail:` add a session-start check of the lock if it ever bites.
- **Decision (stored sessions):** today the skill forbids removing a worktree that has stored Pi sessions, and nearly every worktree has some, so nothing would ever be retired. Proposal: allow retirement once the Workstream checkpoint records branch and full commit. Transcripts stay readable; to continue a chat, `wt switch --create <branch> --base <commit>` recreates the worktree at the same path (deterministic path template), so the session's cwd exists again. Integration stays via GitHub PRs; `wt merge` is not used. The `pi-tmp` guard's worktree warning also flags `git worktree add`.

### 3. Scheduled report: owned items go to their agents, unowned to the owner

The existing 6-hourly `mac-storage-candidates.sh` launchd job:
1. Adds the rest of the unattended set (`docker image prune`, `docker builder prune`, `git worktree prune`); npm/Homebrew stay on its existing paths.
2. Runs the report and attributes items to their creating Workstream.
3. Sends `notify_human` when there are **unowned** items (owner approves by id with `storage-remove <id>…`, which re-checks and refuses changed items or ignored content not shown), **or** when free space < 30 GB: then it also lists the top owned consumers per Workstream and their growth since the last run, so an idle Workstream whose job keeps writing is visible without any agent command.
   **Decision (idle agents):** is a message to you enough, or should the job also wake the owning session (e.g. a PI WEB message into its Chat)?

### 4. Workstream scratch (S2)

- `~/.pi-workbench/scratch/<encoded-workstream-id>/`: the id is encoded as one path component; deletion verifies the resolved path stays inside the scratch root and follows no symlinks. (Finding 4.)
- Exported as `PI_SCRATCH` on **every launch path where PI_TMP is set today** — attended `bash` via background-bash, Subagents/Workers via the pi-tmp extension — resolved per command from the session's (or parent's) Workstream; unassociated sessions get none. (Finding 10.)
- **Never deleted by the scheduled job or by agents,** open or closed (owner requirement: no needed scratch lost). Closure is not consent. `storage-report` lists size per Workstream; the owner deletes after seeing contents. The Store already accepts these paths.
- **Rescue on worktree removal:** the user-level `pre-remove` hook moves a non-empty `.scratch/` to the owning Workstream's scratch (or `scratch/unowned/<worktree>/`); if the move fails, removal aborts.
- PI_TMP stays throwaway (existing sweep). Agents put anything worth keeping in `PI_SCRATCH`. Migration: move worktrees out of `PhotoQuest/.scratch` with `wt`, then move the rest to `scratch/unowned/PhotoQuest/` for the owner to sort.

### 5. Agents clean up their own stuff (no hard limits)

No thresholds that block commands or stop jobs. Instead agents are told what they own and decide, because they know what is still needed.

- **Cleanup is part of every checkpoint.** The workstreams skill's checkpoint step runs `storage-report --workstream <id>`. The agent retires its own merged worktree and removes its own branch containers (safety rule), and records in the checkpoint what it keeps and why, in one line. Everything else it would like gone (volumes, scratch, unmerged work) goes into `remains` for the owner, never deleted by the agent.
- **Automatic nudge when space gets low.** The `pi-tmp` extension (already on every command) checks free space; below 30 GB it appends one line to the `bash` result: "Disk low: N GB free. This Workstream owns M GB — run `storage-report --workstream` and clean up what you no longer need." Idle sessions get the same line at their next checkpoint or `orient`.
- Background-job logs are not capped (the full log is the job's record); they show up as owned items and in the scheduled growth list.
- Existing PI_TMP sweep additionally skips folders belonging to a still-running background job. (Finding 6.)
- Global `AGENTS.md`: "Clean up what you start: containers, your worktree (`wt remove` after merge), files > 1 GB. Keep evidence in `$PI_SCRATCH`, never in the repo checkout."

## Phases and checks

1. **Report** (§1, in mac-storage-maintenance). Check: `--workstream` finishes < 10 s; categories match `du`/`docker system df` within 10%; worktree classification fixture tests (merged/unmerged/dirty/ignored/stored-session).
2. **Worktrunk adoption + scratch rescue** (§2, §4 rescue). Check: create/remove in pi-workbench and `me` with `wt`; `.worktreeinclude` limits copying; a non-empty `.scratch/` survives removal, including on a legacy branch without project config; a failed move aborts removal; containers gone, volume listed.
3. **Workstream scratch** (§4). Check: `PI_SCRATCH` present in attended bash, a Subagent and a Worker; traversal/symlink fixtures refused.
4. **Self-cleanup** (§5). Check: `storage-report --workstream` lists exactly a fixture Workstream's items; a checkpoint in a real session shows the list and the agent removes its merged worktree; nudge appears with a fake `statfs`; an agent never deletes scratch or volumes; `storage-retire` refuses pinned, dirty, unlanded or in-use worktrees.
5. **Scheduled job** (§3, in mac-storage-maintenance). Check: one supervised run; notification lists unowned items, plus owned growth when below 30 GB (test with an idle job writing files); `storage-remove` refuses a changed item. Then one week of daily free-space readings.

Phases 1 and 5 are commits to mac-storage-maintenance (also closes its open gap: Docker volumes of removed worktrees are not flagged). Phases 2–4 are PRs to pi-workbench `main`, promoted with `switch-workbench` (no PI WEB restart expected). The two Workstreams stay separate: that one owns the audit tool, this one the agent behaviour.

## Open questions

- Is 30 GB the right point to start nudging agents?
- Should `reports/` and `evals/` stay owner-managed (current plan) or get an expiry?
