#!/usr/bin/env node
// Block until the first condition holds, then print one line about it. Silent while waiting, so a
// child that has only foreground bash waits in one tool call instead of sleep or tail -f turns.
import { spawn } from "node:child_process";
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
// Node timers hold at most 2^31-1 ms (about 24 days); a larger value would fire at once.
const seconds = (name) => { const n = Number(values[name]); if (!(n > 0 && n * 1000 <= 2 ** 31 - 1)) fail(`--${name} must be a positive number of seconds, at most 2147483`); return n; };
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
  let version, last = "";
  return {
    check() {
      let stat;
      try { stat = statSync(file); } catch { return null; }
      if (!regex) return `file ${file} exists`;
      if (!stat.isFile()) { last = "not a regular file"; return null; } // opening a FIFO would block
      // Rescan the whole file whenever it changed: a log rewritten in place can keep its size, head, and footer.
      // ponytail: rereads a growing log every poll; track appends by offset if multi-GB logs make that slow.
      const now = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
      if (now === version) return null;
      version = now;
      const fd = openSync(file, "r");
      try {
        const buffer = Buffer.alloc(1 << 20), decoder = new StringDecoder("utf8");
        let partial = "";
        for (let offset = 0, n; (n = readSync(fd, buffer, 0, buffer.length, offset)) > 0; offset += n) {
          if (Date.now() >= deadline) { version = undefined; return null; } // a huge scan must not outlast the timeout
          const lines = (partial + decoder.write(buffer.subarray(0, n))).split("\n");
          partial = lines.pop();
          for (const line of lines) { if (line) last = line; if (regex.test(line)) return `file ${file} matched: ${line}`; }
        }
        if (partial) last = partial;
        // A last line without its newline yet still counts.
        return partial && regex.test(partial) ? `file ${file} matched: ${partial}` : null;
      } finally { closeSync(fd); }
    },
    pending: () => regex ? `file ${file} has no line matching /${match}/${last ? `; last line: ${last.slice(0, 300)}` : ""}` : `file ${file} missing`,
  };
}

// Each probe runs in its own process group, so killing the group reaches everything it started, even
// after the probe's shell exited. A guard in that group kills it once this process is gone, which covers
// Pi aborting the bash call with SIGKILL.
const GUARD = `(while kill -0 ${process.pid} 2>/dev/null; do sleep 1; done; kill -KILL 0) </dev/null >/dev/null 2>&1 & exec /bin/bash -c "$1"`;
const killGroup = (pid) => { try { process.kill(-pid, "SIGKILL"); } catch {} };

function commandCondition(command) {
  let last = "command still running at the timeout";
  return {
    check: () => new Promise((resolve) => {
      const child = spawn("/bin/bash", ["-c", GUARD, "wait-until", command], { stdio: ["ignore", "pipe", "pipe"], detached: true });
      probes.add(child.pid);
      let output = "";
      const collect = (d) => { output = (output + d).slice(-8192); };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", (error) => { probes.delete(child.pid); last = error.message; resolve(null); });
      // The exit status decides. Killing the group then ends any background child holding the output
      // pipes open, so the output can be read to its end.
      let status = null, done = false;
      const finish = () => {
        if (done) return;
        done = true;
        last = `command exit ${status}: ${tail(output, 5)}`;
        resolve(status === 0 ? `command succeeded: ${command}${output.trim() ? `\n${tail(output)}` : ""}` : null);
      };
      child.on("exit", (code) => { status = code; probes.delete(child.pid); killGroup(child.pid); setTimeout(finish, 1000); });
      child.on("close", finish);
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
for (const pid of probes) killGroup(pid);
if (met) { console.log(`waited ${Math.round((Date.now() - started) / 100) / 10}s: ${met}`); process.exit(0); }
console.log(`wait-until: timed out after ${timeout}s; nothing held:\n${conditions.map((c) => `- ${c.pending()}`).join("\n")}`);
process.exit(124);
