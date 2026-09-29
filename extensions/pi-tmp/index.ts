import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { piTmpDir, sweep } from "./pitmp.mjs";

export default function piTmpExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    try { sweep(); } catch { /* cleanup is best effort */ }
    // A child Pi process hosts exactly one session, so its native bash inherits PI_TMP from the process.
    // Attended processes can host several sessions; background-bash sets PI_TMP per command there.
    if (process.env.PI_WORKBENCH_EXECUTION_KIND !== undefined) process.env.PI_TMP = piTmpDir(ctx.cwd, ctx.sessionManager.getSessionId());
  });
}
