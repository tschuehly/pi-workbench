#!/usr/bin/env bash
# atelier — agent-side singleton long-poll launcher for the feedback loop.
# Watches /api/poll for events (sent comments, decisions, custom events) and surfaces
# the ones a human originated so the agent can react without the human leaving the browser.
# Events address a Region by its key (`onboarding/provider`), which is what the agent passes
# back to /api/reply, /api/propose and /api/update.
#
# Three modes:
#   --stream (PRIMARY agent path — run under the harness Monitor tool, persistent):
#           an infinite loop long-polling /api/poll. Each round persists the returned
#           cursor ALWAYS (even when every event was filtered), then prints ONE compact
#           line per human-origin event; agent-origin echoes (your own replies/status/
#           proposals/non-rejected states) print NOTHING. Launched once at setup via
#           Monitor — each stdout line becomes an agent notification. It NEVER exits on
#           events, so there is no re-arm choreography: nothing to forget, nothing to detach.
#           Liveness: after 3 consecutive connection failures it prints one `SERVER-DOWN`
#           line (silence is not success), backs off, and prints one `SERVER-UP` line on
#           recovery — never spamming while a state persists.
#   --once  (FALLBACK for harnesses WITHOUT a Monitor tool, e.g. Codex): same human-origin
#           filter as --stream; long-poll until at least one human-origin event is printed,
#           then EXIT 0 so the harness's background-task notification re-invokes the agent.
#           Agent-echo events advance (and persist) the cursor SILENTLY without exiting.
#           Launch in the background; on the completion notification, act, then re-arm.
#   --tail  (human "live tail"): the classic infinite loop for a human watching a terminal.
#           Prints ALL event kinds. Never exits. Not an agent-wake path.
#
#   tools/poll.sh --stream           # primary: launch once via the Monitor tool
#   tools/poll.sh --once             # no-Monitor fallback (exit-to-wake)
#   tools/poll.sh --tail             # human live tail
#   BASE_URL=http://127.0.0.1:4747 CURSOR=0 tools/poll.sh --stream
#
# Cursor: without an explicit CURSOR env, resumes from the state file
# (CURSOR_FILE, default derived from the exact URL). Each round persists the new cursor.
#
# Human-origin wake kinds (override with WAKE_KINDS env, csv): sent, decision, explain-request,
# comment-rejected, and canonical command. Everything else is filtered out of
# --stream / --once, and two of those exclusions are load-bearing:
#   * `ready` is the AGENT telling the page to swap in new content. Waking on it would make the
#     agent answer its own announcement, forever.
#   * `update` is the agent's own durable message to the human, and `explanation` its own answer.
# The rest (reply, proposal, comment-state, ack, update-dismissed) are echoes or human
# bookkeeping that needs no work. The filter runs on the raw JSON in BOTH the jq and the python3
# parser, identically.
#
# Keep exactly one poll process at a time through the monitor reuse key; preflight rejects
# duplicates. This script never kills processes by command-line pattern.
set -u

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
PORT="${PORT:-}"
BASE_URL="${BASE_URL:-${ATELIER_URL:-}}"
if [ -z "$BASE_URL" ]; then
  if [ -n "$PORT" ]; then BASE_URL="http://127.0.0.1:${PORT}"
  else echo 'atelier poll: set BASE_URL (preferred) or PORT; refusing to guess a surface' >&2; exit 2
  fi
fi
BASE_URL="${BASE_URL%/}"
case "$BASE_URL" in http://*|https://*) ;; *) echo 'atelier poll: BASE_URL must be http(s)' >&2; exit 2 ;; esac
URL_KEY="$(printf '%s' "$BASE_URL" | sed 's#[^A-Za-z0-9._-]#-#g')"

# Human-origin wake kinds. Rejection uses one atomic message-bearing event.
WAKE_KINDS="${WAKE_KINDS:-sent,decision,explain-request,comment-rejected,command}"

# --- mode: --stream | --once | --tail (no-arg default is --once for backward compat;
#     the PRIMARY agent path is --stream, launched EXPLICITLY once via the Monitor tool) ---
MODE="once"
for arg in "$@"; do
  case "$arg" in
    --stream) MODE="stream" ;;
    --once) MODE="once" ;;
    --tail|--loop) MODE="tail" ;;
    *) echo "unknown arg: $arg (use --stream | --once | --tail)" >&2; exit 2 ;;
  esac
done

# --- cursor: explicit CURSOR env wins; else resume from the persisted state file ---
CURSOR_FILE="${CURSOR_FILE:-.review/poll-${URL_KEY}.cursor}"
if [ -n "${CURSOR:-}" ]; then
  CURSOR="$CURSOR"
elif [ -f "$CURSOR_FILE" ]; then
  CURSOR="$(cat "$CURSOR_FILE" 2>/dev/null || echo 0)"
  [ -z "$CURSOR" ] && CURSOR=0
else
  CURSOR=0
fi

persist_cursor() {
  # atomically record the cursor so the next launch resumes with no gap
  [ -z "${1:-}" ] && return 0
  mkdir -p "$(dirname "$CURSOR_FILE")" 2>/dev/null || true
  printf '%s' "$1" > "${CURSOR_FILE}.tmp" 2>/dev/null && mv -f "${CURSOR_FILE}.tmp" "$CURSOR_FILE" 2>/dev/null || true
}

echo "▶ atelier poll started (${MODE}) — ${BASE_URL}/api/poll (cursor=${CURSOR})"
echo "  script: ${SELF}"
[ "$MODE" != "tail" ] && echo "  wake kinds: ${WAKE_KINDS}"

# --- parser: prefer jq, fall back to python3 ---
have_jq=0
command -v jq >/dev/null 2>&1 && have_jq=1

# Is $1 a valid JSON document? A connection failure yields empty/garbage; the server's
# ~25s idle timeout returns valid JSON {cursor, events:[]} — that is NOT a failure.
is_json() {
  [ -z "${1:-}" ] && return 1
  if [ "$have_jq" = "1" ]; then
    printf '%s' "$1" | jq -e . >/dev/null 2>&1
  else
    printf '%s' "$1" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1
  fi
}

# --- full parser (ALL kinds) — used by --tail only ---
# Both parsers emit one line per event with fields joined by the ASCII unit separator
# \x1f. Unlike tab, bash does NOT collapse consecutive non-whitespace IFS delimiters, so
# empty fields keep their position. Embedded newlines/US in free text are flattened so they
# can't break the framing. Fields:
#   seq / kind / region / id / ts / sev / tags(csv) / choice / custom / text
parse_events_jq() {
  echo "$1" | jq -r '
    .events[]? |
    [
      (.seq // "" | tostring),
      (.kind // ""),
      (.region // ""),
      (.id // ""),
      (.ts // ""),
      (.comment.sev // ""),
      ((.comment.tags // []) | join(",")),
      (if .choiceIndex == null then "" else (.choiceIndex | tostring) end),
      (.custom // ""),
      (.comment.text // .msg // .text // .answer // .action // .status // "")
    ] | map(tostring | gsub("\n"; " ") | gsub(""; " ")) | join("")
  '
}

parse_events_py() {
  python3 -c '
import json, sys
try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
for ev in data.get("events") or []:
    c = ev.get("comment") or {}
    ci = ev.get("choiceIndex")
    row = [
        str(ev.get("seq", "")),
        str(ev.get("kind", "")),
        str(ev.get("region", "") or ""),
        str(ev.get("id", "") or ""),
        str(ev.get("ts", "")),
        str(c.get("sev", "") or ""),
        ",".join(c.get("tags") or []),
        "" if ci is None else str(ci),
        str(ev.get("custom", "") or ""),
        str(c.get("text", ev.get("msg", ev.get("text", ev.get("answer", ev.get("action", ev.get("status", "")))))) or ""),
    ]
    print("\x1f".join(f.replace("\x1f", " ").replace("\n", " ") for f in row))
' "$1"
}

# --- wake parser (human-origin kinds ONLY, compact) — used by --stream / --once ---
# The select() runs on the RAW event JSON: kind must be in WAKE_KINDS. Fields (US-framed):
#   seq / kind / region / id / detail
parse_wake_jq() {
  echo "$1" | jq -r --arg wk "$WAKE_KINDS" '
    ($wk | split(",")) as $kinds |
    .events[]? |
    select((.kind // "") as $k | ($kinds | index($k)) != null) |
    [
      (.seq // "" | tostring),
      (.kind // ""),
      (.region // ""),
      (.id // ""),
      (if (.comment.text // "") != "" then .comment.text
       elif (.text // "") != "" then .text
       elif (.msg // "") != "" then .msg
       elif (.answer // "") != "" then .answer
       elif (.custom // "") != "" then .custom
       elif (.action // "") != "" then .action
       elif (.choiceIndex != null) then ("Option " + (.choiceIndex | tostring))
       else (.status // "") end)
    ] | map(tostring | gsub("[\n\t]"; " ") | gsub(""; " ")) | join("")
  '
}

parse_wake_py() {
  WAKE_KINDS="$WAKE_KINDS" python3 -c '
import json, sys, os
wk = set(k for k in os.environ.get("WAKE_KINDS", "").split(",") if k)
try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
for ev in data.get("events") or []:
    kind = ev.get("kind", "") or ""
    if kind not in wk:
        continue
    c = ev.get("comment") or {}
    detail = c.get("text") or ev.get("text") or ev.get("msg") or ev.get("answer") or ev.get("custom") or ev.get("action") or ""
    if not detail and ev.get("choiceIndex") is not None:
        detail = "Option " + str(ev.get("choiceIndex"))
    if not detail:
        detail = ev.get("status", "") or ""
    row = [
        str(ev.get("seq", "")),
        kind,
        str(ev.get("region", "") or ""),
        str(ev.get("id", "") or ""),
        str(detail),
    ]
    print("\x1f".join(f.replace("\x1f", " ").replace("\n", " ").replace("\t", " ") for f in row))
' "$1"
}

get_cursor_jq() { echo "$1" | jq -r '.cursor // empty'; }
get_cursor_py() {
  python3 -c '
import json, sys
try:
    print(json.loads(sys.argv[1]).get("cursor",""))
except Exception:
    pass
' "$1"
}

print_events() {
  # $1 = full parsed events (US-framed). --tail only. Returns 0 if any printed, else 1.
  local events="$1"
  [ -z "$events" ] && return 1
  while IFS=$'\x1f' read -r seq kind region id ts sev tags choice custom text; do
    [ -z "$kind" ] && continue
    kind_upper="$(printf '%s' "$kind" | tr '[:lower:]' '[:upper:]')"
    echo "──────────────────────────────────────────────"
    case "$kind" in
      sent)
        echo "SENT · ${region}  (id ${id}, seq ${seq})"
        echo "  time:     ${ts}"
        [ -n "$sev" ] && echo "  severity: ${sev}"
        [ -n "$tags" ] && echo "  tags:     ${tags}"
        echo "  comment:  ${text:-—}"
        ;;
      decision)
        echo "DECISION · ${region}  (seq ${seq})  ${ts}"
        [ -n "$choice" ] && echo "  choice:   option ${choice}"
        [ -n "$custom" ] && echo "  custom:   ${custom}"
        ;;
      *)
        echo "${kind_upper} · ${region:-—}  (id ${id:-—}, seq ${seq})  ${ts}"
        [ -n "$text" ] && echo "  ${text}"
        ;;
    esac
  done <<< "$events"
  return 0
}

print_wake() {
  # $1 = wake events (US-framed, one per line). One COMPACT line per event.
  # Returns 0 if at least one line printed, else 1.
  local events="$1"
  [ -z "$events" ] && return 1
  local printed=1
  while IFS=$'\x1f' read -r seq kind region id detail; do
    [ -z "$kind" ] && continue
    local label snippet idshow
    label="$(printf '%s' "$kind" | tr '[:lower:]' '[:upper:]')"
    snippet="${detail:0:200}"
    idshow="${id:-—}"; [ -z "$idshow" ] && idshow="—"
    if [ -n "$snippet" ]; then
      echo "${label} · ${region:-—} (id ${idshow}, seq ${seq}) — ${snippet}"
    else
      echo "${label} · ${region:-—} (id ${idshow}, seq ${seq})"
    fi
    printed=0
  done <<< "$events"
  return $printed
}

# One long-poll for the wake path. Sets FETCH_OK / NEW_CURSOR / WAKE_LINES.
fetch_wake() {
  FETCH_OK=0; NEW_CURSOR=""; WAKE_LINES=""
  local resp
  resp="$(curl -s --max-time 30 "${BASE_URL}/api/poll?cursor=${CURSOR}")"
  is_json "$resp" || return 0
  FETCH_OK=1
  if [ "$have_jq" = "1" ]; then
    NEW_CURSOR="$(get_cursor_jq "$resp")"
    WAKE_LINES="$(parse_wake_jq "$resp")"
  else
    NEW_CURSOR="$(get_cursor_py "$resp")"
    WAKE_LINES="$(parse_wake_py "$resp")"
  fi
}

# One long-poll round for --tail (full parser + multiline print). Persists the cursor.
poll_round_tail() {
  ROUND_HAD_EVENTS=0
  local resp new_cursor events
  resp="$(curl -s --max-time 30 "${BASE_URL}/api/poll?cursor=${CURSOR}")"
  [ -z "$resp" ] && return 0
  if [ "$have_jq" = "1" ]; then
    new_cursor="$(get_cursor_jq "$resp")"
    events="$(parse_events_jq "$resp")"
  else
    new_cursor="$(get_cursor_py "$resp")"
    events="$(parse_events_py "$resp")"
  fi
  if print_events "$events"; then ROUND_HAD_EVENTS=1; fi
  if [ -n "$new_cursor" ]; then CURSOR="$new_cursor"; persist_cursor "$CURSOR"; fi
}

stream_loop() {
  # PRIMARY: never exits. One compact line per human event; persist cursor every round.
  # Liveness: 3 consecutive connection failures → one SERVER-DOWN line; recovery → one
  # SERVER-UP line. Max one line per state transition.
  local fails=0 down=0
  while true; do
    fetch_wake
    if [ "$FETCH_OK" = "1" ]; then
      if [ "$down" = "1" ]; then
        echo "SERVER-UP · connected (cursor=${NEW_CURSOR:-$CURSOR})"
        down=0
      fi
      fails=0
      print_wake "$WAKE_LINES" || true
      if [ -n "$NEW_CURSOR" ]; then CURSOR="$NEW_CURSOR"; persist_cursor "$CURSOR"; fi
    else
      fails=$((fails + 1))
      if [ "$fails" -ge 3 ] && [ "$down" = "0" ]; then
        echo "SERVER-DOWN · ${BASE_URL} unreachable"
        down=1
      fi
      sleep 5
    fi
  done
}

once_loop() {
  # FALLBACK (no Monitor): exit 0 on the first human-origin event; agent echoes advance the
  # cursor silently and keep polling.
  while true; do
    fetch_wake
    if [ "$FETCH_OK" = "1" ]; then
      if [ -n "$NEW_CURSOR" ]; then CURSOR="$NEW_CURSOR"; persist_cursor "$CURSOR"; fi
      if print_wake "$WAKE_LINES"; then
        echo "▶ human event(s) received — exiting to wake the agent (cursor=${CURSOR}). Re-arm to continue."
        exit 0
      fi
    else
      sleep 1
    fi
  done
}

tail_loop() {
  # Human live tail: all kinds, forever.
  while true; do
    poll_round_tail
    [ "$ROUND_HAD_EVENTS" = "0" ] && sleep 1
  done
}

case "$MODE" in
  stream) stream_loop ;;
  once)   once_loop ;;
  tail)   tail_loop ;;
esac
