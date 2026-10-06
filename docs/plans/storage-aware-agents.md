# Storage-aware agents on worktrunk (plan)

Status: draft 2026-10-06, revised after two Sol adversarial reviews (both REWORK; findings folded in, owner decisions listed under Decided), Workstream `ws-treehouse-storage-awareness-20261005`. Owner decisions so far: use [worktrunk](https://worktrunk.dev) (`wt`, v0.74 installed) instead of Treehouse, with our own management in Workbench; scratch lives per Workstream outside the worktree (S2); routine cleanup touches only regenerable data (no Docker volumes or unmerged work without the owner).

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

Agents create and remove worktrees through worktrunk, every artifact an agent creates has an owner, and agents are told what they own and clean it up themselves, with no hard limits. **Done when** a week of normal use leaves free space flat or rising with no cleanup by the owner, and `storage-report` explains every category above 1 GB.

Out of scope: CPU/heavy-job limits (resource-guard branch), firstmate, worktree reuse/pools, PI WEB grouping by lease.

## Safety rule

- **Unattended (scheduled job):** only dangling Docker images (`docker image prune`, never `-a`) and build cache, npm/Homebrew via the job's existing guarded paths, stale `git worktree` metadata, and the existing PI_TMP sweep.
- **Owning agent (attended, at checkpoint, orient or a storage hook):** decides by its own judgment on everything its Workstream created — worktrees (merged or not), `.scratch` contents, Workstream scratch, Docker volumes and containers, unmerged work. Ownership = the Workstream that created the item (recorded at creation, §2). A reference from another Workstream is a **retention pin**: the item stays. An unreadable Workstream Store or session inventory means keep everything (fail closed). Items no Workstream owns may be cleaned by any agent working in that repo (§5).
- **Owner only:** installed snapshots, `reports/`, `evals/`, tagged Docker images.

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
- Rules: harness.md "Development worktrees", global `AGENTS.md`, the workstreams skill's retire section and PhotoQuest `CLAUDE.md`: create with `wt switch --create <branch>` and link the path to the Workstream; after the PR merges, the owning agent retires it with `storage-retire <path>`, which takes a lock file, re-checks ownership, pins, cleanliness, landed commit and that no process has its cwd inside, then runs `wt remove`. Residual race (a session opening in that second) is accepted by the owner; `ponytail:` add a session-start check of the lock if it ever bites.
- **Decided (2026-10-06): old chats do not block retirement.** A merged worktree may be retired once the Workstream checkpoint records branch and full commit. Transcripts stay readable; to continue a chat, `wt switch --create <branch> --base <commit>` recreates the worktree at the same path (deterministic path template), so the session's cwd exists again. The workstreams skill's retire rule changes accordingly.

### 3. Scheduled job (script, no agent)

The existing 6-hourly `mac-storage-candidates.sh` launchd job:
1. Adds the rest of the unattended set (`docker image prune`, `docker builder prune`, `git worktree prune`); npm/Homebrew stay on its existing paths.
2. Runs the report and attributes items to their creating Workstream.
3. No Telegram or other owner messages. Unowned items surface in checkpoint/orient (§5).
4. **Wakes the owning Chat when free space < 50 GB (decided 2026-10-06).** For each Workstream whose owned items grew since the last run, it posts one message into that Workstream's most recent session through PI WEB (the same follow-up mechanism that delivers subagent completions, `sendCustomMessage` with `triggerTurn`): "Disk low: N GB free. This Workstream owns M GB (+K since last check) — run `storage-report --workstream` and clean up what you no longer need." Deduplicated: at most one wake per Workstream per day unless growth continues. A Workstream with no reachable session is picked up at its next checkpoint or orient. This covers idle chats whose job keeps writing.

### 4. Workstream scratch (S2)

- `~/.pi-workbench/scratch/<encoded-workstream-id>/`: the id is encoded as one path component; deletion verifies the resolved path stays inside the scratch root and follows no symlinks. (Finding 4.)
- Exported as `PI_SCRATCH` on **every launch path where PI_TMP is set today** — attended `bash` via background-bash, Subagents/Workers via the pi-tmp extension — resolved per command from the session's (or parent's) Workstream; unassociated sessions get none. (Finding 10.)
- **Never deleted by the scheduled job.** The owning agent decides what in it is still needed and deletes the rest; anything another Workstream links to stays. `storage-report` lists size per Workstream. The Store already accepts these paths.
- **`.scratch` on worktree removal:** before retiring, the agent sorts `.scratch/`: it moves what is needed into the Workstream's scratch and deletes the rest. As a safety net, the user-level `pre-remove` hook moves anything still left to the Workstream's scratch (or `scratch/unowned/<worktree>/`); if the move fails, removal aborts.
- PI_TMP stays throwaway (existing sweep). Agents put anything worth keeping in `PI_SCRATCH`. Migration: move worktrees out of `PhotoQuest/.scratch` with `wt`, then agents working in PhotoQuest sort the rest like any unowned item.

### 5. Agents clean up their own stuff (no hard limits)

No thresholds that block commands or stop jobs. Instead agents are told what they own and decide, because they know what is still needed.

- **Checkpoint and orient both check what can be deleted.** The workstreams skill's checkpoint step and the `orient` skill run `storage-report --workstream <id>`, which also lists unowned items in the same repositories. The agent cleans up what is no longer needed (safety rule) and records in the checkpoint what it kept and why, in one line.
- **Storage hook (`storage-guard` Pi extension, no limits).** Below 50 GB free (fresh `statfs`): `before_agent_start` adds one line to that run's guidelines — "Disk low: N GB free; this Workstream owns M GB"; `agent_before_settle` appends a cleanup request ("run `storage-report --workstream` and clean up what you no longer need") and continues once, at **every** run end below 50 GB (owner choice). Guard: it never continues twice in a row for the same run, so it cannot loop. The 6-hourly script wakes idle Chats (§3).
- Background-job logs are not capped (the full log is the job's record); they show up as owned items and in the scheduled growth list.
- Existing PI_TMP sweep additionally skips folders belonging to a still-running background job. (Finding 6.)
- Global `AGENTS.md`: "Clean up what you start: containers, your worktree (`wt remove` after merge), files > 1 GB. Keep evidence in `$PI_SCRATCH`, never in the repo checkout."

## Phases and checks

1. **Report** (§1, in mac-storage-maintenance). Check: `--workstream` finishes < 10 s; categories match `du`/`docker system df` within 10%; worktree classification fixture tests (merged/unmerged/dirty/ignored/stored-session).
2. **Worktrunk adoption + scratch rescue** (§2, §4 rescue). Check: create/remove in pi-workbench and `me` with `wt`; `.worktreeinclude` limits copying; a non-empty `.scratch/` survives removal, including on a legacy branch without project config; a failed move aborts removal; containers gone, volume listed.
3. **Workstream scratch** (§4). Check: `PI_SCRATCH` present in attended bash, a Subagent and a Worker; traversal/symlink fixtures refused.
4. **Self-cleanup** (§5). Check: `storage-report --workstream` lists exactly a fixture Workstream's items; a checkpoint in a real session shows the list and the agent removes its merged worktree; the storage hook adds its line and continues exactly once per run end with a fake `statfs`; items pinned by another Workstream survive; `storage-retire` refuses pinned, dirty, unlanded or in-use worktrees.
5. **Scheduled job** (§3, in mac-storage-maintenance). Check: one supervised run; no owner messages; an idle Chat whose job keeps writing files is woken once below 50 GB. Then one week of daily free-space readings.

Phases 1 and 5 are commits to mac-storage-maintenance (also closes its open gap: Docker volumes of removed worktrees are not flagged). Phases 2–4 are PRs to pi-workbench `main`, promoted with `switch-workbench` (no PI WEB restart expected). The two Workstreams stay separate: that one owns the audit tool, this one the agent behaviour.

## Decided

- Old chats do not block retiring a merged worktree (§2). Retire race accepted. Storage hook and Chat wake below 50 GB. Idle growth wakes the owning Chat; no owner messages. `reports/` and `evals/` stay owner-managed.
- Agents decide on everything their Workstream owns, including scratch, volumes and unmerged work; other Workstreams' links pin items; unowned items may be cleaned by agents in that repo; the `.scratch` hook moves leftovers; the cleanup request fires at every run end below 50 GB.
