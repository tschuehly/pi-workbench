#!/usr/bin/env bash
# Checks scripts/install on throwaway repos with a stub promote-installed and app installer: `bash scripts/install.test.sh`.
set -euo pipefail
src=$(cd "$(dirname "$0")" && pwd)/install
t=$(mktemp -d "${PI_TMP:-${TMPDIR:-/tmp}}/install-test.XXXX"); trap 'rm -rf "$t"' EXIT
t=$(cd "$t" && pwd -P)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export HOME=$t/home PI_WORKBENCH_PROJECTS=$t/projects PI_INSTALL_WAIT=5
mkdir -p "$HOME" "$t/projects"
pass=0
ok() { pass=$((pass + 1)); echo "ok   - $1"; }
fail() { echo "FAIL - $1"; [[ -f $t/out ]] && sed 's/^/       /' "$t/out"; exit 1; }
check() { local d=$1; shift; if "$@" >/dev/null 2>&1; then ok "$d"; else fail "$d"; fi; }

# Remotes: pi-workbench (main) and pi-web (pi-workbench branch).
for r in wb pw; do git init -q --bare "$t/$r.git"; git clone -q "$t/$r.git" "$t/seed-$r" 2>/dev/null; echo "$r" >"$t/seed-$r/f"
  git -C "$t/seed-$r" add f; git -C "$t/seed-$r" commit -qm one; done
git -C "$t/seed-wb" push -q origin HEAD:refs/heads/main
git -C "$t/seed-pw" push -q origin HEAD:refs/heads/pi-workbench
git clone -q -b main "$t/wb.git" "$t/projects/pi-workbench"
mkdir -p "$t/projects/pi-workbench/scripts"; cp "$src" "$t/projects/pi-workbench/scripts/install"
export PI_WEB_REPO=$t/pw.git
I=$t/projects/pi-workbench/scripts/install

# Stub promote-installed: records its arguments and environment, links the builds, writes the job log (RESULT picks the outcome).
cat >"$t/promote" <<'EOF'
#!/usr/bin/env bash
if [[ $1 == current ]]; then
  for p in pi-workbench pi-web; do t=$(readlink "$PI_WORKBENCH_PROJECTS/$p.durable-installed") && printf '%s ' "${t##*-}" || printf 'none '; done; echo; exit 0
fi
echo "promote $* env=${PI_PROMOTE_DURABLE_ENV:-}" >>"$HOME/calls"
[[ $1 == --force ]] && shift
s=$HOME/.pi-workbench/installed-durable; mkdir -p "$s/jobs/j"
if [[ ${RESULT:-promoted} == promoted ]]; then
  ln -sfn "$s/pi-workbench-${2:0:12}" "$PI_WORKBENCH_PROJECTS/pi-workbench.durable-installed"
  ln -sfn "$s/pi-web-${3:0:12}" "$PI_WORKBENCH_PROJECTS/pi-web.durable-installed"
fi
echo "${RESULT:-promoted} 2026-11-24T00:00:00Z" >"$s/jobs/j/job.log"
echo "scheduled x in 0s; log: $s/jobs/j/job.log"
EOF
printf '#!/bin/sh\necho "app $* dir=$PI_WEB_DIR url=$PI_WEB_URL" >>"$HOME/calls"\n' >"$t/app"
chmod +x "$t/promote" "$t/app"
export PI_INSTALL_PROMOTE=$t/promote PI_INSTALL_APP_SCRIPT=$t/app
rc() { set +e; "$@" >"$t/out" 2>&1; echo $?; set -e; }
calls() { cat "$HOME/calls" 2>/dev/null || true; }

code=$(rc "$I" --dry-run)
check "dry run: exit 0, prints the clone, nothing cloned or called" test "$code" = 0 -a ! -e "$t/projects/pi-web" -a -z "$(calls)"
grep -q "git clone --branch pi-workbench" "$t/out" && ok "dry run: names the PI WEB clone" || fail "dry run: names the PI WEB clone"

wb_rev=$(git -C "$t/wb.git" rev-parse main) pw_rev=$(git -C "$t/pw.git" rev-parse pi-workbench)
code=$(PI_PROMOTE_DURABLE_ENV="GIT_CONFIG_GLOBAL=/x" rc "$I")
check "fresh install: exit 0" test "$code" = 0
check "fresh install: PI WEB cloned on branch pi-workbench" test "$(git -C "$t/projects/pi-web" branch --show-current)" = pi-workbench
check "fresh install: switch to both tips, environment passed through" grep -qx "promote switch $wb_rev $pw_rev --from none none 0 env=GIT_CONFIG_GLOBAL=/x" "$HOME/calls"
check "fresh install: app built --app-only against :8506 from the installed PI WEB" \
  grep -qx "app --app-only dir=$t/projects/pi-web.durable-installed url=http://127.0.0.1:8506" "$HOME/calls"

: >"$HOME/calls"
code=$(rc "$I" --no-app)
check "rerun at the same tips: no switch, no app (--no-app), exit 0" test "$code" = 0 -a -z "$(calls)"
grep -q "already installed" "$t/out" && ok "rerun: says already installed" || fail "rerun: says already installed"
code=$(rc "$I" --dry-run --no-app)
check "dry run at the same tips: plans no switch" bash -c "test $code = 0 && grep -q 'already installed' '$t/out' && ! grep -q 'promote' '$t/out'"

echo two >>"$t/seed-pw/f"; git -C "$t/seed-pw" commit -qam two; git -C "$t/seed-pw" push -q origin HEAD:refs/heads/pi-workbench
new_pw=$(git -C "$t/pw.git" rev-parse pi-workbench)
code=$(RESULT="rollback done" rc "$I" --no-app --force)
check "new PI WEB tip with a failed job: exit 1, --force passed on" bash -c "test $code = 1 && grep -qx 'promote --force switch $wb_rev $new_pw --from ${wb_rev:0:12} ${pw_rev:0:12} 0 env=' '$HOME/calls'"
check "failed job: the checkouts stayed where they were" test "$(git -C "$t/projects/pi-web" rev-parse HEAD)" = "$pw_rev"

mkdir -p "$t/other/scripts"; cp "$src" "$t/other/scripts/install"
code=$(rc "$t/other/scripts/install" --no-app)
check "run from another checkout: exit 1" test "$code" = 1
check "unknown option: exit 2" test "$(rc "$I" --bogus)" = 2
echo "passed $pass"
