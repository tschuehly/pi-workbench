import { statfsSync } from "node:fs";
import { homedir } from "node:os";

// ponytail: fixed 50 GB nudge point and 5 GB repeat step (owner choices); PI_STORAGE_GUARD_FREE_GB overrides the reading for tests.
export const LOW_GB = 50;
export const REPEAT_DROP_GB = 5;
export const CUSTOM_TYPE = "storage-guard";

export function freeGb() {
  const fake = process.env.PI_STORAGE_GUARD_FREE_GB;
  if (fake !== undefined) return Number(fake);
  const disk = statfsSync(homedir());
  return (disk.bavail * disk.bsize) / 2 ** 30;
}

/**
 * The lead's low-disk notice text, or undefined: once below LOW_GB, then again only after another REPEAT_DROP_GB is gone
 * since the last notice (`notedAt`). Cleanup itself runs at checkpoints, never as a forced turn.
 */
export function lowDiskNotice(gb, notedAt) {
  if (gb >= LOW_GB || (notedAt !== undefined && gb > notedAt - REPEAT_DROP_GB)) return undefined;
  return `Disk low: ${gb.toFixed(0)} GB free. At the next checkpoint, clean up what this Workstream no longer needs (see \`mac-storage-workspaces --workstream <id>\`).`;
}
