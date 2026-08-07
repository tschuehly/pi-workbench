#!/usr/bin/env bash

set -Eeuo pipefail

test_root="$(mktemp -d "${TMPDIR:-/tmp}/pi-workbench-install-test.XXXXXX")"
test_root="$(cd "${test_root}" && pwd -P)"
trap 'rm -rf "${test_root}"' EXIT

app_path="${test_root}/Applications/Pi Workbench.app"
fake_bin="${test_root}/bin"
fake_checkout="${test_root}/pi-web-checkout"
fake_cli_log="${test_root}/pi-web-cli.log"
fake_open_log="${test_root}/open.log"
command_dir="${test_root}/commands"
mkdir -p "${fake_bin}" "${fake_checkout}" "${test_root}/home" "${test_root}/state" "${test_root}/launch-agents" "${test_root}/tmp"
printf '{"name":"@jmfederico/pi-web"}\n' >"${fake_checkout}/package.json"
: >"${fake_cli_log}"
: >"${fake_open_log}"

cat >"${fake_bin}/pi-web" <<'FAKE_CLI'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >>"${PI_WEB_FAKE_CLI_LOG}"
case "${1:-}" in
  status)
    cat <<'JSON'
{"schemaVersion":1,"generatedAt":"2026-01-01T00:00:00Z","platform":"darwin","backend":"launchd","installMode":"not-installed","components":[{"component":"sessiond","ownership":"absent","health":"unhealthy","instances":[],"diagnostics":[],"processTrees":[]}]}
JSON
    ;;
  install)
    if [[ "${PI_WEB_FAKE_FAIL_INSTALL:-0}" == 1 ]]; then
      echo "simulated install preflight failure" >&2
      exit 42
    fi
    ;;
esac
FAKE_CLI
chmod +x "${fake_bin}/pi-web"

cat >"${fake_bin}/open" <<'FAKE_OPEN'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >>"${PI_WEB_FAKE_OPEN_LOG}"
FAKE_OPEN
chmod +x "${fake_bin}/open"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
run_installer() {
  HOME="${test_root}/home" \
  TMPDIR="${test_root}/tmp" \
  PATH="${fake_bin}:${PATH}" \
  SWIFTPM_BUILD_DIR="${test_root}/swift-build" \
  PI_WEB_DIR="${fake_checkout}" \
  PI_WEB_CLI="${fake_bin}/pi-web" \
  PI_WEB_COMMAND_DIR="${command_dir}" \
  PI_WEB_DATA_DIR="${test_root}/state" \
  PI_WEB_LAUNCH_AGENTS_DIR="${test_root}/launch-agents" \
  PI_WEB_FAKE_CLI_LOG="${fake_cli_log}" \
  PI_WEB_FAKE_FAIL_INSTALL="${PI_WEB_FAKE_FAIL_INSTALL:-0}" \
    bash "${script_dir}/install-app.sh" "${app_path}" >/dev/null
}

run_installer

failures=0
check_equal() {
  local description="$1"
  local expected="$2"
  local actual="$3"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'not ok - %s\n  expected: %s\n  actual:   %s\n' "${description}" "${expected}" "${actual}" >&2
    failures=$((failures + 1))
  fi
}
check_true() {
  local description="$1"
  shift
  if ! "$@"; then
    printf 'not ok - %s\n' "${description}" >&2
    failures=$((failures + 1))
  fi
}

bundle_executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "${app_path}/Contents/Info.plist")"
installed_executable="${app_path}/Contents/MacOS/${bundle_executable}"
file_description="$(file -b "${installed_executable}" 2>/dev/null || true)"
linked_libraries="$(otool -L "${installed_executable}" 2>/dev/null || true)"
bundle_config="${app_path}/Contents/Resources/PIWebConfig.plist"

check_equal "CFBundleExecutable is the native AppKit executable" "PIWebMac" "${bundle_executable}"
check_true "the bundle executable is an executable file" test -x "${installed_executable}"
check_true "the bundle executable is compiled Mach-O, not a shell script" grep -q 'Mach-O' <<<"${file_description}"
check_true "the bundle executable links AppKit" grep -q '/AppKit.framework/' <<<"${linked_libraries}"
check_true "the detached shell launcher is not installed" test ! -e "${app_path}/Contents/MacOS/PiWorkbenchLauncher"
check_equal "bundle config records CLI" "${fake_bin}/pi-web" "$(/usr/libexec/PlistBuddy -c 'Print :CLIPath' "${bundle_config}")"
check_equal "bundle config records checkout" "${fake_checkout}" "$(/usr/libexec/PlistBuddy -c 'Print :CheckoutPath' "${bundle_config}")"
check_equal "bundle config records development URL" "http://127.0.0.1:8505" "$(/usr/libexec/PlistBuddy -c 'Print :ServerURL' "${bundle_config}")"
check_equal "installer preflights and then installs through typed lifecycle" $'status --json\ninstall --dev' "$(cat "${fake_cli_log}")"
check_true "pi-web-mac command is installed" test -x "${command_dir}/pi-web-mac"

PI_WEB_OPEN="${fake_bin}/open" PI_WEB_FAKE_OPEN_LOG="${fake_open_log}" "${command_dir}/pi-web-mac"
check_equal "pi-web-mac activates only the installed app through open" "${app_path}" "$(cat "${fake_open_log}")"
check_equal "pi-web-mac does not invoke lifecycle CLI" $'status --json\ninstall --dev' "$(cat "${fake_cli_log}")"

printf 'preserve-existing-app\n' >"${app_path}/atomic-marker"
if PI_WEB_FAKE_FAIL_INSTALL=1 run_installer 2>/dev/null; then
  printf 'not ok - installer should fail when lifecycle install preflight fails\n' >&2
  failures=$((failures + 1))
fi
check_true "failed lifecycle install leaves existing app intact" grep -Fxq 'preserve-existing-app' "${app_path}/atomic-marker"
check_true "failed install leaves no staged app next to destination" bash -c '! compgen -G "$1/.Pi Workbench.app.stage.*" >/dev/null' _ "$(dirname "${app_path}")"

if (( failures > 0 )); then
  printf 'Installer contract failed with %d assertion(s).\n' "${failures}" >&2
  exit 1
fi

printf 'ok - installer atomically bundles AppKit, lifecycle config, and open-only command\n'
