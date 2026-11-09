#!/usr/bin/env bash
# Self-check for the pi-eval trial sandbox: runs probes under the trial profile and env from pi-eval.mjs.
# Usage: scripts/pi-eval-sandbox.test.sh   (macOS; needs a populated ~/.pi-workbench and ~/IdeaProjects)
set -u
cd "$(dirname "$0")/.."
trial=$(mktemp -d "${PI_TMP:-$HOME/.pi-workbench/tmp}/pi-eval-sandbox.XXXXXX")
trap 'rm -rf "$trial"' EXIT
echo ok > "$trial/probe.txt"
profile=$(node scripts/pi-eval.mjs sandbox-profile "$trial")
envs=(); while IFS= read -r l; do envs+=("$l"); done < <(node scripts/pi-eval.mjs trial-env "$trial")
# trialEnv deletes SSH_AUTH_SOCK; a candidate can rediscover launchd's socket by glob.
sock=$(ls -d /var/run/com.apple.launchd.*/Listeners 2>/dev/null | head -1)
run() { env -u SSH_AUTH_SOCK "${envs[@]}" sandbox-exec -p "$profile" bash -c "$1" >/dev/null 2>&1; }
fail=0
expect() { # expect allow|deny label command
  run "$3"; local rc=$?
  if { [ "$1" = allow ] && [ $rc -eq 0 ]; } || { [ "$1" = deny ] && [ $rc -ne 0 ]; }; then echo "ok   $1 $2"; else echo "FAIL $1 $2 (exit $rc)"; fail=1; fi
}
first() { ls -d $1 2>/dev/null | head -1; }
need() { [ -n "$2" ] || { echo "FAIL setup: no $1 on this machine"; fail=1; }; }
clone=$(first "$HOME/IdeaProjects/embabel/me/AGENTS.md $HOME/IdeaProjects/embabel/me/CLAUDE.md"); need clone "$clone"
defects=$(first "$HOME/.pi-workbench/evals/cases/*/defects.json"); need defects.json "$defects"
scratch=$(find "$HOME/.pi-workbench/scratch" -type f 2>/dev/null | head -1); need scratch "$scratch"
sshfile=$(find "$HOME/.ssh" -type f 2>/dev/null | head -1); need ~/.ssh "$sshfile"
expect deny "source clone file" "cat '$clone'"
expect deny "case defects.json" "cat '$defects'"
expect deny "retained scratch file" "cat '$scratch'"
expect deny "~/.ssh read" "cat '$sshfile'"
expect deny "ssh-add -l via launchd socket" "SSH_AUTH_SOCK='$sock' ssh-add -l"
expect deny "gh auth token" "gh auth token"
expect deny "security" "security find-generic-password -s github.com"
expect allow "installed AGENTS.md" "cat '$HOME/IdeaProjects/pi-workbench.installed/AGENTS.md'"
expect allow "trial dir file" "cat '$trial/probe.txt'"
expect allow "git author identity" "cd '$trial' && git var GIT_AUTHOR_IDENT"
expect allow "PI_TMP writable and readable" 'mkdir -p "$PI_TMP" && echo x > "$PI_TMP/f" && cat "$PI_TMP/f"'
exit $fail
