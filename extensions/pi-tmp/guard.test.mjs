import assert from "node:assert/strict";
import { test } from "node:test";
import piTmpExtension from "./index.ts";
import { blockTmpWrite, warnTmpBash } from "./pitmp.mjs";

test("write and edit into OS temp folders are blocked with a pointer to PI_TMP", () => {
  for (const path of ["/tmp/x.md", "/private/tmp/wt/a.ts", "/var/tmp/y", "/private/var/tmp/z", "@/tmp/q"]) {
    assert.match(blockTmpWrite(path, "/repo"), /Blocked: .*\$PI_TMP/, path);
  }
  assert.match(blockTmpWrite("a.ts", "/private/tmp/wt"), /Blocked/, "relative targets resolve against cwd");
  for (const path of ["/repo/tmp/x", "/Users/me/.pi-workbench/tmp/p/s/x", "/tmpfiles/x", "tmp/x"]) {
    assert.equal(blockTmpWrite(path, "/repo"), undefined, path);
  }
});

test("bash that writes, cds, or adds a worktree under /tmp gets a warning; reads do not", () => {
  for (const command of ["echo hi > /tmp/a", "cmd 2>>/tmp/log", "cd /private/tmp/x && ls", "printf x | tee '/tmp/out'", "mkdir -p /var/tmp/w",
    "git worktree add /private/tmp/wt -b fix main", "git -C ~/repo worktree add -b fix /tmp/wt main", "cp a.txt /tmp/"]) {
    assert.match(warnTmpBash(command), /^Warning: .*\$PI_TMP/, command);
  }
  for (const command of ["cat /tmp/a", "ls /private/tmp", "echo > $PI_TMP/a", "wt switch --create fix", "grep -r tmp/ src"]) {
    assert.equal(warnTmpBash(command), undefined, command);
  }
});

test("any git worktree add points to wt switch --create", () => {
  for (const command of ["git worktree add ../repo.fix -b fix", "git worktree add -b fix .scratch/fix-worktree main"]) {
    assert.match(warnTmpBash(command), /^Warning: create worktrees with `wt switch --create/, command);
  }
  assert.match(warnTmpBash("git worktree add /tmp/wt -b fix"), /\$PI_TMP.*wt switch --create/);
  assert.equal(warnTmpBash("git worktree list"), undefined);
});

test("the extension blocks write/edit tool calls and appends the bash warning without blocking", async () => {
  const handlers = new Map();
  piTmpExtension({ on: (name, handler) => handlers.set(name, handler) });
  const ctx = { cwd: "/repo" };
  assert.equal((await handlers.get("tool_call")({ toolName: "write", input: { path: "/tmp/a.md", content: "" } }, ctx)).block, true);
  assert.equal(await handlers.get("tool_call")({ toolName: "edit", input: { path: "/repo/a.md" } }, ctx), undefined);
  assert.equal(await handlers.get("tool_call")({ toolName: "bash", input: { command: "cd /tmp" } }, ctx), undefined, "bash is never blocked");
  const content = [{ type: "text", text: "ok" }];
  const result = await handlers.get("tool_result")({ toolName: "bash", input: { command: "cd /tmp" }, content }, ctx);
  assert.equal(result.content[0], content[0]);
  assert.match(result.content[1].text, /^Warning:/);
  assert.equal(await handlers.get("tool_result")({ toolName: "bash", input: { command: "ls" }, content }, ctx), undefined);
});
