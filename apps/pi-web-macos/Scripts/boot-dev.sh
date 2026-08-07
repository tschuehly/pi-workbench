#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd "${script_dir}/.." && pwd)"
workbench_dir="$(cd "${app_dir}/../.." && pwd)"
sibling_root="$(cd "$(dirname "${workbench_dir}")" && pwd)"
if [[ -d "${sibling_root}/pi-web.durable-lifecycle" ]]; then
  default_pi_web_dir="${sibling_root}/pi-web.durable-lifecycle"
else
  default_pi_web_dir="${sibling_root}/pi-web"
fi
pi_web_dir="${PI_WEB_DIR:-${default_pi_web_dir}}"
app_path="${PI_WEB_APP_PATH:-${HOME}/Applications/Pi Workbench.app}"
open_command="${PI_WEB_OPEN:-/usr/bin/open}"

fail() {
  echo "PI WEB compatibility adapter: $*" >&2
  exit 1
}

[[ $# -eq 0 ]] || fail "this adapter does not accept arguments"
[[ -d "${pi_web_dir}" ]] || fail "PI WEB checkout not found at ${pi_web_dir}. Set PI_WEB_DIR to its location."
pi_web_dir="$(cd "${pi_web_dir}" && pwd -P)"
[[ -f "${pi_web_dir}/package.json" ]] || fail "${pi_web_dir} does not contain a package.json."
if [[ -n "${PI_WEB_CLI:-}" ]]; then
  pi_web_cli="${PI_WEB_CLI}"
else
  pi_web_cli="$(command -v pi-web 2>/dev/null)" || fail "PI WEB CLI not found. Set PI_WEB_CLI."
fi
[[ -x "${pi_web_cli}" ]] || fail "PI WEB CLI is not executable: ${pi_web_cli}"
pi_web_cli="$(cd "$(dirname "${pi_web_cli}")" && pwd -P)/$(basename "${pi_web_cli}")"
[[ -d "${app_path}" ]] || fail "Pi Workbench app not found at ${app_path}. Run install-app.sh first."
[[ -x "${open_command}" ]] || fail "open command is not executable: ${open_command}"

(
  cd "${pi_web_dir}"
  "${pi_web_cli}" install --dev
  "${pi_web_cli}" start
)
exec "${open_command}" "${app_path}"
