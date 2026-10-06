import { createBashToolDefinition, getAgentDir, getShellConfig, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { delimiter, join } from "node:path";
import { Type } from "typebox";
import { createBackgroundBashJobs } from "./jobs.mjs";
import { piTmpDir } from "../pi-tmp/pitmp.mjs";

// A foreground call waits this long, then continues as a background job so the agent is never stuck.
const FOREGROUND_WAIT_MS = 30_000;

export default function backgroundBashExtension(pi: ExtensionAPI) {
  // Short-lived Subagents and Workers must receive the native blocking tool: their Pi process exits at agent_settled.
  if (process.env.PI_WORKBENCH_EXECUTION_KIND !== undefined) return;
  // ponytail: Pi does not expose the configured base bash tool; foreground and background both use stock shellPath/prefix defaults (getShellConfig()). Forward configured shell settings when the extension API exposes them.
  const foreground = createBashToolDefinition(process.cwd(), {
    spawnHook: (spawn) => spawn.env.PI_SESSION_ID === undefined ? spawn : { ...spawn, env: { ...spawn.env, PI_TMP: piTmpDir(spawn.cwd, spawn.env.PI_SESSION_ID) } },
  });
  let publishStatus: () => void = () => {};
  let clearStatus: () => void = () => {};
  const jobs = createBackgroundBashJobs(pi, { onChange: () => { publishStatus(); } });
  pi.on("session_start", (_event, ctx) => {
    // One-shot modes run bash in the foreground; leave completions for the next attended open.
    if (ctx.mode === "print" || ctx.mode === "json") return;
    if (ctx.mode === "rpc") {
      publishStatus = () => {
        const active = jobs.list().filter((job: { state: string }) => job.state === "running")
          .map((job: { id: string; elapsedSeconds: number; bytes: number }) => ({
            id: job.id, elapsedSeconds: job.elapsedSeconds, bytes: job.bytes,
            // ponytail: recent output only; 8 jobs × 1200 chars stays under PI WEB's 32 KB snapshot cap. Serve the full log if the tail proves too short.
            ...jobs.preview(job.id, 1200),
          }));
        ctx.ui.setStatus("pi-workbench:background-bash", JSON.stringify({ schemaVersion: 1, jobs: active }));
      };
      clearStatus = () => { ctx.ui.setStatus("pi-workbench:background-bash", undefined); };
    }
    jobs.attach(ctx.sessionManager.getSessionId());
    publishStatus();
  });

  pi.registerTool({
    name: "bash", label: "bash",
    description: "Run a bash command in an attended Pi session. Background by default: return a job ID immediately, keep elapsed time and output size visible in Activity, and deliver exit status and output when done. Set foreground=true to wait up to 30 seconds for the output; a command still running then continues in the background and delivers its completion like any job. One-shot print/JSON modes run foreground; child Pi uses the native bash tool. Background jobs survive session shutdown, reload and PI WEB restarts; they stop at their timeout or a 12-hour maximum lifetime.",
    promptSnippet: "Run bash commands in the background by default; use foreground for dependent steps",
    promptGuidelines: [
      "Run long checks and builds in the background. Continue independent work, then wait for their completion message before dependent actions; never infer success from a job ID.",
      "Use foreground=true for short commands whose output is needed now. If it returns a job ID instead, the command is still running: continue independent work or end the turn. Do not launch conflicting writes while a background command is running.",
      "Use bash_status for elapsed time and output bytes; use bash_cancel to stop a job. If the command redirects its own output to a log, inspect that log separately for progress.",
      "A completed job reports its exit status and bounded output in a new message; do not claim success from its initial job ID.",
    ],
    parameters: Type.Object({
      description: Type.String({ description: "Short description of what this command does, 3-10 words, in plain words (e.g. 'Check installed app build date'). Shown to the user instead of the command." }),
      command: Type.String({ description: "Shell command to execute" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional; background jobs otherwise stop after 12 hours)" })),
      foreground: Type.Optional(Type.Boolean({ description: "Wait up to 30 seconds for output and exit status, then continue in the background; default false" })),
    }),
    async execute(id, params, signal, onUpdate, ctx) {
      // One-shot modes settle as soon as the tool returns; never detach their result.
      if (ctx.mode === "print" || ctx.mode === "json") {
        return foreground.execute(id, { command: params.command, ...(params.timeout === undefined ? {} : { timeout: params.timeout }) }, signal, onUpdate, ctx);
      }
      if (signal?.aborted) throw new Error("Bash launch cancelled");
      const env: NodeJS.ProcessEnv = { ...process.env, PI_SESSION_ID: ctx.sessionManager.getSessionId(), PI_TMP: piTmpDir(ctx.cwd, ctx.sessionManager.getSessionId()) };
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
      const bin = join(getAgentDir(), "bin");
      const entries = (env[pathKey] ?? "").split(delimiter).filter(Boolean);
      if (!entries.includes(bin)) env[pathKey] = [bin, ...entries].join(delimiter);
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (sessionFile) env.PI_SESSION_FILE = sessionFile;
      else delete env.PI_SESSION_FILE;
      if (ctx.model) { env.PI_PROVIDER = ctx.model.provider; env.PI_MODEL = ctx.model.id; }
      else { delete env.PI_PROVIDER; delete env.PI_MODEL; }
      if (ctx.thinkingLevel) env.PI_REASONING_LEVEL = ctx.thinkingLevel;
      else delete env.PI_REASONING_LEVEL;
      const { shell, args } = getShellConfig();
      const job = jobs.start(params.command, ctx.cwd, params.timeout, env, { sessionId: ctx.sessionManager.getSessionId(), sessionFile, shell, args, description: params.description });
      if (params.foreground === true) {
        const done = await jobs.wait(job.id, FOREGROUND_WAIT_MS, signal);
        if (done !== undefined) {
          const text = `${done.truncated ? `[showing recent output only; full output: ${done.logPath}]\n` : ""}${done.output || "(no output)"}`;
          if (done.state === "cancelled") throw new Error(`${text}\n\nCommand aborted`);
          if (done.state !== "complete") throw new Error(`${text}\n\nCommand ${done.exitCode === undefined ? "failed" : `exited with code ${done.exitCode}`}`);
          return { content: [{ type: "text", text }], details: done };
        }
        return { content: [{ type: "text", text: `Still running after 30s; continued as background bash ${job.id}. Continue independent work or end the turn; completion arrives automatically. Output log: ${job.logPath}` }], details: job };
      }
      return { content: [{ type: "text", text: `Background bash ${job.id} started. Continue independent work or end the turn; completion arrives automatically. Output log: ${job.logPath}` }], details: job };
    },
  });

  pi.registerTool({
    name: "bash_status", label: "Bash status", description: "Diagnostic snapshot of background bash job state, elapsed time, output byte count, and log path. Do not use to poll for completion; it arrives automatically. Omit id to list all jobs in this session.",
    parameters: Type.Object({ id: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      const list = jobs.list().filter((job: { id: string }) => params.id === undefined || job.id === params.id);
      return { content: [{ type: "text", text: list.length ? JSON.stringify(list) : "No matching background bash jobs." }], details: { jobs: list } };
    },
  });

  pi.registerTool({
    name: "bash_cancel", label: "Cancel bash", description: "Stop one session-owned background bash job by ID. Does not affect unrelated processes.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, params) {
      const job = jobs.cancel(params.id);
      return { content: [{ type: "text", text: job === undefined ? `No background bash job ${params.id}.` : `Cancellation requested for ${params.id} (state=${job.state}).` }], details: job };
    },
  });

  // A completion counts as delivered only once Pi starts its message; a dropped one is resent when the agent settles.
  pi.on("message_start", (event: { message?: unknown }) => { jobs.acknowledge(event.message); });
  pi.on("agent_settled", () => { jobs.redeliver(); });

  // Jobs keep running; the next session_start of this session reattaches them.
  pi.on("session_shutdown", () => { jobs.shutdown(); clearStatus(); publishStatus = () => {}; clearStatus = () => {}; });
}
