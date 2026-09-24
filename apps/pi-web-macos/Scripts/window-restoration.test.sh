#!/usr/bin/env bash
set -Eeuo pipefail
app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT
swiftc "${app_dir}/Sources/PIWebMac/WindowRestoration.swift" "${app_dir}/Scripts/window-restoration.test.swift" -o "${test_dir}/window-restoration-test"
"${test_dir}/window-restoration-test"
