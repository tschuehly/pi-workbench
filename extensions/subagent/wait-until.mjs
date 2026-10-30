#!/usr/bin/env node
// Block until the first condition holds, then print one line about it. Silent while waiting, so a
// child that has only foreground bash waits in one tool call instead of sleep or tail -f turns.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { parseArgs } from "node:util";

const USAGE = `usage: wait-until [--timeout SECONDS] [--every SECONDS] CONDITION...
  --file PATH [--match REGEX]  PATH exists; with --match, a line of it matches REGEX
  --pid PID                    process PID has exited
  --cmd 'SHELL'                SHELL exits 0 (rerun every --every seconds)
  --url URL                    URL answers 2xx
Returns when the first condition holds: exit 0. At --timeout (default 600): exit 124. Bad arguments: exit 2.`;

function fail(message) { console.error(`wait-until: ${message}\n${USAGE}`); process.exit(2); }

let values;
try {
  ({ values } = parseArgs({ options: {
    file: { type: "string" }, match: { type: "string" }, pid: { type: "string" }, cmd: { type: "string" }, url: { type: "string" },
    timeout: { type: "string", default: "600" }, every: { type: "string", default: "5" }, help: { type: "boolean" },
  } }));
} catch (error) { fail(error.message); }
if (values.help) { console.log(USAGE); process.exit(0); }
const seconds = (name) => { const n = Number(values[name]); if (!(n > 0)) fail(`--${name} must be a positive number of seconds`); return n; };
const timeout = seconds("timeout");
const every = seconds("every");
const started = Date.now();
const deadline = started + timeout * 1000;
const tail = (text, n = 20) => text.trimEnd().split("\n").slice(-n).join("\n");
const probes = new Set();

const conditions = [];
if (values.match !== undefined && values.file === undefined) fail("--match needs --file");
if (values.file !== undefined) conditions.push(fileCondition(values.file, values.match));
if (values.pid !== undefined) {
  const pid = Number(values.pid);
  if (!Number.isInteger(pid) || pid <= 0) fail("--pid must be a process id");
  conditions.push({
    check: () => { try { process.kill(pid, 0); return null; } catch (error) { return error.code === "ESRCH" ? `pid ${pid} exited` : null; } },
    pending: () => `pid ${pid} still running`,
  });
}
if (values.cmd !== undefined) conditions.push(commandCondition(values.cmd));
if (values.url !== undefined) conditions.push(urlCondition(values.url));
if (conditions.length === 0) fail("give at least one of --file, --pid, --cmd, --url");

function fileCondition(file, match) {
  let regex;
  if (match !== undefined) { try { regex = new RegExp(match); } catch (error) { fail(`--match: ${error.message}`); } }
  // Read only what was appended since the last poll. A replaced, shrunk, or rewritten file (the bytes
  // just before the offset changed) starts over.
  let offset = 0, inode, seen = Buffer.alloc(0), partial = "", decoder = new StringDecoder("utf8"), last = "";
  const reset = (ino) => { inode = ino; offset = 0; seen = Buffer.alloc(0); partial = ""; decoder = new StringDecoder("utf8"); };
  return {
    check() {
      let stat;
      try { stat = statSync(file); } catch { return null; }
      if (!regex) return `file ${file} exists`;
      if (!stat.isFile()) { last = "not a regular file"; return null; } // opening a FIFO would block
      const fd = openSync(file, "r");
      try {
        if (stat.ino !== inode || stat.size < offset) reset(stat.ino);
        else if (seen.length > 0) {
          const now = Buffer.alloc(seen.length);
          readSync(fd, now, 0, seen.length, offset - seen.length);
          if (!now.equals(seen)) reset(stat.ino);
        }
        const buffer = Buffer.alloc(1 << 20);
        for (let n; offset < stat.size && (n = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - offset), offset)) > 0;) {
          offset += n;
          seen = Buffer.from(buffer.subarray(Math.max(0, n - 4096), n));
          const lines = (partial + decoder.write(buffer.subarray(0, n))).split("\n");
          partial = lines.pop().slice(-65536);
          for (const line of lines) { if (line) last = line; if (regex.test(line)) return `file ${file} matched: ${line}`; }
        }
      } finally { closeSync(fd); }
      if (partial) last = partial;
      // A last line without its newline yet still counts; it stays in `partial` for the next poll.
      return partial && regex.test(partial) ? `file ${file} matched: ${partial}` : null;
    },
    pending: () => regex ? `file ${file} has no line matching /${match}/${last ? `; last line: ${last}` : ""}` : `file ${file} missing`,
  };
}

function commandCondition(command) {
  let last = "command still running at the timeout";
  return {
    // Not detached: Pi's bash abort SIGKILLs its process group, and the probe must die with it.
    check: () => new Promise((resolve) => {
      const child = spawn("/bin/bash", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] });
      probes.add(child.pid);
      let output = "";
      const collect = (d) => { output = (output + d).slice(-8192); };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", (error) => { probes.delete(child.pid); last = error.message; resolve(null); });
      child.on("close", (code) => {
        probes.delete(child.pid);
        last = `command exit ${code}: ${tail(output, 5)}`;
        resolve(code === 0 ? `command succeeded: ${command}${output.trim() ? `\n${tail(output)}` : ""}` : null);
      });
    }),
    pending: () => last,
  };
}

function urlCondition(url) {
  let last = "no answer yet";
  return {
    async check() {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))) });
        await response.body?.cancel();
        last = `url ${url} answered ${response.status}`;
        return response.ok ? last : null;
      } catch (error) { last = `url ${url} failed: ${error.cause?.code ?? error.message}`; return null; }
    },
    pending: () => last,
  };
}

// Kill a still-running command probe and everything it started.
// ponytail: one ps snapshot; a process forked after it survives. Add a process-group wrapper if that bites.
function killProbes() {
  if (probes.size === 0) return;
  const children = new Map();
  try {
    for (const line of execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).trim().split("\n")) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    }
  } catch {}
  for (const stack = [...probes]; stack.length > 0;) {
    const pid = stack.pop();
    try { process.kill(pid, "SIGKILL"); } catch {}
    stack.push(...(children.get(pid) ?? []));
  }
}

// Every condition polls on its own, so a slow command or URL never delays the others.
const met = await new Promise((resolve) => {
  setTimeout(() => resolve(null), deadline - Date.now());
  for (const condition of conditions) (async () => {
    for (;;) {
      const result = await condition.check();
      if (result) return resolve(result);
      await new Promise((wake) => setTimeout(wake, every * 1000));
    }
  })();
});
killProbes();
if (met) { console.log(`waited ${Math.round((Date.now() - started) / 100) / 10}s: ${met}`); process.exit(0); }
console.log(`wait-until: timed out after ${timeout}s; nothing held:\n${conditions.map((c) => `- ${c.pending()}`).join("\n")}`);
process.exit(124);
