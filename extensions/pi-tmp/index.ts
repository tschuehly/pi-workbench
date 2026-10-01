import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { blockTmpWrite, piTmpDir, sweep, warnTmpBash } from "./pitmp.mjs";

export default function piTmpExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    try { sweep(); } catch { /* cleanup is best effort */ }
    // A child Pi process hosts exactly one session, so its native bash inherits PI_TMP from the process.
    // Attended processes can host several sessions; background-bash sets PI_TMP per command there.
    // Never set TMPDIR to PI_TMP: its long path overflows the 104-byte Unix socket path limit.
    if (process.env.PI_WORKBENCH_EXECUTION_KIND !== undefined) process.env.PI_TMP = piTmpDir(ctx.cwd, ctx.sessionManager.getSessionId());
  });

  // Tool events match by name, so background-bash's `bash` override is covered too.
  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const reason = blockTmpWrite((event.input as { path?: unknown }).path, ctx.cwd);
    if (reason) return { block: true, reason };
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash") return;
    const warning = warnTmpBash(event.input.command);
    if (warning) return { content: [...event.content, { type: "text", text: warning }] };
  });
}
