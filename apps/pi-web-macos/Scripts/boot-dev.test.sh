#!/usr/bin/env bash

set -Eeuo pipefail

test_root="$(mktemp -d "${TMPDIR:-/tmp}/pi-workbench-boot-test.XXXXXX")"
trap 'rm -rf "${test_root}"' EXIT

fake_bin="${test_root}/bin"
fake_checkout="${test_root}/pi-web-checkout"
app_path="${test_root}/Applications/Pi Workbench.app"
cli_log="${test_root}/cli.log"
open_log="${test_root}/open.log"
mkdir -p "${fake_bin}" "${fake_checkout}" "${app_path}" "${test_root}/home"
printf '{"name":"@jmfederico/pi-web"}\n' >"${fake_checkout}/package.json"
fake_checkout="$(cd "${fake_checkout}" && pwd -P)"
: >"${cli_log}"
: >"${open_log}"

cat >"${fake_bin}/pi-web" <<'FAKE_CLI'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s|%s\n' "$(pwd)" "$*" >>"${PI_WEB_FAKE_CLI_LOG}"
FAKE_CLI
chmod +x "${fake_bin}/pi-web"

cat >"${fake_bin}/open" <<'FAKE_OPEN'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >>"${PI_WEB_FAKE_OPEN_LOG}"
FAKE_OPEN
chmod +x "${fake_bin}/open"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME="${test_root}/home" \
PI_WEB_DIR="${fake_checkout}" \
PI_WEB_CLI="${fake_bin}/pi-web" \
PI_WEB_APP_PATH="${app_path}" \
PI_WEB_OPEN="${fake_bin}/open" \
PI_WEB_FAKE_CLI_LOG="${cli_log}" \
PI_WEB_FAKE_OPEN_LOG="${open_log}" \
  bash "${script_dir}/boot-dev.sh" >/dev/null

expected_cli="${fake_checkout}|install --dev
${fake_checkout}|start"
if [[ "$(cat "${cli_log}")" != "${expected_cli}" ]]; then
  printf 'not ok - compatibility adapter lifecycle calls\nexpected:\n%s\nactual:\n%s\n' "${expected_cli}" "$(cat "${cli_log}")" >&2
  exit 1
fi
if [[ "$(cat "${open_log}")" != "${app_path}" ]]; then
  printf 'not ok - compatibility adapter app activation\n' >&2
  exit 1
fi

printf 'ok - boot adapter delegates install/start and app activation to typed boundaries\n'
