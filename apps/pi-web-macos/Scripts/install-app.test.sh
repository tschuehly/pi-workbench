#!/usr/bin/env bash

set -Eeuo pipefail

test_root="$(mktemp -d "${TMPDIR:-/tmp}/pi-workbench-install-test.XXXXXX")"
trap 'rm -rf "${test_root}"' EXIT

app_path="${test_root}/Applications/Pi Workbench.app"
fake_bin="${test_root}/bin"
fake_cli_log="${test_root}/pi-web-cli.log"
mkdir -p "${fake_bin}" "${test_root}/home" "${test_root}/state" "${test_root}/launch-agents" "${test_root}/tmp"
: >"${fake_cli_log}"

cat >"${fake_bin}/pi-web" <<'FAKE_CLI'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >>"${PI_WEB_FAKE_CLI_LOG}"
FAKE_CLI
chmod +x "${fake_bin}/pi-web"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME="${test_root}/home" \
TMPDIR="${test_root}/tmp" \
PATH="${fake_bin}:${PATH}" \
SWIFTPM_BUILD_DIR="${test_root}/swift-build" \
PI_WEB_CLI="${fake_bin}/pi-web" \
PI_WEB_DATA_DIR="${test_root}/state" \
PI_WEB_LAUNCH_AGENTS_DIR="${test_root}/launch-agents" \
PI_WEB_FAKE_CLI_LOG="${fake_cli_log}" \
  bash "${script_dir}/install-app.sh" "${app_path}" >/dev/null

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

check_equal "CFBundleExecutable is the native AppKit executable" "PIWebMac" "${bundle_executable}"
check_true "the bundle executable is an executable file" test -x "${installed_executable}"
check_true "the bundle executable is compiled Mach-O, not a shell script" grep -q 'Mach-O' <<<"${file_description}"
check_true "the bundle executable links AppKit" grep -q '/AppKit.framework/' <<<"${linked_libraries}"
check_true "the detached shell launcher is not installed" test ! -e "${app_path}/Contents/MacOS/PiWorkbenchLauncher"
check_true "installation delegates development-service ownership to the fake PI WEB CLI" grep -Fxq 'install --dev' "${fake_cli_log}"

if (( failures > 0 )); then
  printf 'Installer contract failed with %d assertion(s).\n' "${failures}" >&2
  exit 1
fi

printf 'ok - installer bundles compiled AppKit PIWebMac and delegates to PI WEB\n'
