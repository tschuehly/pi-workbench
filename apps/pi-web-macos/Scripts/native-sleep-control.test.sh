#!/usr/bin/env bash
set -Eeuo pipefail
app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT
swiftc \
  "${app_dir}/Sources/PIWebMac/NativeSleepControl.swift" \
  "${app_dir}/Scripts/native-sleep-control.test.swift" \
  -o "${test_dir}/native-sleep-control-test"
"${test_dir}/native-sleep-control-test"
