import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";

const SYNC = fileURLToPath(new URL("./sync.mjs", import.meta.url));

export default function ponytailSyncExtension(pi: ExtensionAPI) {
  // Children get the lead's prompt files; one writer avoids racing on APPEND_SYSTEM.md.
  if (process.env.PI_WORKBENCH_EXECUTION_KIND !== undefined) return;
  // Pi already read APPEND_SYSTEM.md for this session, so a rewrite only reaches the next one.
  pi.on("session_start", () => {
    // Never block or break startup: a failed sync leaves the old block in place.
    void Promise.resolve().then(() => pi.exec("node", [SYNC], { timeout: 15_000 })).catch(() => {});
  });
}
