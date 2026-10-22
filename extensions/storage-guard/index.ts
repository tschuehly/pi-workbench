import { statfsSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ponytail: fixed 50 GB nudge point and 5 GB repeat step (owner choices); PI_STORAGE_GUARD_FREE_GB overrides the reading for tests.
const LOW_GB = 50;
const REPEAT_DROP_GB = 5;
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
  // Once per session below the threshold, then again only after another REPEAT_DROP_GB is gone; cleanup itself runs at checkpoints.
  let notedAt: number | undefined;

  pi.on("before_agent_start", () => {
    const gb = freeGb();
    if (gb >= LOW_GB || (notedAt !== undefined && gb > notedAt - REPEAT_DROP_GB)) return;
    notedAt = gb;
    return { message: note(gb, "At the next checkpoint, clean up what this Workstream no longer needs (see `mac-storage-workspaces --workstream <id>`).") };
  });
}
