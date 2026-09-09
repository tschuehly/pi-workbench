import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatSkillsForPrompt, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  AUDIT_FORMAT, AUDIT_SCHEMA_VERSION, createAuditStore, createTransportObserver, findExactSkillEvidence,
  formatError, isInside, jsonValue, providerCoverage, snapshotFileVersion, snapshotSources,
} from "./audit.mjs";
import {
  alignmentGuidance, checkingGuidance, renderWorkingModePrompt, visibleSkillsForMode, type WorkingModeState,
} from "../working-mode/index.ts";

const indexPath = fileURLToPath(import.meta.url);
const checkoutRoot = realpathSync(resolve(dirname(indexPath), "../.."));
const defaultAuditRoot = join(checkoutRoot, ".review", "agent-audit");
const extensionVersion = 1;
const producerSources = [
  snapshotFileVersion(indexPath, "capture adapter"),
  snapshotFileVersion(join(dirname(indexPath), "audit.mjs"), "transport/storage implementation"),
  snapshotFileVersion(join(dirname(indexPath), "../working-mode/index.ts"), "Working Mode renderer"),
];

export default function agentAuditExtension(pi: ExtensionAPI) { registerAgentAudit(pi); }

export function registerAgentAudit(pi: ExtensionAPI, runtime: { auditRoot?: string; buildSystemPrompt?: (options: any) => string | Promise<string> } = {}) {
  const auditRoot = runtime.auditRoot ?? defaultAuditRoot;
  const buildBasePrompt = runtime.buildSystemPrompt
    ? async (options: any) => ({ prompt: await runtime.buildSystemPrompt!(options), evidence: { source: "injected-test-harness", limitation: "Not evidence from a running Pi installation." } })
    : loadPiBasePrompt;
  let enabled = false;
  let activeSessionId: string | null = null;
  let activeCtx: ExtensionContext | null = null;
  let previewId: string | null = null;
  let run: any = null;
  let logical: any = null;
  let turnIndex: number | null = null;
  let contextAtAuditHook: unknown = null;
  let selectedMode: WorkingModeState | null = null;
  let appliedMode: WorkingModeState | null = null;
  let store: ReturnType<typeof createAuditStore> | null = null;

  const report = (problem: unknown) => {
    const message = `Agent audit evidence incomplete: ${formatError(problem)}`;
    console.error(message);
    activeCtx?.ui.notify(message, "error");
    activeCtx?.ui.setStatus("agent-audit", "Agent audit: incomplete (see error)");
  };

  const observer = createTransportObserver({
    current: () => enabled && logical !== null && !logical.transportClosed ? { ...logical, selectedMode: selectedMode ? { ...selectedMode } : null } : null,
    capture: (observation: any) => {
      const decoded = observation.body?.interpretation?.status === "decoded" ? observation.body.interpretation.text : null;
      let actualPayload = null;
      if (decoded !== null) { try { actualPayload = JSON.parse(decoded); } catch {} }
      const skillEvidence = findExactSkillEvidence(
        actualPayload,
        observation.logical.run.options.skills ?? [],
        observation.logical.appliedMode ? visibleSkillsForMode(observation.logical.run.options.skills ?? [], observation.logical.appliedMode.checking) : observation.logical.run.options.skills ?? [],
        formatSkillsForPrompt,
        { api: observation.logical.provider.api, contextMessages: observation.logical.context, cwd: observation.logical.run.options.cwd },
      );
      const capture = {
        schemaVersion: AUDIT_SCHEMA_VERSION,
        format: AUDIT_FORMAT,
        id: observation.id,
        timestamp: observation.sentAt,
        capturePolicy: {
          optIn: "explicit current-session /agent-audit start confirmation",
          retention: "until explicit local cleanup",
          sensitivity: "Exact prompts can contain secrets. This local snapshot is not made safe by redaction.",
        },
        runtime: runtimeVersions(),
        producerSources,
        extensionVersion,
        session: observation.logical.session,
        group: {
          runId: observation.logical.run.id,
          logicalObservationId: observation.logical.id,
          turnIndex: observation.logical.turnIndex,
          attempt: observation.logical.transportIds.indexOf(observation.id) + 1,
          correlation: "Observed inside one provider hook/turn interval; Pi exposes no shared request ID.",
        },
        provider: observation.logical.provider,
        workingMode: { appliedToPrompt: observation.logical.appliedMode, selectedNextTurnAtTransport: observation.logical.selectedMode },
        transport: {
          kind: observation.transport,
          url: observation.url,
          method: observation.metadata.method ?? null,
          contentType: observation.metadata.contentType,
          contentEncoding: observation.metadata.contentEncoding,
          sendOutcome: observation.sendOutcome,
          error: observation.error,
          body: observation.body,
          claimLimit: "Observed at the local fetch/WebSocket send boundary; this does not prove provider receipt or reveal server-side instructions.",
        },
        logicalObservation: {
          stage: "before_provider_request at this extension's load order",
          limitation: "Later handlers may replace this payload; SDK transport transforms may follow.",
          payload: observation.logical.payload,
          contextAtAuditHook: observation.logical.context,
        },
        previewSetId: observation.logical.run.previewSetId,
        promptInputs: observation.logical.run.promptInputs,
        sourceSnapshots: observation.logical.run.sources,
        skills: {
          installedExplicitlyCallable: observation.logical.run.explicitSkillCommands,
          ...skillEvidence,
          limitation: "Catalog visibility, explicit command availability, and skill bodies found in request messages are separate evidence.",
        },
        activeTools: observation.logical.run.tools,
        actualRequestInterpretation: {
          status: actualPayload === null ? "unavailable" : "decoded-json",
          payload: actualPayload,
          instructionFields: actualPayload === null ? [] : instructionFields(actualPayload, observation.logical.provider.api),
        },
      };
      if (!store) throw new Error("audit store unavailable");
      store.writeCapture(capture);
    },
    outcome: (event: any) => store?.writeEvent({ schemaVersion: AUDIT_SCHEMA_VERSION, format: AUDIT_FORMAT, ...event }),
    error: report,
  });

  pi.events.on("pi-workbench:working-mode", (value: any) => {
    if (validMode(value?.selected)) selectedMode = { ...value.selected };
    if (value?.phase === "applied" && validMode(value?.applied)) appliedMode = { ...value.applied };
  });

  pi.registerCommand("agent-audit", {
    description: "Explicitly start, stop, or inspect local provider-input capture",
    handler: async (args, ctx) => {
      const action = args.trim();
      if (action === "start") {
        if (enabled) { ctx.ui.notify(`Agent audit is already active. Preview ${previewId}.`, "info"); return; }
        if (ctx.mode !== "tui" || !isInside(checkoutRoot, ctx.cwd)) {
          ctx.ui.notify("Agent audit starts only in a Pi terminal inside this Workbench checkout.", "warning"); return;
        }
        const confirmed = await ctx.ui.confirm(
          "Start exact provider-input capture?",
          "This stores exact outgoing request bodies and prompts locally under .review/agent-audit until you explicitly clean them up. Prompt text can contain secrets; no redaction makes it safe.",
        );
        if (!confirmed) return;
        store = createAuditStore(auditRoot);
        const options = ctx.getSystemPromptOptions();
        const commands = pi.getCommands();
        const id = randomUUID();
        const base = await buildBasePrompt(options);
        const preview = buildPreviewSet(id, base, options, commands, pi);
        const installed = observer.install();
        if (!installed.ok) { ctx.ui.notify(`Agent audit remains OFF; transport observer installation failed (${installed.reason}). No preview was saved.`, "error"); return; }
        try { store.writePreview(preview); }
        catch (error) { observer.restore(); await observer.drain(); throw error; }
        enabled = true;
        activeSessionId = ctx.sessionManager.getSessionId();
        activeCtx = ctx;
        previewId = id;
        ctx.ui.setStatus("agent-audit", `Agent audit: ON · ${id.slice(0, 8)}`);
        const ws = installed.webSocket === "prototype-wrapped" ? "HTTP + Codex WebSocket" : "HTTP only; WebSocket unavailable";
        ctx.ui.notify(`Agent audit ON for this session (${ws}). Exact local evidence is retained until cleanup.`, installed.webSocket === "prototype-wrapped" ? "warning" : "error");
        return;
      }
      if (action === "stop") { await stop(ctx); return; }
      if (action === "status" || action === "") {
        ctx.ui.notify(enabled ? `Agent audit ON. Preview ${previewId}; local retention until explicit cleanup.` : "Agent audit OFF. Start explicitly with /agent-audit start.", "info");
        return;
      }
      ctx.ui.notify("Use /agent-audit start, /agent-audit stop, or /agent-audit status. Use the documented CLI for list/export/cleanup.", "warning");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const conflicts = enabled ? observer.restore() : [];
    const drained = enabled ? await observer.drain() : { complete: true, abandoned: 0 };
    if (!drained.complete) report(`session reset timed out; ${drained.abandoned} late observer task(s) were detached`);
    enabled = false; activeSessionId = null; activeCtx = null; previewId = null; run = null; logical = null; contextAtAuditHook = null; selectedMode = null; appliedMode = null;
    ctx.ui.setStatus("agent-audit", undefined);
    if (conflicts.length) ctx.ui.notify(`Agent audit reset was incomplete: ${conflicts.join("; ")}`, "error");
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (!activeFor(ctx)) return;
    const options = jsonValue(event.systemPromptOptions);
    const commands = pi.getCommands();
    run = {
      id: randomUUID(),
      previewSetId: previewId,
      options,
      sources: snapshotSources(options, commands),
      explicitSkillCommands: commands.filter((command) => command.source === "skill").map(commandEvidence),
      tools: toolEvidence(pi),
      promptInputs: {
        stage: "before_agent_start at this extension's load order",
        limitation: "Later extension hooks can change the system prompt.",
        userPrompt: event.prompt,
        systemPromptAtAuditHook: event.systemPrompt,
        structuredOptions: options,
      },
    };
  });

  pi.on("context", (event, ctx) => {
    if (activeFor(ctx)) contextAtAuditHook = jsonValue(event.messages);
  });

  pi.on("turn_start", (event, ctx) => { if (activeFor(ctx)) turnIndex = event.turnIndex; });

  pi.on("before_provider_request", (event, ctx) => {
    if (!activeFor(ctx)) return;
    if (!run) report("provider hook occurred without a before_agent_start snapshot");
    finishMissing(ctx, "replaced-by-next-logical-request");
    const coverage = providerCoverage(ctx.model);
    logical = {
      id: randomUUID(), run: run ?? fallbackRun(ctx, pi), turnIndex,
      appliedMode: appliedMode ? { ...appliedMode } : null, selectedMode: selectedMode ? { ...selectedMode } : null,
      payload: jsonValue(event.payload), context: contextAtAuditHook,
      provider: { provider: ctx.model?.provider ?? null, model: ctx.model?.id ?? null, api: ctx.model?.api ?? null, baseUrl: coverage.status === "supported" ? (ctx.model?.baseUrl ?? null) : null, coverage },
      coverage, session: session(ctx), transportIds: [], transportClosed: false, beforeEntryIds: ctx.sessionManager.getEntries().map((entry) => entry.id),
    };
  });

  pi.on("tool_execution_start", (_event, ctx) => { if (activeFor(ctx) && logical) logical.transportClosed = true; });
  pi.on("turn_end", (_event, ctx) => { if (activeFor(ctx)) finishLogical(ctx); });
  pi.on("agent_settled", (_event, ctx) => { if (activeFor(ctx)) finishMissing(ctx, "agent-settled-before-turn-link"); });
  pi.on("session_shutdown", async (_event, ctx) => { if (enabled) { finishMissing(ctx, "session-shutdown-before-turn-link"); await stop(ctx); } });

  function activeFor(ctx: ExtensionContext) {
    return enabled && ctx.mode === "tui" && ctx.sessionManager.getSessionId() === activeSessionId && isInside(checkoutRoot, ctx.cwd);
  }

  function finishLogical(ctx: ExtensionContext) {
    if (!logical) return;
    if (logical.transportIds.length === 0) recordMissing("missing", "No matching supported fetch/WebSocket send was observed in this logical request interval.");
    const allIds = ctx.sessionManager.getEntries().map((entry) => entry.id);
    const before = new Set(logical.beforeEntryIds);
    const entryIds = allIds.filter((id) => !before.has(id));
    for (const captureId of logical.transportIds) store!.writeEvent({
      schemaVersion: AUDIT_SCHEMA_VERSION, format: AUDIT_FORMAT, captureId, type: "native-output-link", at: new Date().toISOString(),
      groupId: logical.id, entryIds, sharedByCaptureIds: [...logical.transportIds],
      limitation: "Turn/attempt grouping from observable hook boundaries; no guessed one-to-one request/response correlation.",
    });
    logical = null;
  }

  function finishMissing(ctx: ExtensionContext, reason: string) {
    if (!logical) return;
    if (logical.transportIds.length === 0) recordMissing(logical.coverage.status === "unsupported" ? "unsupported" : "missing", reason);
    finishLogical(ctx);
  }

  function recordMissing(status: string, reason: string) {
    const id = randomUUID();
    logical.transportIds.push(id);
    store!.writeCapture({
      schemaVersion: AUDIT_SCHEMA_VERSION, format: AUDIT_FORMAT, id, timestamp: new Date().toISOString(), extensionVersion,
      capturePolicy: { optIn: "explicit current-session /agent-audit start confirmation", retention: "until explicit local cleanup", sensitivity: "Exact prompts can contain secrets." },
      runtime: runtimeVersions(), producerSources, session: logical.session,
      group: { runId: logical.run.id, logicalObservationId: logical.id, turnIndex: logical.turnIndex, attempt: null, correlation: "logical hook only" },
      provider: logical.provider, workingMode: { appliedToPrompt: logical.appliedMode, selectedNextTurnAtTransport: logical.selectedMode },
      transport: { kind: status, body: { status }, reason, claimLimit: "No actual provider send was observed." },
      logicalObservation: { stage: "before_provider_request at this extension's load order", payload: logical.payload, contextAtAuditHook: logical.context },
      previewSetId: logical.run.previewSetId,
      promptInputs: logical.run.promptInputs, sourceSnapshots: logical.run.sources,
      skills: { installedExplicitlyCallable: logical.run.explicitSkillCommands, advertisedCatalog: { status: "unknown", reason: "no transport payload" }, loadedSkillEvidence: { status: "unavailable", limitations: "No outgoing transport payload was observed; no conclusion about loaded skills is possible." } },
      activeTools: logical.run.tools, actualRequestInterpretation: { status: "unavailable", payload: null, instructionFields: [] },
    });
  }

  async function stop(ctx: ExtensionContext) {
    if (!enabled) { ctx.ui.notify("Agent audit is already OFF.", "info"); return; }
    const conflicts = observer.restore();
    const drained = await observer.drain();
    if (!drained.complete) report(`capture shutdown timed out; ${drained.abandoned} late observer task(s) were detached`);
    enabled = false; activeSessionId = null; activeCtx = null; run = null; logical = null; contextAtAuditHook = null;
    ctx.ui.setStatus("agent-audit", undefined);
    if (conflicts.length) {
      const message = `Agent audit reset was incomplete: ${conflicts.join("; ")}`;
      console.error(message); ctx.ui.notify(message, "error");
    } else ctx.ui.notify("Agent audit OFF. Existing local captures remain until explicit CLI cleanup.", "info");
  }
}

function buildPreviewSet(id: string, base: { prompt: string; evidence: any }, options: any, commands: any[], pi: ExtensionAPI) {
  const previews = [];
  for (const alignment of Object.keys(alignmentGuidance) as Array<keyof typeof alignmentGuidance>) {
    for (const checking of Object.keys(checkingGuidance) as Array<keyof typeof checkingGuidance>) {
      previews.push({
        id: `${alignment.toLowerCase()}-${checking}`, alignment, checking,
        label: "UNSENT Pi buildSystemPrompt(options) + Working Mode preview; excludes arbitrary extension hooks and provider serialization",
        systemPrompt: renderWorkingModePrompt(base.prompt, options, { alignment, checking }),
        advertisedSkills: visibleSkillsForMode(options.skills ?? [], checking).map(({ name }: any) => name),
      });
    }
  }
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION, format: `${AUDIT_FORMAT}.previews`, id, timestamp: new Date().toISOString(),
    runtime: runtimeVersions(), producerSources, extensionVersion, sourceSnapshots: snapshotSources(options, commands),
    installedExplicitlyCallable: commands.filter((command) => command.source === "skill").map(commandEvidence),
    activeTools: toolEvidence(pi), basePrompt: base.prompt,
    basePromptEvidence: { ...base.evidence, input: "ctx.getSystemPromptOptions()", limitation: "Built without reverse inference from a prior effective prompt; arbitrary extension hooks and provider serialization are excluded." }, previews,
  };
}

function fallbackRun(ctx: ExtensionContext, pi: ExtensionAPI) {
  return { id: randomUUID(), previewSetId: null, options: { cwd: ctx.cwd, skills: [] }, sources: { contextFiles: [], skills: [] }, explicitSkillCommands: pi.getCommands().filter((c) => c.source === "skill").map(commandEvidence), tools: toolEvidence(pi), promptInputs: { status: "missing" } };
}

function toolEvidence(pi: ExtensionAPI) {
  const active = new Set(pi.getActiveTools());
  return pi.getAllTools().filter((tool) => active.has(tool.name)).map((tool) => jsonValue({ name: tool.name, description: tool.description, parameters: tool.parameters, promptGuidelines: tool.promptGuidelines, sourceInfo: tool.sourceInfo }));
}

function commandEvidence(command: any) { return jsonValue({ invocationName: command.name, description: command.description ?? null, sourceInfo: command.sourceInfo }); }
function session(ctx: ExtensionContext) { return { sessionId: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile() ?? null, leafIdAtLogicalRequest: ctx.sessionManager.getLeafId() ?? null }; }

function instructionFields(payload: any, api: string | null) {
  const fields = [];
  if (api === "anthropic-messages" && payload.system !== undefined) fields.push({ path: "system", value: payload.system });
  if (api === "openai-codex-responses" && payload.instructions !== undefined) fields.push({ path: "instructions", value: payload.instructions });
  return fields;
}

function validMode(value: any): value is WorkingModeState {
  return Object.hasOwn(alignmentGuidance, value?.alignment) && Object.hasOwn(checkingGuidance, value?.checking);
}

export async function loadPiBasePrompt(options: any, argv1 = process.argv[1]) {
  const packages = runtimePackages(argv1), running = packages.piCodingAgent.runningProcess, extension = packages.piCodingAgent.extensionResolved;
  let source = running.status === "observed" ? running : extension;
  if (running.status === "observed" && !sourceSystemPrompt(source)) {
    if (extension.status !== "observed" || extension.version !== running.version)
      throw new Error("running Pi system-prompt.js is unavailable and the extension-resolved Pi version does not match; no preview was saved");
    source = extension;
  }
  const systemPromptPath = sourceSystemPrompt(source);
  if (!systemPromptPath) throw new Error("no reliable Pi system-prompt.js is available; no preview was saved");
  const module = await import(pathToFileURL(systemPromptPath).href);
  if (typeof module.buildSystemPrompt !== "function") throw new Error("resolved Pi buildSystemPrompt is unavailable; no preview was saved");
  return {
    prompt: module.buildSystemPrompt(options),
    evidence: {
      source: source === running ? "running-process-pi-installation" : "extension-resolved-pi-reimport",
      packageRoot: source.packageRoot, version: source.version, systemPromptPath,
      comparison: packages.piCodingAgent.comparison,
      limitation: source === running ? "Resolved from process.argv[1] to the nearest matching Pi package." : "Running Pi entry was unavailable; imported the extension-resolved installation instead.",
    },
  };
}

function sourceSystemPrompt(source: any) {
  if (source.status !== "observed") return null;
  const path = join(source.packageRoot, "dist", "core", "system-prompt.js");
  try { return realpathSync(path).startsWith(`${source.packageRoot}${process.platform === "win32" ? "\\" : "/"}`) ? path : null; } catch { return null; }
}

export function runtimePackages(argv1 = process.argv[1]) {
  const running = runningPackage("@earendil-works/pi-coding-agent", argv1), extension = resolvedPackage("@earendil-works/pi-coding-agent");
  const comparison = running.status !== "observed" || extension.status !== "observed" ? "unknown"
    : running.packageRoot === extension.packageRoot ? "same-installation"
      : running.version === extension.version ? "same-version-distinct-installations" : "version-mismatch";
  return { piCodingAgent: { version: running.status === "observed" ? running.version : extension.version, runningProcess: running, extensionResolved: extension, comparison }, piAi: resolvedPackage("@earendil-works/pi-ai") };
}
function runtimeVersions() { return { node: process.version, ...runtimePackages() }; }
function runningPackage(name: string, argv1: string | undefined) {
  if (!argv1) return { status: "unknown", resolution: "process.argv[1] unavailable" };
  try { return nearestPackage(name, realpathSync(argv1), "process.argv[1] nearest matching package"); }
  catch (error) { return { status: "unknown", resolution: "process.argv[1] could not be resolved", error: formatError(error) }; }
}
function resolvedPackage(name: string) {
  try { return nearestPackage(name, fileURLToPath(import.meta.resolve(name)), "extension module resolver"); }
  catch (error) { return { status: "unknown", version: "unknown", resolution: "extension package could not be established", error: formatError(error) }; }
}
function nearestPackage(name: string, entryPath: string, resolution: string) {
  let dir = dirname(entryPath);
  for (;;) {
    const packageJsonPath = join(dir, "package.json");
    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (manifest.name === name) return { status: "observed", version: manifest.version ?? "unknown", resolution, entryPath, packageRoot: realpathSync(dir), packageJsonPath: realpathSync(packageJsonPath) };
    } catch {}
    const parent = dirname(dir); if (parent === dir) break; dir = parent;
  }
  return { status: "unknown", version: "unknown", resolution: `${resolution}; no matching package ancestor`, entryPath };
}
