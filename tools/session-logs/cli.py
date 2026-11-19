#!/usr/bin/env python3
"""Read-only Pi and PI WEB session inventory and text extraction; standard library only."""
import argparse
from collections import Counter
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

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


@contextmanager
def web_snapshot(path):
    # The live host takes an exclusive lock. Immutable reads of the original would skip its WAL.
    wal = path.with_name(path.name + "-wal")

    def stamp(file):
        stat = file.stat()
        return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns

    def stamps():
        try:
            wal_stamp = stamp(wal)
        except FileNotFoundError:
            wal_stamp = None
        return stamp(path), wal_stamp

    # ponytail: bounded full-file copies; use a host snapshot API if stores outgrow cheap copies.
    with tempfile.TemporaryDirectory(prefix="session-logs-", dir=os.environ.get("PI_TMP")) as directory:
        copy = Path(directory).absolute() / path.name
        copy_wal = copy.with_name(wal.name)
        for _ in range(3):
            before = stamps()
            shutil.copyfile(path, copy)
            copy_wal.unlink(missing_ok=True)
            if before[1] is not None:
                try:
                    shutil.copyfile(wal, copy_wal)
                except FileNotFoundError:
                    continue  # The host closed/checkpointed during capture.
            if stamps() == before:
                break
        else:
            raise ValueError(f"{path}: store changed during snapshot; retry when the chat is quieter")
        try:
            with closing(sqlite3.connect(copy.as_uri() + "?mode=ro", uri=True)) as db:
                if db.execute("SELECT version FROM durable_schema WHERE singleton = 1").fetchone() != (2,):
                    raise ValueError("unsupported PI WEB durable schema (expected version 2)")
                yield db
        except (sqlite3.Error, ValueError) as error:
            raise ValueError(f"{path}: {error}") from error


def web_conversations(db, chat_id):
    # Ownerless rows are the Chat's root and history-navigation branches. Owned rows are
    # separate children, even when a worker was forked from another child's history.
    conversations = {chat_id: ({"id": chat_id}, {})}
    rows = db.execute("SELECT id, owner_conversation_id, owner_task_id, record FROM conversations")
    for cid, owner, task, raw in rows:
        record = json.loads(raw)
        if not isinstance(record, dict) or not isinstance(record.get("parent") or {}, dict):
            raise ValueError(f"invalid conversation record {cid}")
        parent = record.get("parent") or {}
        if owner is None and task is None:
            conversations[chat_id][1][cid] = parent.get("at")
        else:
            child_id = f"{chat_id}:{cid}"
            header = {"id": child_id, "parentSession": owner,
                      "classificationBasis": "PI WEB conversation ownership"}
            conversations[child_id] = (header, {cid: parent.get("at")})
    for key, (header, _) in conversations.items():
        if key != chat_id:
            owner_id = f"{chat_id}:{header['parentSession']}"
            header["parentSession"] = owner_id if owner_id in conversations else chat_id
    return conversations


def web_entries(db, parents):
    if not parents:
        return
    # IDs increase in append order. Each branch starts at its recorded fork point.
    parents = parents.copy()
    placeholders = ",".join("?" for _ in parents)
    for entry_id, cid, raw in db.execute(
            f"SELECT id, conversation_id, record FROM entries WHERE conversation_id IN ({placeholders}) ORDER BY id",
            tuple(parents)):
        record = json.loads(raw)
        if not isinstance(record, dict) or not isinstance(record.get("kind"), str):
            raise ValueError(f"invalid entry record {entry_id}")
        kind = record["kind"]
        model = record.get("model") or [{}]
        if not isinstance(model, list) or not isinstance(model[0], dict):
            raise ValueError(f"invalid model message in entry {entry_id}")
        message = model[0]
        data = record.get("data")
        data = data if isinstance(data, dict) else {}
        parent = parents[cid]
        parents[cid] = entry_id
        entry = {"id": str(entry_id), "parentId": None if parent is None else str(parent),
                 "timestamp": message.get("timestamp"), "type": "metadata"}
        content = message.get("content")
        if kind == "pi.compaction":
            entry.update(type="compaction", summary=text_content(content))
        elif kind in ("pi.user", "workbench.prompt", "pi.assistant", "pi.tool-result"):
            if kind == "workbench.prompt" and isinstance(content, list):
                # As in PI WEB, omit the injected mode prefix and open-questions reminder.
                start = 1 if data.get("workingMode") else 0
                stop = -1 if data.get("askReminder") else None
                message["content"] = content[start:stop]
            entry.update(type="message", message=message)
        elif message and message.get("role") != "system":
            entry.update(type="custom_message", customType=data.get("customType") or kind, content=content)
        yield entry_id, entry


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


def inventory(path, since=None, until=None, match=None, *, records=None, header=None):
    header, name, opening, first_match = header or {}, "", None, None
    counts, window_counts = Counter(), Counter()
    first, last, matched = None, None, 0
    for line, entry in entries(path) if records is None else records:
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
        if role == "user":
            user_text = text_content(message.get("content"))
            if opening is None:
                opening = {"line": line, "id": entry.get("id"), "text": user_text}
            if match is not None and first_match is None and match.casefold() in user_text.casefold():
                first_match = user_text[:160]
    if not matched:
        return None
    opening_text = (opening or {}).get("text", "")
    parent_session = header.get("parentSession") is not None
    child = parent_session or opening_text.startswith(CHILD_OPENINGS) or name.startswith("workbench-")
    return {
        "path": str(path.resolve()), "id": header.get("id"), "cwd": header.get("cwd"),
        "parentSession": header.get("parentSession"), "name": name,
        "kind": "child" if parent_session else "child_candidate" if child else "conversation_candidate" if opening else "empty",
        "classificationBasis": header.get("classificationBasis", "parentSession header") if parent_session else "name/dispatch-opening heuristic; not proven human authorship",
        "match": first_match,
        "first": first.isoformat() if first else None,
        "last": last.isoformat() if last else None,
        "bytes": path.stat().st_size, "messages": dict(counts),
        "windowMessages": dict(window_counts), "windowEntries": matched,
        "opening": {**opening, "text": opening_text[:1000],
                    "omittedChars": max(0, len(opening_text) - 1000)} if opening else None,
    }


def transcript(path, roles, tools=False, since=None, until=None, match=None, max_chars=None, *, records=None):
    """All recorded branches, append order; not an active-context replay."""
    for line, entry in entries(path) if records is None else records:
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


def print_inventory(item, args):
    if item and (args.kind is None or item["kind"] == args.kind) and (args.match is None or item["match"] is not None):
        print(json.dumps(item, ensure_ascii=False))


def print_transcript(path, args, records=None):
    for item in transcript(path, set(args.roles.split(",")), args.tools,
                           args.since, args.until, args.match, args.max_chars, records=records):
        if args.format == "jsonl":
            print(json.dumps(item, ensure_ascii=False))
        else:
            print(f"\nL{item['line']} [{item['id']}] parent={item['parentId']} {item['timestamp']} {item['role']}\n{item['text']}")
            if item["omittedChars"]:
                print(f"[omitted {item['omittedChars']} characters]")


def run_web(root, args):
    stores = sorted(root.glob("*/session.sqlite"))
    if args.command == "read":
        wanted, sep, child = args.session.partition(":")
        matches = [p for p in stores if wanted in p.parent.name]
        exact = [p for p in matches if p.parent.name == wanted]
        matches = exact or matches
        if len(matches) != 1:
            raise ValueError(f"Expected one PI WEB chat matching {wanted!r}; found {len(matches)}")
        path = matches[0]
        chat_id = path.parent.name
        key = chat_id + sep + child
        with web_snapshot(path) as db:
            conversations = web_conversations(db, chat_id)
            if key not in conversations:
                raise ValueError(f"No PI WEB conversation matching {args.session!r}")
            print_transcript(path, args, web_entries(db, conversations[key][1]))
        return 0
    failed = False
    for path in stores:
        try:
            with web_snapshot(path) as db:
                for header, parents in web_conversations(db, path.parent.name).values():
                    item = inventory(path, args.since, args.until, args.match,
                                     records=web_entries(db, parents), header=header)
                    print_inventory(item, args)
        except (OSError, ValueError) as error:
            print(error, file=sys.stderr)
            failed = True
    return int(failed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--root", type=Path, default=Path.home() / ".pi/agent/sessions", help="Pi JSONL archive")
    source.add_argument("--pi-web", action="store_const", dest="pi_web_root",
                        const=Path.home() / ".pi-web-durable/durable", help="Use ~/.pi-web-durable/durable")
    source.add_argument("--pi-web-root", type=Path, metavar="DIR", help="Use PI WEB durable stores in DIR")
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="Inventory, filtered by entry activity, not file dates")
    reading = commands.add_parser("read", help="Text-only history with source entry IDs and line numbers")
    for command in (listing, reading):
        command.add_argument("--since", type=timestamp, help="Inclusive ISO date/time; UTC if no offset")
        command.add_argument("--until", type=timestamp, help="Exclusive ISO date/time; UTC if no offset")
    listing.add_argument("--kind", choices=("child", "child_candidate", "conversation_candidate", "empty"))
    listing.add_argument("--match", help="Keep sessions with a user message containing this case-insensitive substring")
    reading.add_argument("session", help="Pi JSONL path/ID or PI WEB chat ID (optionally :conversation-id)")
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
    if args.pi_web_root is not None:
        root = args.pi_web_root.expanduser()
        if not root.is_dir():
            parser.error(f"PI WEB durable root is not a directory: {root}")
        return run_web(root, args)
    root = args.root.expanduser()
    if args.command == "list":
        if not root.is_dir():
            parser.error(f"Session root is not a directory: {root}")
        failed = False
        for path in sorted(root.rglob("*.jsonl")):
            try:
                # Append-only logs: a file last written before --since holds no entry inside the window.
                if args.since and path.stat().st_mtime < args.since.timestamp():
                    continue
                print_inventory(inventory(path, args.since, args.until, args.match), args)
            except (OSError, ValueError) as error:
                print(error, file=sys.stderr)
                failed = True
        return int(failed)
    print_transcript(resolve(root, args.session), args)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(0)
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
