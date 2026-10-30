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
const seconds = (name) => { const n = Number(values[name]); if (!(n > 0)) fail(`--${name} must be a positive number of seconds`); return n; };
const timeout = seconds("timeout");
const every = seconds("every");
const started = Date.now();
const deadline = started + timeout * 1000;
const tail = (text, n = 20) => text.trimEnd().split("\n").slice(-n).join("\n");

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
  // Read only what was appended since the last poll; a smaller or replaced file starts over.
  let offset = 0, inode, partial = "", decoder = new StringDecoder("utf8"), last = "";
  return {
    check() {
      let stat;
      try { stat = statSync(file); } catch { return null; }
      if (!regex) return `file ${file} exists`;
      if (stat.ino !== inode || stat.size < offset) { inode = stat.ino; offset = 0; partial = ""; decoder = new StringDecoder("utf8"); }
      const fd = openSync(file, "r");
      try {
        const buffer = Buffer.alloc(1 << 20);
        for (let n; offset < stat.size && (n = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - offset), offset)) > 0;) {
          offset += n;
          const lines = (partial + decoder.write(buffer.subarray(0, n))).split("\n");
          partial = lines.pop();
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
  let last = "not run";
  return {
    check: () => new Promise((resolve) => {
      const child = spawn("/bin/bash", ["-c", command], { stdio: ["ignore", "pipe", "pipe"], detached: true });
      let output = "";
      const collect = (d) => { output = (output + d).slice(-8192); };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      // A hanging command must not hold the wait past its timeout; kill its whole process group.
      // The cut-off attempt keeps the previous attempt's report, which says more.
      let cut = false;
      const killer = setTimeout(() => { cut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, Math.max(0, deadline - Date.now()));
      child.on("error", (error) => { clearTimeout(killer); last = error.message; resolve(null); });
      child.on("close", (code) => {
        clearTimeout(killer);
        if (!cut || last === "not run") last = cut ? `command still running at the timeout: ${tail(output, 5)}` : `command exit ${code}: ${tail(output, 5)}`;
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

const elapsed = () => `${Math.round((Date.now() - started) / 100) / 10}s`;
for (;;) {
  for (const condition of conditions) {
    const met = await condition.check();
    if (met) { console.log(`waited ${elapsed()}: ${met}`); process.exit(0); }
  }
  if (Date.now() >= deadline) {
    console.log(`wait-until: timed out after ${timeout}s; nothing held:\n${conditions.map((c) => `- ${c.pending()}`).join("\n")}`);
    process.exit(124);
  }
  await new Promise((resolve) => setTimeout(resolve, Math.min(every * 1000, Math.max(0, deadline - Date.now()))));
}
