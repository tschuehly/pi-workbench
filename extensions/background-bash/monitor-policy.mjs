import { piTmpDir } from "../pi-tmp/pitmp.mjs";
import { confine } from "./sandbox.mjs";

/** Monitor supplies the session context at startup, never options.cwd from the watcher. */
export function registerMonitorPolicy(events, fullAccess = () => false) {
  events.on("pi-process-monitor:launch-policy:v1", ({ bind, sessionId, cwd }) => bind((command) => {
    const { PI_HOST_OPS: _, ...env } = process.env;
    return confine({ command, shell: process.platform === "win32" ? "bash" : "/bin/bash", args: ["-c"], cwd, sessionId, fullAccess: fullAccess() },
      { ...env, PI_SESSION_ID: sessionId, PI_TMP: piTmpDir(cwd, sessionId) });
  }));
}
