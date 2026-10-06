# Storage-aware agents on worktrunk (plan)

Status: draft 2026-10-06, revised after Sol adversarial review (verdict: rework; all 10 findings addressed below), Workstream `ws-treehouse-storage-awareness-20261005`. Owner decisions so far: use [worktrunk](https://worktrunk.dev) (`wt`, v0.74 installed) instead of Treehouse, with our own management in Workbench; scratch lives per Workstream outside the worktree (S2); routine cleanup touches only regenerable data (no Docker volumes or unmerged work without the owner).

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

Agents create and remove worktrees through worktrunk, every artifact an agent creates has an owner and an expiry, and agents see free disk space before heavy work. **Done when** a week of normal use leaves free space flat or rising without manual cleanup, and `storage report` explains every category above 1 GB.
Agents create and remove worktrees through worktrunk, every artifact an agent creates has an owner, and agents see free disk space before and during heavy work. **Done when** a week of normal use leaves free space flat or rising with no cleanup beyond the owner approving the nightly list, and `storage report` explains every category above 1 GB.

Out of scope: CPU/heavy-job limits (resource-guard branch), firstmate, worktree reuse/pools, PI WEB grouping by lease.

## Safety rule

**Automatic deletion is limited to data that is regenerable by construction:** Docker images and build cache, package-manager caches, stale `git worktree` metadata, and the existing PI_TMP sweep. Everything that can hold unique work — worktrees, Docker volumes, Workstream scratch, installed snapshots, `reports/`, `evals/` — is deleted only by its owning agent during attended work, or by the owner approving a listed item. This replaces locking: an attended agent removing its own worktree, or the owner approving a list, cannot race an unattended sweep because there is none. (Sol findings 1, 2, 3, 5, 7.)

## Design

### 1. `storage report` (read-only foundation)

`~/.pi/agent/bin/storage` (Node script in `tools/storage/`, on PATH like `workstreams`). Prints fresh free space (`statfs`, never cached) and, per category in the table above plus background-job logs, size, count and why each item is or is not reclaimable. Worktrees come from `wt list --format json` per repository with: merged/unmerged, dirty, ignored content present (`git status --ignored`), owning Workstream (open checkpoint/link references) or `unowned`, and stored Pi sessions under that exact path. `--json` for scripts. Directory sizes via `du -sk` with a timeout; size estimates may be a day old, free space never is.

### 2. Worktrunk as the worktree engine

- User config `~/.config/worktrunk/config.toml`: sibling `worktree-path` template producing today's `<repo>.<branch-slug>` paths, so PI_TMP project names and PI WEB workspaces keep working.
- Project `.config/wt.toml` in pi-workbench, pi-web and `me` (PhotoQuest has one): `pre-start` runs `wt step copy-ignored` **with a required `.worktreeinclude` allowlist** of dependency caches, copying PhotoQuest's pattern (bare `copy-ignored` copies every ignored file). `pre-remove` rescues `.scratch/` (§4). `post-remove` removes the branch's Docker **containers only**; volumes stay and appear in the report. (Findings 1, 9.)
- No PI_TMP deletion in hooks: PI_TMP is keyed per project, not per branch. (Finding 6.)
- Rules: harness.md "Development worktrees", global `AGENTS.md`, the workstreams skill's retire section and PhotoQuest `CLAUDE.md`: create with `wt switch --create <branch>` and link the path to the Workstream; after the PR merges, the owning agent runs `wt remove` following the skill's existing pre-removal checks (clean, landed, no stored Pi sessions under the path, continuation moved). Integration stays via GitHub PRs; `wt merge` is not used. The `pi-tmp` guard's worktree warning also flags `git worktree add`.

### 3. Nightly report and owner-approved cleanup

A nightly launchd job:
1. Applies the automatic set from the safety rule (`docker image prune -a`, `docker builder prune`, `git worktree prune`; package caches only when free < 30 GB).
2. Runs `storage report` and sends `notify_human` with the **owner-gate list** when it is non-empty or free space < 30 GB: merged worktrees left behind, unowned/unmerged worktrees, Docker volumes without a container, closed Workstreams' scratch, installed snapshots no service or loaded session references (as far as the report can tell; otherwise listed as "unknown use").
3. The owner approves by id (`storage remove <id>…`); the command re-checks each item and refuses anything whose state changed or contains ignored content not shown at approval.

### 4. Workstream scratch (S2)

- `~/.pi-workbench/scratch/<encoded-workstream-id>/`: the id is encoded as one path component; deletion verifies the resolved path stays inside the scratch root and follows no symlinks. (Finding 4.)
- Exported as `PI_SCRATCH` on **every launch path where PI_TMP is set today** — attended `bash` via background-bash, Subagents/Workers via the pi-tmp extension — resolved per command from the session's (or parent's) Workstream; unassociated sessions get none. (Finding 10.)
- **Never deleted automatically,** open or closed (owner requirement: no needed scratch lost). Closure is not consent. The report lists size per Workstream; the owner deletes after seeing contents. The Store already accepts these paths.
- **Rescue on worktree removal:** `pre-remove` moves a non-empty `.scratch/` to the owning Workstream's scratch (or `scratch/unowned/<worktree>/`); if the move fails, removal aborts.
- PI_TMP stays throwaway (existing sweep). Agents put anything worth keeping in `PI_SCRATCH`. Migration: move worktrees out of `PhotoQuest/.scratch` with `wt`, then move the rest to `scratch/unowned/PhotoQuest/` for the owner to sort.

### 5. Agent awareness and growth bounds

- `pi-tmp` extension (already on every command) appends a one-line warning to `bash` results when free space < 30 GB and blocks known heavy commands (`docker build`, `wt switch --create`, Gradle/npm installs, video renders) below 15 GB with "run `storage report`".
- Running jobs: background-bash's runner checks free space while a job writes; below 10 GB it stops the job with a clear message, and it caps each job's log file (keeps the tail). (Finding 8.)
- Existing PI_TMP sweep additionally skips folders belonging to a still-running background job. (Finding 6.)
- Global `AGENTS.md`: "Clean up what you start: containers, your worktree (`wt remove` after merge), files > 1 GB. Keep evidence in `$PI_SCRATCH`, never in the repo checkout."

## Phases and checks

1. **Report** (§1). Check: categories match `du`/`docker system df` within 10%; worktree classification fixture tests (merged/unmerged/dirty/ignored/stored-session).
2. **Worktrunk adoption + scratch rescue** (§2, §4 rescue). Check: create/remove in pi-workbench and `me` with `wt`; `.worktreeinclude` limits copying; a non-empty `.scratch/` survives removal; a failed move aborts removal; containers gone, volume listed.
3. **Workstream scratch** (§4). Check: `PI_SCRATCH` present in attended bash, a Subagent and a Worker; traversal/symlink fixtures refused.
4. **Awareness and bounds** (§5). Check: threshold tests with a fake `statfs`; a job writing past the low-water mark is stopped; log cap holds.
5. **Nightly job** (§3). Check: one supervised run; notification lists only owner-gate items; `storage remove` refuses a changed item. Then one week of daily free-space readings.

Each phase is one PR to pi-workbench `main`, promoted with `switch-workbench` (no PI WEB restart expected).

## Open questions

- Thresholds 30 / 15 / 10 GB on a 460 GB disk?
- Should `reports/` and `evals/` stay owner-managed (current plan) or get an expiry?
