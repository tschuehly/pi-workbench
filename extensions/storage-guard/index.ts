import { statfsSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ponytail: fixed 50 GB nudge point (owner choice); PI_STORAGE_GUARD_FREE_GB overrides the reading for tests.
const LOW_GB = 50;
const CUSTOM_TYPE = "storage-guard";

export function freeGb(): number {
  const fake = process.env.PI_STORAGE_GUARD_FREE_GB;
  if (fake !== undefined) return Number(fake);
  const disk = statfsSync(homedir());
  return (disk.bavail * disk.bsize) / 2 ** 30;
}

const note = (gb: number, text: string) => ({ customType: CUSTOM_TYPE, display: true, content: `Disk low: ${gb.toFixed(0)} GB free. ${text}` });

export default function storageGuard(pi: ExtensionAPI) {
  // Subagents and Workers (including the cleanup Subagent itself) are not nudged; their lead is.
  if (process.env.PI_WORKBENCH_EXECUTION_KIND !== undefined) return;
  let continued = false;

  pi.on("before_agent_start", () => {
    const gb = freeGb();
    if (gb >= LOW_GB) return;
    return { message: note(gb, "Clean up what this Workstream no longer needs (see `mac-storage-workspaces --workstream <id>`).") };
  });

  // At every run end below the threshold, ask once for cleanup; never twice in a row, so it cannot loop.
  pi.on("agent_before_settle", (event) => {
    if (continued || event.outcome === "aborted") { continued = false; return; }
    const gb = freeGb();
    if (gb >= LOW_GB) return;
    continued = true;
    return {
      continue: true,
      entries: [{ type: "custom_message", ...note(gb, "Before finishing, launch the storage cleanup Subagent from the workstreams skill's checkpoint step, unless one is already running; then end your turn.") }],
    };
  });
}
