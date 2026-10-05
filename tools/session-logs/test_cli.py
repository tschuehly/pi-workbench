import json
import os
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
