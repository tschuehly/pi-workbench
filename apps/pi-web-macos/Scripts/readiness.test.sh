#!/usr/bin/env bash
set -Eeuo pipefail
app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "${test_dir}"' EXIT
swiftc "${app_dir}/Sources/PIWebMac/PIWebReadiness.swift" "${app_dir}/Scripts/readiness.test.swift" -o "${test_dir}/readiness-test"
"${test_dir}/readiness-test"
