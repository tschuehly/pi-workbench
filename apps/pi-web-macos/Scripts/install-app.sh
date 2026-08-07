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
pi_web_url="${PI_WEB_URL:-http://127.0.0.1:8505}"
destination="${1:-${PI_WEB_APP_PATH:-${HOME}/Applications/Pi Workbench.app}}"
command_dir="${PI_WEB_COMMAND_DIR:-${HOME}/.local/bin}"
app_icon="${app_dir}/Resources/AppIcon.icns"
stage=""
backup=""
command_stage=""

fail() {
  echo "PI WEB app installer: $*" >&2
  exit 1
}

absolute_executable() {
  local value="$1"
  local directory
  directory="$(cd "$(dirname "${value}")" 2>/dev/null && pwd -P)" || return 1
  printf '%s/%s\n' "${directory}" "$(basename "${value}")"
}

resolve_cli() {
  local candidate=""
  if [[ -n "${PI_WEB_CLI:-}" ]]; then
    candidate="${PI_WEB_CLI}"
  elif candidate="$(command -v pi-web 2>/dev/null)"; then
    :
  else
    return 1
  fi
  [[ -x "${candidate}" ]] || return 1
  absolute_executable "${candidate}"
}

validate_status_json() {
  local path="$1"
  local schema install_mode count index component ownership health instances
  schema="$(/usr/bin/plutil -extract schemaVersion raw "${path}" 2>/dev/null)" || return 1
  [[ "${schema}" == 1 ]] || return 1
  install_mode="$(/usr/bin/plutil -extract installMode raw "${path}" 2>/dev/null)" || return 1
  [[ "${install_mode}" =~ ^(not-installed|development|development-incomplete|production|production-incomplete|mixed|partial)$ ]] || return 1
  count="$(/usr/bin/plutil -extract components raw "${path}" 2>/dev/null)" || return 1
  [[ "${count}" =~ ^[0-9]+$ ]] || return 1
  for ((index = 0; index < count; index++)); do
    component="$(/usr/bin/plutil -extract "components.${index}.component" raw "${path}" 2>/dev/null)" || return 1
    ownership="$(/usr/bin/plutil -extract "components.${index}.ownership" raw "${path}" 2>/dev/null)" || return 1
    health="$(/usr/bin/plutil -extract "components.${index}.health" raw "${path}" 2>/dev/null)" || return 1
    instances="$(/usr/bin/plutil -extract "components.${index}.instances" raw "${path}" 2>/dev/null)" || return 1
    [[ "${component}" =~ ^(sessiond|web|uiDev)$ ]] || return 1
    [[ "${ownership}" =~ ^(managed|unmanaged|conflict|absent)$ ]] || return 1
    [[ "${health}" =~ ^(healthy|starting|unhealthy|unknown)$ ]] || return 1
    [[ "${instances}" =~ ^[0-9]+$ ]] || return 1
  done
}

cleanup() {
  [[ -z "${stage}" || ! -e "${stage}" ]] || rm -rf "${stage}"
  [[ -z "${command_stage}" || ! -e "${command_stage}" ]] || rm -f "${command_stage}"
  if [[ -n "${backup}" && -e "${backup}" ]]; then
    if [[ ! -e "${destination}" ]]; then
      mv "${backup}" "${destination}" || true
    else
      rm -rf "${backup}"
    fi
  fi
}
trap cleanup EXIT

[[ "${destination}" == *.app ]] || fail "Destination must be a .app bundle: ${destination}"
[[ -d "${pi_web_dir}" ]] || fail "PI WEB checkout not found at ${pi_web_dir}. Set PI_WEB_DIR to its location."
pi_web_dir="$(cd "${pi_web_dir}" && pwd -P)"
[[ -f "${pi_web_dir}/package.json" ]] || fail "${pi_web_dir} does not contain a package.json."
pi_web_cli="$(resolve_cli)" || fail "PI WEB CLI not found. Set PI_WEB_CLI to an executable pi-web command."
[[ -f "${app_icon}" ]] || fail "App icon not found at ${app_icon}."
command -v swift >/dev/null 2>&1 || fail "The Swift toolchain is required. Install Xcode Command Line Tools."

parent_dir="$(dirname "${destination}")"
bundle_name="$(basename "${destination}")"
mkdir -p "${parent_dir}"
stage="$(mktemp -d "${parent_dir}/.${bundle_name}.stage.XXXXXX")"
contents_dir="${stage}/Contents"
executable_dir="${contents_dir}/MacOS"
resources_dir="${contents_dir}/Resources"
mkdir -p "${executable_dir}" "${resources_dir}"

swift_args=(--package-path "${app_dir}" -c release)
if [[ -n "${SWIFTPM_BUILD_DIR:-}" ]]; then
  swift_args+=(--scratch-path "${SWIFTPM_BUILD_DIR}")
fi
swift build "${swift_args[@]}" >/dev/null
bin_dir="$(swift build "${swift_args[@]}" --show-bin-path)"
[[ -x "${bin_dir}/PIWebMac" ]] || fail "Release PIWebMac executable was not produced."
cp "${bin_dir}/PIWebMac" "${executable_dir}/PIWebMac"
chmod +x "${executable_dir}/PIWebMac"
cp "${app_icon}" "${resources_dir}/AppIcon.icns"

cat >"${contents_dir}/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Pi Workbench</string>
  <key>CFBundleExecutable</key>
  <string>PIWebMac</string>
  <key>CFBundleIdentifier</key>
  <string>works.pi.workbench</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleName</key>
  <string>Pi Workbench</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSMultipleInstancesProhibited</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

bundle_config="${resources_dir}/PIWebConfig.plist"
/usr/bin/plutil -create xml1 "${bundle_config}"
/usr/bin/plutil -insert CLIPath -string "${pi_web_cli}" "${bundle_config}"
/usr/bin/plutil -insert CheckoutPath -string "${pi_web_dir}" "${bundle_config}"
/usr/bin/plutil -insert ServerURL -string "${pi_web_url}" "${bundle_config}"
/usr/bin/plutil -lint "${contents_dir}/Info.plist" "${bundle_config}" >/dev/null

status_file="${stage}/status.json"
if ! (cd "${pi_web_dir}" && "${pi_web_cli}" status --json >"${status_file}"); then
  fail "PI WEB lifecycle status preflight failed; the existing app was not changed."
fi
validate_status_json "${status_file}" || fail "PI WEB lifecycle returned an invalid typed status; the existing app was not changed."
rm "${status_file}"
if ! (cd "${pi_web_dir}" && "${pi_web_cli}" install --dev); then
  fail "PI WEB development service installation failed; the existing app was not changed."
fi

mkdir -p "${command_dir}"
command_stage="$(mktemp "${command_dir}/.pi-web-mac.XXXXXX")"
{
  printf '%s\n' '#!/usr/bin/env bash' '' 'set -Eeuo pipefail' ''
  printf 'app_path=%q\n' "${destination}"
  printf '%s\n' 'open_command="${PI_WEB_OPEN:-/usr/bin/open}"' 'exec "${open_command}" "${app_path}"'
} >"${command_stage}"
chmod +x "${command_stage}"
mv -f "${command_stage}" "${command_dir}/pi-web-mac"
command_stage=""

if [[ -e "${destination}" ]]; then
  backup="$(mktemp -d "${parent_dir}/.${bundle_name}.backup.XXXXXX")"
  rmdir "${backup}"
  mv "${destination}" "${backup}"
fi
mv "${stage}" "${destination}"
stage=""
if [[ -n "${backup}" ]]; then
  rm -rf "${backup}"
  backup=""
fi
/usr/bin/touch "${destination}"

printf 'Installed %s\n' "${destination}"
printf 'Installed %s\n' "${command_dir}/pi-web-mac"
printf 'Open the app from Finder, Spotlight, the Dock, or pi-web-mac.\n'
