#!/usr/bin/env bash
# Checks auto-upgrade's update_repo on throwaway repos and its context-guard step with a stub guard: run `bash scripts/auto-upgrade.test.sh`.
set -euo pipefail
source "$(dirname "$0")/auto-upgrade"
t=$(mktemp -d "${PI_TMP:-${TMPDIR:-/tmp}}/auto-upgrade-test.XXXX"); trap 'rm -rf "$t"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
g() { git -C "$@"; }
commit() { echo "$2" >>"$1/f"; g "$1" add f; g "$1" commit -qm "$2"; }
git init -q -b main "$t/src"; commit "$t/src" one; g "$t/src" branch feature
clone() { git clone -q "$t/src" "$t/$1"; }
clone behind; clone dirty; clone diverged; clone onfeature; clone wt
g "$t/onfeature" checkout -q -b feature origin/feature
g "$t/wt" checkout -q -b other; g "$t/wt" worktree add -q "$t/wt-main" main
commit "$t/src" two
echo edit >>"$t/dirty/f"
commit "$t/diverged" local
check() { local out; out=$(update_repo "$t/$1"); [[ $out == *"$2"* ]] || { echo "FAIL $1: expected '$2', got '$out'"; exit 1; }; echo "ok $1: $out"; }
check behind "updated: $t/behind (main +1)"
check dirty "skipped: $t/dirty (main; local changes in the way)"
check diverged "diverged: $t/diverged (main is 1 ahead, 1 behind origin/main)"
check onfeature "updated: $t/onfeature (main)"
check wt "skipped: $t/wt (main not a fast-forward"
[[ -z $(update_repo "$t/behind") ]] && echo "ok behind: nothing left to report"

# context_guard: skipped without folders.json; the report file exists only when the guard flags (exit 1); exit 2 fails the step.
export PI_CONTEXT_GUARD_DIR=$t/guard GUARD=$t/guard.mjs; mkdir -p "$t/guard"
context_guard "$t/none" >/dev/null && [[ ! -e $t/none ]] && echo "ok guard: skipped without folders.json" || { echo "FAIL guard"; exit 1; }
echo '[]' >"$t/guard/folders.json"
guard() { echo "console.log('$1'); process.exitCode = $2;" >"$GUARD"; }
guard "No flags." 0; context_guard "$t/clean" >/dev/null && [[ ! -e $t/clean ]] && echo "ok guard: clean run writes no report" || { echo "FAIL guard"; exit 1; }
guard "- flag" 1; context_guard "$t/flagged" >/dev/null && [[ $(cat "$t/flagged") == "- flag" ]] && echo "ok guard: flags written to the report" || { echo "FAIL guard"; exit 1; }
guard "boom" 2; ! context_guard "$t/crash" >/dev/null && [[ ! -e $t/crash ]] && echo "ok guard: crash fails the step" || { echo "FAIL guard"; exit 1; }
