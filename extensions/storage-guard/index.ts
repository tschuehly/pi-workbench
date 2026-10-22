import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CUSTOM_TYPE, freeGb, lowDiskNotice } from "./guard.mjs";

export { freeGb };

export default function storageGuard(pi: ExtensionAPI) {
  // Subagents and Workers (including the cleanup Subagent itself) are not nudged; their lead is.
  if (process.env.PI_WORKBENCH_EXECUTION_KIND !== undefined) return;
  // Once per session below the threshold, then again only after another REPEAT_DROP_GB is gone; cleanup itself runs at checkpoints.
  let notedAt: number | undefined;

  pi.on("before_agent_start", () => {
    const gb = freeGb();
    const content = lowDiskNotice(gb, notedAt);
    if (content === undefined) return;
    notedAt = gb;
    return { message: { customType: CUSTOM_TYPE, display: true, content } };
  });
}
