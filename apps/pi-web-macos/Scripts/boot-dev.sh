#!/usr/bin/env bash

set -Eeuo pipefail
set -m

source_path="${BASH_SOURCE[0]}"
while [[ -L "${source_path}" ]]; do
  source_dir="$(cd "$(dirname "${source_path}")" && pwd)"
  source_path="$(readlink "${source_path}")"
  [[ "${source_path}" = /* ]] || source_path="${source_dir}/${source_path}"
done

script_dir="$(cd "$(dirname "${source_path}")" && pwd)"
app_dir="$(cd "${script_dir}/.." && pwd)"
workbench_dir="$(cd "${app_dir}/../.." && pwd)"
pi_web_dir="${PI_WEB_DIR:-$(cd "${workbench_dir}/.." && pwd)/pi-web}"
pi_web_url="${PI_WEB_URL:-http://127.0.0.1:8505}"
server_pid=""
check_only=false
health_url="${pi_web_url%/}/api/machines/local/health"

if [[ "${1:-}" == "--check" ]]; then
  check_only=true
elif [[ $# -gt 0 ]]; then
  echo "Usage: pi-web-mac [--check]" >&2
  exit 2
fi

fail() {
  echo "PI WEB launcher: $*" >&2
  exit 1
}

frontend_is_ready() {
  curl --fail --silent --show-error --max-time 1 "${pi_web_url}" >/dev/null 2>&1
}

stack_is_ready() {
  frontend_is_ready || return 1
  curl --fail --silent --show-error --max-time 2 "${health_url}" 2>/dev/null \
    | tr -d '[:space:]' \
    | grep -q '"ok":true'
}

stop_server() {
  if [[ -n "${server_pid}" ]] && kill -0 "${server_pid}" 2>/dev/null; then
    echo "Stopping the PI WEB development server..."
    kill -TERM -- "-${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
  fi
}

trap stop_server EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ -d "${pi_web_dir}" ]] || fail "PI WEB checkout not found at ${pi_web_dir}. Set PI_WEB_DIR to its location."
[[ -f "${pi_web_dir}/package.json" ]] || fail "${pi_web_dir} does not contain a package.json."
command -v node >/dev/null 2>&1 || fail "Node.js is required. PI WEB currently requires Node.js 22.19.0 or newer."
command -v npm >/dev/null 2>&1 || fail "npm is required."
command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v swift >/dev/null 2>&1 || fail "The Swift toolchain is required. Install Xcode Command Line Tools."
[[ -d "${pi_web_dir}/node_modules" ]] || fail "PI WEB dependencies are missing. Run 'npm install' in ${pi_web_dir}."

if [[ "${check_only}" == true ]]; then
  echo "PI WEB checkout: ${pi_web_dir}"
  echo "Development UI: ${pi_web_url}"
  echo "Stack health: ${health_url}"
  echo "macOS wrapper: ${app_dir}"
  echo "All launcher requirements are available."
  exit 0
fi

if stack_is_ready; then
  echo "Using the complete PI WEB development stack already running at ${pi_web_url}"
elif frontend_is_ready; then
  echo "Waiting for the existing PI WEB development stack to become healthy"
  for _ in {1..60}; do
    stack_is_ready && break
    sleep 1
  done
  stack_is_ready || fail "A partial PI WEB stack is using ${pi_web_url}, but ${health_url} did not become healthy. Stop that stack and run pi-web-mac again."
else
  echo "Starting PI WEB from ${pi_web_dir}"
  (
    cd "${pi_web_dir}"
    exec npm run dev
  ) &
  server_pid=$!

  echo "Waiting for ${pi_web_url}"
  for _ in {1..60}; do
    if stack_is_ready; then
      break
    fi
    if ! kill -0 "${server_pid}" 2>/dev/null; then
      wait "${server_pid}" || true
      fail "The PI WEB development server exited before becoming ready."
    fi
    sleep 1
  done

  stack_is_ready || fail "PI WEB did not become healthy at ${health_url} within 60 seconds."
fi

echo "Launching the macOS wrapper"
cd "${app_dir}"
PI_WEB_URL="${pi_web_url}" swift run PIWebMac
