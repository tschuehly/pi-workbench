#!/usr/bin/env bash
set -Eeuo pipefail
app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT
swiftc \
  "${app_dir}/Sources/PIWebMac/NativeNotifications.swift" \
  "${app_dir}/Scripts/native-notifications.test.swift" \
  -o "${test_dir}/native-notifications-test"
"${test_dir}/native-notifications-test"
