import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  afkPending, ALIGNMENT_RESET_TOOL, ALIGNMENT_TOOL, alignmentReachedText, alignmentResetText, alignmentResetTool, alignmentTool,
  axes, axisNames, CUSTOM_TYPE, defaults, isSelection, renderBlock, same, selectFromArgs, usage,
  type Axis, type WorkingModeDetails, type WorkingModeSnapshot, type WorkingModeState,
} from "./rules.mts";

export * from "./rules.mts";

/** Alignment state from whichever came last on the branch: a Working Mode block or an alignment tool result. */
function latestAligned(entries: readonly any[]): boolean {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "custom_message" && entry.customType === CUSTOM_TYPE && isSelection(entry.details?.selection)) return !!entry.details.aligned;
    const message = entry?.type === "message" ? entry.message : undefined;
    if (message?.role === "toolResult" && !message.isError) {
      if (message.toolName === ALIGNMENT_TOOL) return true;
      if (message.toolName === ALIGNMENT_RESET_TOOL) return false;
    }
  }
  return false;
}

/** Latest Working Mode block among the given entries, or null. */
function latestBlock(entries: readonly any[]): WorkingModeDetails | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type === "custom_message" && entry.customType === CUSTOM_TYPE && isSelection(entry.details?.selection)) return entry.details;
  }
  return null;
}

export default function workingModeExtension(pi: ExtensionAPI) {
  let selected: WorkingModeState = { ...defaults };
  let applied: WorkingModeState | null = null;
  let aligned = false;
  // Block sent by `/mode send` that may still wait in the steer queue, outside the session branch.
  let queued: WorkingModeDetails | null = null;

  /** Next block to deliver, or null when the model already sees (or will see) the selection. */
  function pendingBlock(ctx: ExtensionContext, sent: boolean) {
    // Compare with the block the model can still see; compaction may have summarized it away.
    const seen = queued ?? latestBlock(ctx.sessionManager.buildContextEntries());
    if (same(seen?.selection ?? defaults, selected) && !!seen?.aligned === aligned) return null;
    const seq = Math.max(queued?.seq ?? 0, latestBlock(ctx.sessionManager.getBranch())?.seq ?? 0) + 1;
    const details: WorkingModeDetails = { schemaVersion: 2, seq, selection: { ...selected }, aligned };
    return { customType: CUSTOM_TYPE, content: renderBlock(selected, seq, aligned, sent), display: true, details };
  }

  const publish = (ctx: ExtensionContext, phase: WorkingModeSnapshot["phase"]) => {
    const value: WorkingModeSnapshot = { schemaVersion: 2, phase, selected: { ...selected }, applied, aligned };
    pi.events?.emit("pi-workbench:working-mode", value);
    ctx.ui.setStatus("working-mode", ctx.mode === "tui"
      ? axisNames.map((axis) => `${axes[axis].label}: ${selected[axis]}`).join(" · ")
      : JSON.stringify(value));
  };

  function applyArgs(args: string) {
    const next = selectFromArgs(selected, aligned, args);
    if (!next) return false;
    selected = next.selection;
    aligned = next.aligned;
    return true;
  }

  // Changing the Alignment value asks for a new agreement.
  function select(axis: Axis, value: string) {
    if (axis === "alignment" && value !== selected.alignment) aligned = false;
    selected = { ...selected, [axis]: value };
  }

  pi.on("session_start", (_event, ctx) => {
    const branch = ctx.sessionManager.getBranch();
    selected = { ...(latestBlock(branch)?.selection ?? defaults) };
    aligned = latestAligned(branch);
    applied = null;
    queued = null;
    publish(ctx, "selected");
  });

  // A run's end means a queued steer either landed in the branch or was dropped (abort, clearQueue).
  // ponytail: a steer queued after the loop's last queue check can survive into the next run and
  // duplicate the block there; track message_end of the queued block if that shows up in practice.
  pi.on("agent_end", () => { queued = null; });

  pi.registerCommand("mode", {
    description: "Choose Working Mode guidance for the next prompt; /mode send delivers it now",
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() === "send") {
        const message = pendingBlock(ctx, true);
        if (!message) {
          if (ctx.hasUI) ctx.ui.notify("Working Mode unchanged", "info");
          return;
        }
        queued = message.details;
        applied = { ...selected };
        publish(ctx, "applied");
        // Idle: starts a turn. Streaming: steers the running turn after its current tool calls.
        pi.sendMessage(message, { triggerTurn: true, deliverAs: "steer" });
        return;
      }
      if (args.trim()) {
        if (!applyArgs(args)) {
          if (ctx.hasUI) ctx.ui.notify(usage, "warning");
          return;
        }
      } else if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify(usage, "info");
        return;
      } else {
        const choice = await ctx.ui.select("Working Mode — guidance, not permissions", axisNames.map((axis) => `${axes[axis].label}: ${selected[axis]}`));
        const axis = axisNames.find((name) => choice === `${axes[name].label}: ${selected[name]}`);
        if (!axis) return;
        const value = await ctx.ui.select(axes[axis].label, Object.keys(axes[axis].values));
        if (!value || !Object.hasOwn(axes[axis].values, value)) return;
        select(axis, value);
      }
      publish(ctx, "selected");
      if (ctx.mode === "tui") ctx.ui.notify("Working Mode applies with the next prompt.", "info");
    },
  });

  pi.on("before_agent_start", (_event, ctx) => {
    applied = { ...selected };
    publish(ctx, "applied");
    const message = pendingBlock(ctx, false);
    return message ? { message } : undefined;
  });

  pi.registerTool({
    name: ALIGNMENT_TOOL,
    label: alignmentTool.label,
    description: alignmentTool.description,
    parameters: Type.Object({ agreement: Type.String({ minLength: 1, description: alignmentTool.agreement }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const wasPending = afkPending(selected, aligned);
      aligned = true;
      publish(ctx, "applied");
      const text = alignmentReachedText(wasPending);
      return { content: [{ type: "text", text }], details: { alignment: selected.alignment, agreement: params.agreement } };
    },
  });

  pi.registerTool({
    name: ALIGNMENT_RESET_TOOL,
    label: alignmentResetTool.label,
    description: alignmentResetTool.description,
    parameters: Type.Object({ reason: Type.String({ minLength: 1, description: alignmentResetTool.reason }) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      aligned = false;
      publish(ctx, "applied");
      const text = alignmentResetText(selected);
      return { content: [{ type: "text", text }], details: { alignment: selected.alignment, reason: params.reason } };
    },
  });
}
