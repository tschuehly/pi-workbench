#!/usr/bin/env python3
"""Read-only Pi JSONL inventory and text extraction; Python standard library only."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

CHILD_OPENINGS = (
    "Review independently. Do not mutate files.",
    "Investigate only. Do not mutate files.",
    "Implement only the bounded assignment.",
    "Produce a bounded plan or design judgment.",
    "Coordinate this scope (cognitive role:",
)


def timestamp(value):
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, timezone.utc)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def entries(path):
    # Binary LF framing: splitlines() would split Unicode separators inside JSON strings.
    with path.open("rb") as stream:
        for line, raw in enumerate(stream, 1):
            if not raw.strip():
                continue
            try:
                entry = json.loads(raw)
                if not isinstance(entry, dict):
                    raise ValueError("expected an object")
            except (ValueError, UnicodeDecodeError) as error:
                raise ValueError(f"{path}:{line}: {error}") from error
            yield line, entry


def text_content(content):
    if isinstance(content, str):
        return content
    return "\n".join(block.get("text", "") for block in (content or [])
                     if block.get("type") == "text")


def in_window(entry, since, until):
    value = entry.get("timestamp", entry.get("message", {}).get("timestamp"))
    if value is None:
        return since is None and until is None
    date = timestamp(value)
    return (since is None or date >= since) and (until is None or date < until)


def inventory(path, since=None, until=None):
    header, name, opening = {}, "", None
    counts, window_counts = Counter(), Counter()
    first, last, matched = None, None, 0
    for line, entry in entries(path):
        if entry.get("type") == "session":
            header = entry
        if entry.get("type") == "session_info":
            name = entry.get("name", "")
        value = entry.get("timestamp", entry.get("message", {}).get("timestamp"))
        if value is not None:
            date = timestamp(value)
            first = date if first is None else min(first, date)
            last = date if last is None else max(last, date)
        inside = in_window(entry, since, until)
        matched += inside
        message = entry.get("message", {})
        role = message.get("role")
        if role:
            counts[role] += 1
            if inside:
                window_counts[role] += 1
        if role == "user" and opening is None:
            opening = {"line": line, "id": entry.get("id"),
                       "text": text_content(message.get("content"))}
    if not matched:
        return None
    opening_text = (opening or {}).get("text", "")
    child = opening_text.startswith(CHILD_OPENINGS) or name.startswith("workbench-")
    return {
        "path": str(path.resolve()), "id": header.get("id"), "cwd": header.get("cwd"),
        "parentSession": header.get("parentSession"), "name": name,
        "kind": "child_candidate" if child else "conversation_candidate" if opening else "empty",
        "classificationBasis": "name/dispatch-opening heuristic; not proven human authorship",
        "first": first.isoformat() if first else None,
        "last": last.isoformat() if last else None,
        "bytes": path.stat().st_size, "messages": dict(counts),
        "windowMessages": dict(window_counts), "windowEntries": matched,
        "opening": {**opening, "text": opening_text[:1000],
                    "omittedChars": max(0, len(opening_text) - 1000)} if opening else None,
    }


def transcript(path, roles, tools=False, since=None, until=None, match=None, max_chars=None):
    """All recorded branches, append order; not an active-context replay."""
    for line, entry in entries(path):
        if not in_window(entry, since, until):
            continue
        kind = entry.get("type")
        message = entry.get("message", {})
        role = message.get("role")
        text = ""
        if kind == "message":
            if role in roles:
                text = text_content(message.get("content"))
            if tools and role == "assistant":
                calls = [f"[toolCall {b.get('name')}] {json.dumps(b.get('arguments'), ensure_ascii=False)}"
                         for b in message.get("content", [])
                         if isinstance(b, dict) and b.get("type") == "toolCall"]
                text = "\n".join(filter(None, [text, *calls]))
            if tools and role == "toolResult":
                text = f"[toolResult {message.get('toolName')} error={message.get('isError', False)}]\n" + text_content(message.get("content"))
        elif kind in ("compaction", "branch_summary") and "summary" in roles:
            role, text = kind, entry.get("summary", "")
        elif kind == "custom_message" and "custom" in roles:
            role, text = entry.get("customType", "custom"), text_content(entry.get("content"))
        if not text or (match and match.casefold() not in text.casefold()):
            continue
        yield {"line": line, "id": entry.get("id"), "parentId": entry.get("parentId"),
               "timestamp": entry.get("timestamp", message.get("timestamp")), "role": role,
               "text": text if max_chars is None else text[:max_chars],
               "omittedChars": 0 if max_chars is None else max(0, len(text) - max_chars)}


def resolve(root, target):
    path = Path(target).expanduser()
    if path.is_file():
        return path
    # IDs are literal substrings, never glob expressions supplied by a caller.
    matches = [p for p in root.rglob("*.jsonl") if target in p.stem]
    if len(matches) != 1:
        raise ValueError(f"Expected one session matching {target!r}; found {len(matches)}")
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / ".pi/agent/sessions")
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="JSONL inventory, filtered by entry activity, not file dates")
    reading = commands.add_parser("read", help="Text-only history with source entry IDs and line numbers")
    for command in (listing, reading):
        command.add_argument("--since", type=timestamp, help="Inclusive ISO date/time; UTC if no offset")
        command.add_argument("--until", type=timestamp, help="Exclusive ISO date/time; UTC if no offset")
    listing.add_argument("--kind", choices=("child_candidate", "conversation_candidate", "empty"))
    reading.add_argument("session", help="File path or unique filename/ID substring")
    reading.add_argument("--roles", default="user,assistant,custom,summary")
    reading.add_argument("--tools", action="store_true", help="Include tool arguments/results; may contain secrets")
    reading.add_argument("--match", help="Case-insensitive substring filter")
    reading.add_argument("--max-chars", type=int, help="Per-record text cap; omissions are reported")
    reading.add_argument("--format", choices=("jsonl", "text"), default="text")
    args = parser.parse_args()
    if args.since and args.until and args.since >= args.until:
        parser.error("--since must precede --until")
    if args.command == "read" and args.max_chars is not None and args.max_chars < 1:
        parser.error("--max-chars must be positive")
    root = args.root.expanduser()
    if args.command == "list":
        if not root.is_dir():
            parser.error(f"Session root is not a directory: {root}")
        failed = False
        for path in sorted(root.rglob("*.jsonl")):
            try:
                item = inventory(path, args.since, args.until)
                if item and (args.kind is None or item["kind"] == args.kind):
                    print(json.dumps(item, ensure_ascii=False))
            except (OSError, ValueError) as error:
                print(error, file=sys.stderr)
                failed = True
        return int(failed)
    path = resolve(root, args.session)
    for item in transcript(path, set(args.roles.split(",")), args.tools,
                           args.since, args.until, args.match, args.max_chars):
        if args.format == "jsonl":
            print(json.dumps(item, ensure_ascii=False))
        else:
            print(f"\nL{item['line']} [{item['id']}] parent={item['parentId']} {item['timestamp']} {item['role']}\n{item['text']}")
            if item["omittedChars"]:
                print(f"[omitted {item['omittedChars']} characters]")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(0)
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
