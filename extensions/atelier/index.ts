import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { checkpointBarrier } from "../context-checkpoint/checkpoint-barrier.mjs";
import { REQUEST_STATES, derive } from "./kernel/atelier.js";
import { WATCHDOG_MS, createHost, readLog } from "./host.ts";
import { checkPage, formatCheck } from "./check-page.mjs";
import { piTmpDir } from "../pi-tmp/pitmp.mjs";
import type { Host, Message } from "./host.ts";
import { DESCRIPTION } from "./description.mjs";

// Atelier extension (decisions 129-156): the `atelier` tool, and Delivery of human events from a Page's Event Log
// into this Pi session through the page server in host.ts. The Page side lives in kernel/atelier.js.
export { KERNEL_FILES, appendLog, claimPage, copyKernel, createHost, dueMessages, imagesDir, inside, logPath, readLog } from "./host.ts";


export default function atelierExtension(pi: ExtensionAPI) {
  let host: Host | undefined;
  let current: ExtensionContext | undefined;
  let sessionId: string | undefined;

  // Delivery (131, 150): a follow-up custom message that wakes the session, held by the context-checkpoint barrier like Subagent wakes.
  // A send to an idle session starts a run, but Pi marks the session streaming only at agent_start; a second
  // send in that gap starts a concurrent prompt that fails silently (measured in an RPC session). Hold later
  // sends until the run has started.
  let starting = false;
  const held: (() => void)[] = [];
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  const release = () => { starting = false; clearTimeout(startTimer); for (const fire of held.splice(0)) fire(); };
  const send = (message: Message, done: (idle: boolean) => void, failed: () => void) => {
    const fire = () => {
      if (!host?.current(message.details)) { failed(); return; } // handed over meanwhile: the new receiver has it
      if (starting) { held.push(fire); return; }
      let idle = false;
      try { idle = current?.isIdle() ?? false; } catch { /* stale context: treat as busy */ }
      try {
        pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" });
        if (idle) { // a run that never starts must not hold sends forever
          starting = true;
          clearTimeout(startTimer);
          startTimer = setTimeout(release, WATCHDOG_MS);
          startTimer.unref?.();
        }
        done(idle);
      } catch { failed(); } // replaced session: the next opener gets these
    };
    const key = `atelier:${message.details.page}:${message.details.seqs.join(",")}`;
    if (sessionId === undefined || checkpointBarrier(sessionId).defer(fire, key) !== true) fire();
  };

  pi.on("session_start", (_event, ctx) => { current = ctx; sessionId = ctx.sessionManager.getSessionId?.() ?? sessionId; });
  pi.on("message_end", (event) => {
    const message = event.message as { role?: string; customType?: string; details?: { page?: string; seqs?: number[] } };
    if (message.role === "custom" && message.customType?.startsWith("atelier:")) host?.seen(message.details);
  });
  pi.on("agent_start", release);
  pi.on("agent_settled", () => { release(); host?.settled(); });
  pi.on("session_shutdown", () => { held.length = 0; starting = false; clearTimeout(startTimer); host?.stop(); host = undefined; });

  pi.registerTool({
    name: "atelier",
    label: "Atelier",
    description: DESCRIPTION,
    promptSnippet: "Show the human an interactive HTML Page and act on their input",
    parameters: Type.Object({
      action: StringEnum(["open", "takeover", "update", "ask", "answer", "status", "check"]),
      page: Type.String({ description: "Page path, relative to the project or absolute" }),
      decision: Type.Optional(Type.Object({
        id: Type.String(),
        question: Type.String(),
        options: Type.Array(Type.Object({ label: Type.String(), consequence: Type.String(), recommended: Type.Optional(Type.Boolean()) }), { minItems: 2 }),
        key: Type.Optional(Type.String({ description: "Key it sits on" })),
        material: Type.Optional(Type.String({ description: "Key whose opening counts as opened" })),
        detail: Type.Optional(Type.String()),
      })),
      comment: Type.Optional(Type.Number({ description: "answer: Comment #" })),
      request: Type.Optional(Type.Number({ description: "status: Request #" })),
      state: Type.Optional(StringEnum(REQUEST_STATES)),
      text: Type.Optional(Type.String({ description: "answer text, status note, or update note" })),
      generation: Type.Optional(Type.Number({ description: "takeover: receiver generation" })),
    }),
    executionMode: "sequential",

    async execute(_toolCallId, params: any, signal, _onUpdate, ctx) {
      current = ctx;
      sessionId ??= ctx.sessionManager.getSessionId?.();
      const root = realpathSync(ctx.cwd);
      let page: string | undefined;
      try { page = realpathSync(path.resolve(root, params.page)); } catch { /* missing */ }
      if (!page || !statSync(page).isFile()) throw new Error(`No Page file at ${params.page}.`);
      // The handover note reaches a busy session mid-run and an idle one without starting a turn.
      // Idle for a takeover: no run, and none starting from a send already queued.
      host ??= createHost({ root, send, sessionId, label: pi.getSessionName?.(), handoff: (m) => pi.sendMessage(m, { deliverAs: "steer" }), idle: () => !starting && (current?.isIdle() ?? true) });
      const text = (t: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: t }], details: { action: params.action, page: host!.rel(page), ...details } });
      // The Page check (check-page.mjs) on a test copy served from this host's root; ATELIER_PAGE_CHECK=off skips it
      // (unit tests). It never fails the action; a cancelled tool call cancels it. Screenshots and the full report go to
      // this session's PI_TMP folder: an attended process hosts several sessions and has no process-wide PI_TMP.
      const checked = async (t: string, details: Record<string, unknown> = {}, source?: Buffer) => {
        if (process.env.ATELIER_PAGE_CHECK === "off") return text(t, details);
        let tmp = process.env.PI_TMP;
        try { if (sessionId) tmp = piTmpDir(ctx.cwd, sessionId); } catch { /* unwritable root: checkPage reports it unchecked */ }
        const check = await checkPage(page!, { root: host!.root, tmp, source, signal }).catch((error: unknown) => ({ status: "unchecked", viewport: "", revision: null, checks: [], views: [], unchecked: [String(error).slice(0, 300)], report: null }));
        return text([t, formatCheck(check)].filter(Boolean).join("\n\n"), { ...details, check });
      };

      if (params.action === "check") return checked("");

      if (params.action === "open" || params.action === "takeover") {
        if (params.action === "takeover" && !Number.isInteger(params.generation)) throw new Error("takeover needs the generation open named.");
        const opened = params.action === "open" ? await host.open(page) : await host.takeover(page, params.generation);
        const notes = opened.kernel.flatMap(({ file, outcome }) =>
          outcome === "changed" ? [`${file} beside the Page was changed locally and was not overwritten. It is a Contribution candidate: raise a pull request against pi-workbench (decision 136).`]
          : outcome === "behind" ? [`${file} beside the Page is an older Kernel; offer the owner the diff before replacing it (decision 136).`]
          : outcome === "symlink" ? [`${file} beside the Page is a symlink and was left alone.`] : []);
        return checked([
          `Page open: ${opened.url}`,
          params.action === "takeover" ? `Its human input now goes to this session (generation ${opened.generation}), handed over within this process, so the link and open tabs stay.` : "Link it in the Chat.",
          ...(opened.unfinished.length ? ["Unfinished, left by the earlier receiver; check their state before repeating work:", ...opened.unfinished.map((u) => `- ${u}`)] : []),
          ...notes,
          opened.replayed ? `${opened.replayed} message(s) of undelivered human events from an earlier session follow.` : "",
        ].filter(Boolean).join("\n"), { url: opened.url, kernel: opened.kernel, replayed: opened.replayed, generation: opened.generation });
      }
      if (!host.isOpen(page)) throw new Error(`Open ${params.page} first (action open).`);
      const entries = readLog(page);

      if (params.action === "update") {
        // The owner sees this revision at once; its check follows in this result, so fix a FAIL with another update.
        const source = readFileSync(page);
        const tabs = host.update(page, params.text);
        return checked(tabs ? `Update sent to ${tabs} connected tab(s); the owner sees this revision now.` : "No tab is connected; the Page shows this version when it is next opened.", { tabs }, source);
      }
      if (params.action === "ask") {
        const d = params.decision;
        if (!d) throw new Error("ask needs decision.");
        if (d.options.filter((o: any) => o.recommended === true).length > 1) throw new Error("A Decision recommends at most one option (decision 155).");
        const entry = host.agent(page, { type: "ask", decision: d });
        return text(`Decision ${d.id} posted (#${entry.seq}). End your turn; the answer arrives as a message after its 3-second undo window.`, { seq: entry.seq });
      }
      if (params.action === "answer") {
        const target = entries.find((e) => e.seq === params.comment && e.type === "comment" && e.origin === "human");
        if (!target || !params.text) throw new Error(`answer needs the #number of a Comment and text.`);
        const entry = host.agent(page, { type: "answer", target: target.seq, text: params.text });
        return text(`Answered Comment #${target.seq} in its thread (#${entry.seq}).`, { seq: entry.seq });
      }
      // status
      const request = derive(entries).requests.find((r: any) => r.req.seq === params.request);
      if (!request || !params.state) throw new Error("status needs the #number of a Request and a state.");
      const entry = host.agent(page, { type: "status", target: params.request, state: params.state, note: params.text, revision: request.revision });
      return text(`Request #${params.request} is ${params.state} (revision ${request.revision}, #${entry.seq}).`, { seq: entry.seq, revision: request.revision });
    },
  });
}
