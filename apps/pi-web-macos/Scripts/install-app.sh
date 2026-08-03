#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
boot_dev="${script_dir}/boot-dev.sh"
app_icon="${script_dir}/../Resources/AppIcon.icns"
destination="${1:-${HOME}/Applications/Pi Workbench.app}"

if [[ "${destination}" != *.app ]]; then
  echo "Destination must be a .app bundle: ${destination}" >&2
  exit 2
fi

contents_dir="${destination}/Contents"
executable_dir="${contents_dir}/MacOS"
resources_dir="${contents_dir}/Resources"
launcher="${executable_dir}/PiWorkbenchLauncher"

rm -rf "${destination}"
mkdir -p "${executable_dir}" "${resources_dir}"
cp "${app_icon}" "${resources_dir}/AppIcon.icns"

cat >"${contents_dir}/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Pi Workbench</string>
  <key>CFBundleExecutable</key>
  <string>PiWorkbenchLauncher</string>
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
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

{
  cat <<'LAUNCHER_HEADER'
#!/usr/bin/env bash

set -u

# Finder launches apps with a minimal PATH, so include standard Homebrew locations.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:${HOME}/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
log_dir="${HOME}/Library/Logs/PiWorkbench"
log_file="${log_dir}/launcher.log"
export PI_WEB_ICON="$(cd "$(dirname "$0")/../Resources" && pwd)/AppIcon.icns"
mkdir -p "${log_dir}"
LAUNCHER_HEADER
  printf 'boot_dev=%q\n' "${boot_dev}"
  cat <<'LAUNCHER_BODY'

printf '\n[%s] Starting Pi Workbench\n' "$(date '+%Y-%m-%d %H:%M:%S')" >>"${log_file}"
"${boot_dev}" >>"${log_file}" 2>&1
status=$?

if (( status != 0 )); then
  /usr/bin/osascript - "${log_file}" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  display alert "Pi Workbench could not start" message "Open " & item 1 of argv & " for details." as critical
end run
APPLESCRIPT
fi

exit "${status}"
LAUNCHER_BODY
} >"${launcher}"

chmod +x "${launcher}"
/usr/bin/plutil -lint "${contents_dir}/Info.plist" >/dev/null

# Refresh Launch Services metadata when replacing an existing bundle.
/usr/bin/touch "${destination}"

echo "Installed ${destination}"
echo "Open it from Finder, Spotlight, or the Dock."
