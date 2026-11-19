from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

import cli


class SessionLogsTest(unittest.TestCase):
    def test_inventory_and_history(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "example-abc123.jsonl"
            records = [
                {"type": "session", "id": "abc123", "cwd": "/project", "timestamp": "2026-09-01T00:00:00Z"},
                {"type": "message", "id": "old", "timestamp": "2026-09-01T00:00:01Z", "message": {"role": "user", "content": "Start"}},
                {"type": "message", "id": "u", "parentId": "old", "timestamp": "2026-09-14T00:00:00Z", "message": {"role": "user", "content": [{"type": "text", "text": "Status?\u2028Workstream"}, {"type": "image", "data": "IMAGE_SECRET"}]}},
                {"type": "message", "id": "a", "parentId": "u", "timestamp": "2026-09-14T00:00:01Z", "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "THINKING_SECRET"}, {"type": "text", "text": "Checking"}, {"type": "toolCall", "name": "bash", "arguments": {"command": "workstreams list"}}]}},
                {"type": "message", "id": "r", "parentId": "a", "timestamp": "2026-09-14T00:00:02Z", "message": {"role": "toolResult", "toolName": "bash", "content": [{"type": "text", "text": "ws-example"}]}},
                {"type": "compaction", "id": "c", "timestamp": "2026-09-14T00:00:03Z", "summary": "Recorded progress"},
                {"type": "message", "id": "branch", "parentId": "old", "timestamp": "2026-09-15T00:00:00Z", "message": {"role": "user", "content": "Another branch"}},
            ]
            path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n")
            before = path.read_bytes()
            since, until = cli.timestamp("2026-09-14"), cli.timestamp("2026-09-15")
            info = cli.inventory(path, since, until)
            self.assertEqual(info["kind"], "conversation_candidate")
            matched = cli.inventory(path, match="WORKSTREAM")
            self.assertEqual(matched["match"], "Status?\u2028Workstream")
            self.assertIsNone(cli.inventory(path, match="absent")["match"])
            self.assertEqual(info["windowMessages"]["user"], 1)
            self.assertEqual(info["opening"]["id"], "old")
            self.assertEqual(info["windowEntries"], 4)
            self.assertIsNone(cli.inventory(path, cli.timestamp("2027-01-01")))
            rows = list(cli.transcript(path, {"user", "assistant", "summary"}, since=since, until=until))
            self.assertEqual([r["id"] for r in rows], ["u", "a", "c"])
            self.assertEqual(rows[0]["line"], 3)
            self.assertNotIn("SECRET", json.dumps(rows))
            capped = list(cli.transcript(path, {"user"}, match="workstream", max_chars=3))
            self.assertEqual(capped[0]["text"], "Sta")
            self.assertGreater(capped[0]["omittedChars"], 0)
            tools = list(cli.transcript(path, set(), tools=True))
            self.assertEqual([r["id"] for r in tools], ["a", "r"])
            self.assertEqual(cli.resolve(Path(directory), "abc123"), path)
            result = subprocess.run([sys.executable, cli.__file__, "--root", directory, "list", "--since", "2026-09-14", "--until", "2026-09-15"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)["id"], "abc123")
            stale = Path(directory) / "stale.jsonl"
            stale.write_text('{"incomplete":')  # would fail if parsed
            os.utime(stale, (0, 0))
            result = subprocess.run([sys.executable, cli.__file__, "--root", directory, "list", "--since", "2026-09-14"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            stale.unlink()
            result = subprocess.run([sys.executable, cli.__file__, "--root", directory, "list", "--match", "workstream"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            listing = json.loads(result.stdout)
            self.assertEqual(listing["match"], "Status?\u2028Workstream")
            self.assertLessEqual(len(listing["match"]), 160)
            self.assertEqual(path.read_bytes(), before)
            child = Path(directory) / "child.jsonl"
            child.write_text(json.dumps({"type": "message", "message": {"role": "user", "content": cli.CHILD_OPENINGS[0]}}) + "\n")
            self.assertEqual(cli.inventory(child)["kind"], "child_candidate")
            child.write_text(json.dumps({"type": "session", "parentSession": "parent-id"}) + "\n")
            info = cli.inventory(child)
            self.assertEqual(info["kind"], "child")
            self.assertEqual(info["classificationBasis"], "parentSession header")
            with self.assertRaisesRegex(ValueError, "found 2"):
                cli.resolve(Path(directory), "")
            child.write_text('{"incomplete":')
            with self.assertRaisesRegex(ValueError, "child.jsonl:1"):
                list(cli.entries(child))
            result = subprocess.run([sys.executable, cli.__file__, "--root", directory, "list"], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("child.jsonl:1", result.stderr)


class PiWebLogsTest(unittest.TestCase):
    def test_list_and_read_live_wal(self):
        chat_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        child_id = f"{chat_id}:4"
        time = 1789344000000  # 2026-09-14T00:00:00Z
        with tempfile.TemporaryDirectory(dir=os.environ.get("PI_TMP")) as directory:
            path = Path(directory) / chat_id / "session.sqlite"
            path.parent.mkdir()
            with closing(sqlite3.connect(path)) as writer:
                writer.executescript("""
                    PRAGMA locking_mode = EXCLUSIVE;
                    PRAGMA journal_mode = WAL;
                    PRAGMA wal_autocheckpoint = 0;
                    CREATE TABLE durable_schema(singleton INTEGER PRIMARY KEY, version INTEGER);
                    INSERT INTO durable_schema VALUES (1, 2);
                    CREATE TABLE conversations(id INTEGER PRIMARY KEY, owner_conversation_id INTEGER,
                                               owner_task_id INTEGER, record TEXT);
                    INSERT INTO conversations VALUES (1, NULL, NULL, '{"id":1}');
                    INSERT INTO conversations VALUES (3, NULL, NULL, '{"id":3,"parent":{"conversationId":1,"at":10}}');
                    INSERT INTO conversations VALUES (4, 3, 9, '{"id":4}');
                    INSERT INTO conversations VALUES (5, 4, 9, '{"id":5,"parent":{"conversationId":4,"at":15}}');
                    CREATE TABLE entries(id INTEGER PRIMARY KEY, conversation_id INTEGER, head INTEGER,
                                         commit_seq INTEGER, record TEXT);
                """)

                def append(id, conversation, kind, role, content, *, head=None, data=None, **message):
                    record = {"id": id, "conversationId": conversation, "kind": kind, "data": data,
                              "model": [dict(role=role, content=content, timestamp=time + id, **message)]}
                    writer.execute("INSERT INTO entries VALUES (?, ?, ?, ?, ?)",
                                   (id, conversation, head, id, json.dumps(record)))

                append(10, 1, "pi.user", "user", "Start")
                append(11, 1, "pi.assistant", "assistant", [
                    {"type": "thinking", "thinking": "THINKING_SENTINEL"},
                    {"type": "text", "text": "Reply"},
                    {"type": "toolCall", "name": "check", "arguments": {"ok": True}},
                ])
                append(12, 1, "pi.tool-result", "toolResult", "Tool result", toolName="check")
                append(13, 1, "pi.system", "system", "SYSTEM_SENTINEL")
                append(14, 1, "pi.compaction", "user", "Earlier turns summarized", head=10)
                append(15, 4, "pi.user", "user", "Child task")
                append(16, 5, "pi.user", "user", "Nested task")
                append(17, 1, "workbench.child-completion", "user", "Child finished")
                writer.commit()
                writer.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchall()
                append(18, 3, "workbench.prompt", "user", [
                    {"type": "text", "text": "MODE_SENTINEL"},
                    {"type": "text", "text": "Branch only in WAL"},
                    {"type": "image", "data": "IMAGE_SENTINEL"},
                    {"type": "text", "text": "REMINDER_SENTINEL"},
                ], data={"workingMode": {"selection": {}}, "askReminder": True})
                writer.commit()
                self.assertGreater(path.with_name("session.sqlite-wal").stat().st_size, 0)
                before = {file.name: file.read_bytes() for file in path.parent.iterdir()}

                def run(*args, code=0):
                    result = subprocess.run([sys.executable, cli.__file__, "--pi-web-root", directory, *args],
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode, code, result.stderr)
                    return result

                def records(*args):
                    return [json.loads(line) for line in run(*args).stdout.splitlines()]

                lead, = records("list", "--match", "ONLY IN WAL", "--since", "2026-09-14")
                self.assertEqual((lead["id"], lead["kind"], lead["match"], lead["messages"]["user"]),
                                 (chat_id, "conversation_candidate", "Branch only in WAL", 2))
                children = {item["id"]: item for item in records("list", "--kind", "child")}
                self.assertEqual(children[child_id]["classificationBasis"], "PI WEB conversation ownership")
                self.assertEqual({key: item["parentSession"] for key, item in children.items()},
                                 {child_id: chat_id, f"{chat_id}:5": child_id})
                rows = records("read", chat_id, "--format", "jsonl")
                self.assertEqual([(r["id"], r["role"]) for r in rows],
                                 [("10", "user"), ("11", "assistant"), ("14", "compaction"),
                                  ("17", "workbench.child-completion"), ("18", "user")])
                self.assertNotIn("SENTINEL", json.dumps(rows))
                self.assertEqual(rows[-1], {"line": 18, "id": "18", "parentId": "10", "timestamp": time + 18,
                                            "role": "user", "text": "Branch only in WAL", "omittedChars": 0})
                users = records("read", chat_id[:8], "--roles", "user", "--format", "jsonl")
                self.assertEqual([r["text"] for r in users], ["Start", "Branch only in WAL"])
                child, = records("read", child_id, "--roles", "user", "--format", "jsonl")
                self.assertEqual(child["text"], "Child task")
                nested, = records("read", f"{chat_id}:5", "--roles", "user", "--format", "jsonl")
                self.assertEqual((nested["text"], nested["parentId"]), ("Nested task", "15"))
                tool_rows = records("read", chat_id, "--tools", "--roles", "", "--format", "jsonl")
                self.assertEqual([r["id"] for r in tool_rows], ["11", "12"])
                self.assertEqual({file.name: file.read_bytes() for file in path.parent.iterdir()}, before)

                bad = Path(directory) / "bad" / "session.sqlite"
                bad.parent.mkdir()
                bad.write_text("not SQLite")
                result = run("list", "--match", "only in WAL", code=1)
                self.assertEqual(json.loads(result.stdout)["id"], chat_id)
                self.assertIn(str(bad), result.stderr)


if __name__ == "__main__":
    unittest.main()
