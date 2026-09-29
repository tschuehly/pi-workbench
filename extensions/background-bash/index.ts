import { createBashToolDefinition, getAgentDir, getShellConfig, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { delimiter, join } from "node:path";
import { Type } from "typebox";
import { createBackgroundBashJobs } from "./jobs.mjs";
import { piTmpDir } from "../pi-tmp/pitmp.mjs";

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
    description: "Run a bash command in an attended Pi session. Background by default: return a job ID immediately, keep elapsed time and output size visible in Activity, and deliver exit status and output when done. Set foreground=true to wait. One-shot print/JSON modes run foreground; child Pi uses the native bash tool. Background jobs survive reload and PI WEB restarts but are cancelled by /new, /resume or fork; they stop at their timeout or a 12-hour maximum lifetime.",
    promptSnippet: "Run bash commands in the background by default; use foreground for dependent steps",
    promptGuidelines: [
      "Run long checks and builds in the background. Continue independent work, then wait for their completion message before dependent actions; never infer success from a job ID.",
      "Use foreground=true only for short commands whose output is needed now and when there is no independent work. Do not launch conflicting writes while a background command is running.",
      "Use bash_status for elapsed time and output bytes; use bash_cancel to stop a job. If the command redirects its own output to a log, inspect that log separately for progress.",
      "A completed job reports its exit status and bounded output in a new message; do not claim success from its initial job ID.",
    ],
    parameters: Type.Object({
      command: Type.String({ description: "Shell command to execute" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional; background jobs otherwise stop after 12 hours)" })),
      foreground: Type.Optional(Type.Boolean({ description: "Wait for output and exit status; default false" })),
    }),
    async execute(id, params, signal, onUpdate, ctx) {
      // One-shot modes settle as soon as the tool returns; never detach their result.
      if (params.foreground === true || ctx.mode === "print" || ctx.mode === "json") {
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
      const job = jobs.start(params.command, ctx.cwd, params.timeout, env, { sessionId: ctx.sessionManager.getSessionId(), sessionFile, shell, args });
      return { content: [{ type: "text", text: `Background bash ${job.id} started. Check bash_status or continue independent work; completion will arrive automatically. Output log: ${job.logPath}` }], details: job };
    },
  });

  pi.registerTool({
    name: "bash_status", label: "Bash status", description: "Show background bash job state, elapsed time, output byte count, and log path. Omit id to list all jobs in this session.",
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

  // Quit and reload (including PI WEB restarts) keep jobs running for the next session_start to reattach.
  // Leaving the session for another (/new, /resume, fork) cancels them, as nothing would watch them.
  pi.on("session_shutdown", (event) => { const reason = event?.reason; if (reason === "new" || reason === "resume" || reason === "fork") jobs.cancelAll(); jobs.shutdown(); clearStatus(); publishStatus = () => {}; clearStatus = () => {}; });
}
