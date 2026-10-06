# PI_TMP

Every Pi command gets `PI_TMP`, a private scratch folder for its session: `~/.pi-workbench/tmp/<project>/<session-id>/`. Agents use it instead of `/tmp`, which macOS empties on reboot. Worktrees of one repository share their main checkout's `<project>` name.

Each command records today as an active day of the project and marks the session folder as used. When any session starts, a session folder is deleted once its project has had 7 active days since the folder was last used. Idle projects keep their folders. Anything that must last belongs in the repository or a retained artifact, not in `PI_TMP`.

Attended sessions get `PI_TMP` per command from `background-bash`, because one PI WEB daemon hosts several sessions. Subagents and Workers run one session per process, so this extension sets it on the process. Set `PI_TMP_ROOT` to move the root (tests do).

In every session the extension blocks `write` and `edit` into `/tmp`, `/private/tmp`, and `/var/tmp`, and appends a one-line warning to `bash` results that write, `cd`, or add a Git worktree there, and a warning to any `git worktree add` pointing to `wt switch --create`. It never sets `TMPDIR`: the long `PI_TMP` path would overflow the 104-byte Unix socket path limit.
