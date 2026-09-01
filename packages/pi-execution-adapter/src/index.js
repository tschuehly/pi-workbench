import { spawn as nodeSpawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";

const OUTCOMES = new Set(["success", "preflight_failed", "launch_failed", "execution_failed", "cancelled", "outcome_unknown"]);
const INDEPENDENT_ROLES = new Set(["independent-judgment", "challenge", "independent-review"]);
const EXECUTION_KINDS = new Set(["subagent", "worker"]);
const DELEGATION_TOOLS = ["subagent", "subagent_collect", "subagent_status", "subagent_cancel"];

export class PiRpcExecutionAdapter {
  constructor(options = {}) {
    this.command = options.command ?? "pi";
    this.defaultStartupTimeoutMs = options.startupTimeoutMs ?? 15_000;
    this.bindingMaxAgeMs = options.bindingMaxAgeMs ?? 10 * 60_000;
    this.hostTools = new Set(options.hostTools ?? ["read", "bash", "grep", "find", "ls", "edit", "write", ...DELEGATION_TOOLS]);
    this.clock = options.clock ?? (() => new Date());
    this.spawn = options.spawn ?? nodeSpawn;
    this.killGraceMs = options.killGraceMs ?? 2_000;
    this.settlementProbeMs = options.settlementProbeMs ?? 5_000;
    this.resultMaxChars = options.resultMaxChars ?? 8_000;
    this.routingOverlayPath = options.routingOverlayPath ?? process.env.PI_WORKBENCH_ROUTING_OVERLAY;
    // A lead adapter puts each child in its own process group so cancelling a Worker also removes
    // the leaves it launched. Inside a Worker, leaves stay in the Worker's group instead, so an
    // individual leaf can be cancelled without killing its Worker.
    this.ownsProcessGroups = options.ownsProcessGroups ?? process.env.PI_WORKBENCH_EXECUTION_KIND !== "worker";
    this.executions = new Map();
  }

  async dispatch(spec) {
    const quotaDegradation = validateSpec(spec, this.hostTools, this.clock(), this.bindingMaxAgeMs, this.#routingOverlay());
    const executionId = randomUUID();
    const acceptedAt = this.clock().toISOString();
    const state = createState(executionId, spec, acceptedAt);
    state.kind = spec.kind ?? "subagent";
    state.ownsGroup = this.ownsProcessGroups;
    state.resultMaxChars = this.resultMaxChars;
    state.quotaAdmission = quotaDegradation === undefined ? spec.binding.admission : "degraded-quota-telemetry";
    state.quotaTelemetryStatus = quotaDegradation?.telemetryStatus ?? spec.binding.quotaSnapshot.telemetryStatus;
    this.executions.set(executionId, state);
    if (quotaDegradation !== undefined) this.#emit(state, "quota_degraded", quotaDegradation);
    this.#emit(state, "launch", { status: "starting" });
    this.#launch(state);
    return { executionId, acceptedAt };
  }

  async *observe(executionId) {
    const state = this.#state(executionId);
    let cursor = 0;
    while (true) {
      while (cursor < state.observations.length) yield structuredClone(state.observations[cursor++]);
      if (state.done) return;
      await new Promise((resolve) => state.waiters.add(resolve));
    }
  }

  result(executionId) {
    return this.#state(executionId).resultPromise;
  }

  status(executionId) {
    const state = this.#state(executionId);
    const latest = state.observations[state.observations.length - 1];
    const b = state.spec.binding;
    return {
      executionId,
      profile: state.spec.profile,
      cognitiveRole: state.spec.cognitiveRole,
      provider: b.provider,
      model: b.model,
      effort: b.effort,
      kind: state.kind,
      running: !state.done,
      outcome: state.done ? state.result.outcome : undefined,
      acceptedAt: state.acceptedAt,
      observationCount: state.observationSequence,
      latestObservation: latest === undefined ? undefined : { type: latest.type, at: latest.at, detail: structuredClone(latest.detail) },
      sessionId: state.sessionId ?? (state.done ? state.result.sessionId : undefined),
    };
  }

  list() {
    return [...this.executions.values()].map((state) => ({
      executionId: state.executionId,
      profile: state.spec.profile,
      cognitiveRole: state.spec.cognitiveRole,
      kind: state.kind,
      running: !state.done,
      outcome: state.done ? state.result.outcome : undefined,
      acceptedAt: state.acceptedAt,
    }));
  }

  async cancel(executionId, reason) {
    const state = this.#state(executionId);
    if (state.done) {
      if (state.result.outcome === "cancelled") return { executionId, outcome: "cancelled" };
      if (state.result.outcome === "outcome_unknown") return { executionId, outcome: "outcome_unknown" };
      throw typedError("EXECUTION_TERMINAL", `Execution ${executionId} already ended with ${state.result.outcome}.`);
    }
    state.cancelKind = "cancelled";
    this.#emit(state, "cancellation", { reason });
    return this.#terminate(state);
  }

  async cancelAll(reason) {
    return Promise.all([...this.executions.values()].filter((state) => !state.done).map((state) => this.cancel(state.executionId, reason)));
  }

  // Read once per adapter: an active overlay must be readable here too, or a nested Pi that never
  // received it would silently resolve default routing.
  #routingOverlay() {
    if (this.routingOverlayPath === undefined || this.routingOverlayPath === "") return undefined;
    if (this.overlayCache === undefined) {
      let raw;
      try {
        raw = readFileSync(this.routingOverlayPath, "utf8");
      } catch (error) {
        throw typedError("ROUTING_OVERLAY_UNAVAILABLE", `Active routing overlay is unreadable: ${errorMessage(error)}`);
      }
      let doc;
      try {
        doc = JSON.parse(raw);
      } catch (error) {
        throw typedError("ROUTING_OVERLAY_UNAVAILABLE", `Active routing overlay is not valid JSON: ${errorMessage(error)}`);
      }
      const allowed = new Set((Array.isArray(doc.allowedModels) ? doc.allowedModels : []).map((entry) => `${entry?.provider}/${entry?.model}`));
      if (allowed.size === 0) throw typedError("ROUTING_OVERLAY_UNAVAILABLE", "Active routing overlay lists no allowed model.");
      this.overlayCache = { path: this.routingOverlayPath, sha256: createHash("sha256").update(raw).digest("hex"), allowed };
    }
    return this.overlayCache;
  }

  #state(executionId) {
    const state = this.executions.get(executionId);
    if (state === undefined) throw typedError("EXECUTION_NOT_FOUND", `Execution ${executionId} was not found.`);
    return state;
  }

  #launch(state) {
    const { spec } = state;
    const args = ["--mode", "rpc", "--provider", spec.binding.provider, "--model", spec.binding.model, "--thinking", spec.binding.effort, "--tools", spec.tools.join(",")];
    if (spec.continuation === undefined) args.push("--name", `workbench-${spec.profile}-${state.executionId.slice(0, 8)}`);
    else args.push("--session", spec.continuation.sessionId);
    const env = { ...process.env, PI_TELEMETRY_EXECUTION_ID: state.executionId, PI_WORKBENCH_EXECUTION_KIND: state.kind };
    if (spec.parentSessionId === undefined) delete env.PI_TELEMETRY_PARENT_SESSION_ID;
    else env.PI_TELEMETRY_PARENT_SESSION_ID = spec.parentSessionId;
    // A concept-bound Worker phase makes every leaf it launches concept-bound too, so per-concept
    // telemetry keeps the nested work instead of attributing it to no concept at all.
    if (spec.telemetryConcept === undefined) delete env.PI_WORKBENCH_TELEMETRY_CONCEPT;
    else env.PI_WORKBENCH_TELEMETRY_CONCEPT = spec.telemetryConcept;
    if (this.routingOverlayPath === undefined || this.routingOverlayPath === "") delete env.PI_WORKBENCH_ROUTING_OVERLAY;
    else env.PI_WORKBENCH_ROUTING_OVERLAY = this.routingOverlayPath;
    let child;
    try {
      child = this.spawn(this.command, args, { cwd: spec.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"], env, detached: state.ownsGroup });
      state.child = child;
      if (state.ownsGroup) child.unref?.();
    } catch (error) {
      this.#finish(state, resultFor(state, "launch_failed", "", errorMessage(error)));
      return;
    }
    const startupTimeoutMs = this.defaultStartupTimeoutMs;
    state.startupTimeout = setTimeout(() => {
      if (state.done || state.phase !== "starting") return;
      state.phase = "startup_failed";
      state.cancelKind = "launch_failed";
      state.cancelDiagnostic = `startup_timeout: Pi RPC did not answer get_state within ${startupTimeoutMs} ms; process terminated before prompt.`;
      this.#emit(state, "startup_timeout", { timeoutMs: startupTimeoutMs });
      void this.#terminate(state);
    }, startupTimeoutMs);
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr = bounded(`${stderr}${String(chunk)}`, 8_000); });
    attachJsonl(child.stdout, (event) => { this.#event(state, event); }, (error) => { this.#emit(state, "diagnostic", { message: errorMessage(error) }); });
    child.on("error", (error) => { if (!state.done) this.#finish(state, resultFor(state, "launch_failed", "", errorMessage(error))); });
    child.on("close", (code, signal) => {
      state.closed = true;
      state.closeCode = code;
      state.closeSignal = signal;
      state.closeResolve?.();
      if (!state.done) {
        const outcome = state.cancelKind ?? (state.prompted ? (code === 0 ? "outcome_unknown" : "execution_failed") : "launch_failed");
        const diagnostic = state.cancelDiagnostic ?? (stderr || `Pi RPC exited (${String(code ?? signal)}).`);
        this.#finish(state, resultFor(state, outcome, state.finalText, diagnostic));
      }
    });
    void this.#command(state, "get_state").catch((error) => {
      if (!state.done) this.#finish(state, resultFor(state, state.prompted ? "execution_failed" : "launch_failed", "", errorMessage(error)));
    });
  }

  #event(state, event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "response") {
      const pending = state.commands.get(event.id);
      if (pending !== undefined) {
        state.commands.delete(event.id);
        if (event.success) pending.resolve(event.data);
        else pending.reject(new Error(String(event.error ?? `${pending.command} failed`)));
      }
      return;
    }
    if (event.type === "message_update") {
      const delta = event.assistantMessageEvent;
      if (delta?.type === "text_delta") this.#emit(state, "assistant_progress", { characters: String(delta.delta ?? "").length });
      else if (delta?.type === "thinking_start" || delta?.type === "thinking_delta") this.#emit(state, "thinking_progress", { characters: String(delta.delta ?? "").length });
      return;
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      state.finalText = assistantText(event.message);
      const usage = event.message.usage;
      if (usage !== undefined) this.#emit(state, "usage", usage);
      if (event.message.stopReason !== "toolUse") this.#scheduleSettlementProbe(state);
      return;
    }
    if (event.type === "tool_execution_start") {
      const action = summarizeToolAction(event.toolName, event.args);
      state.toolActions.set(event.toolCallId, action);
      this.#emit(state, "tool_start", { toolCallId: event.toolCallId, toolName: event.toolName, action });
    } else if (event.type === "tool_execution_update") {
      this.#emit(state, "tool_progress", { toolCallId: event.toolCallId, toolName: event.toolName, action: state.toolActions.get(event.toolCallId) ?? summarizeToolAction(event.toolName, event.args) });
    } else if (event.type === "tool_execution_end") {
      const action = state.toolActions.get(event.toolCallId) ?? String(event.toolName ?? "tool");
      state.toolActions.delete(event.toolCallId);
      this.#emit(state, "tool_end", { toolCallId: event.toolCallId, toolName: event.toolName, action, isError: event.isError === true });
    }
    else if (event.type === "extension_error") this.#emit(state, "diagnostic", { message: bounded(String(event.error ?? "Extension error"), 2_000) });
    else if (event.type === "agent_settled") void this.#completeSuccess(state);
  }

  #scheduleSettlementProbe(state) {
    if (state.done || state.cancelKind !== undefined || state.settlementTimer !== undefined) return;
    state.settlementTimer = setTimeout(() => {
      state.settlementTimer = undefined;
      void this.#probeSettlement(state);
    }, this.settlementProbeMs);
  }

  async #probeSettlement(state) {
    if (state.done || state.completing || state.cancelKind !== undefined) return;
    state.completing = true;
    try {
      const current = await this.#command(state, "get_state");
      const idle = current?.isStreaming === false && current?.isCompacting === false && current?.pendingMessageCount === 0;
      if (idle) {
        this.#emit(state, "settlement_reconciled", { reason: "terminal output with idle RPC state" });
        await this.#finishSuccess(state, current);
        return;
      }
    } catch (error) {
      if (!state.done) this.#emit(state, "diagnostic", { message: `Settlement probe failed: ${errorMessage(error)}` });
    } finally {
      if (!state.done) state.completing = false;
    }
    this.#scheduleSettlementProbe(state);
  }

  async #completeSuccess(state) {
    if (state.done || state.completing || state.cancelKind !== undefined) return;
    clearTimeout(state.settlementTimer);
    state.settlementTimer = undefined;
    state.completing = true;
    try {
      const current = await this.#command(state, "get_state");
      await this.#finishSuccess(state, current);
    } catch (error) {
      if (!state.done) this.#finish(state, resultFor(state, "execution_failed", state.finalText, errorMessage(error)));
    }
  }

  async #finishSuccess(state, current) {
    const reportedProvider = current?.model?.provider;
    const reportedModel = current?.model?.id;
    const reportedEffort = current?.thinkingLevel;
    if (reportedProvider !== state.spec.binding.provider || reportedModel !== state.spec.binding.model || reportedEffort !== state.spec.binding.effort) {
      await this.#terminate(state, "binding mismatch");
      if (!state.done) this.#finish(state, resultFor(state, "execution_failed", "", `Runtime binding mismatch: ${String(reportedProvider)}/${String(reportedModel)}:${String(reportedEffort)}`));
      return;
    }
    this.#emit(state, "binding_verified", { provider: reportedProvider, model: reportedModel, effort: reportedEffort });
    this.#finish(state, { ...resultFor(state, "success", state.finalText), sessionId: current.sessionId });
    state.child?.stdin?.end();
    void this.#retireSuccessfulProcess(state);
  }

  async #retireSuccessfulProcess(state) {
    await this.#waitForClose(state, this.killGraceMs);
    if (!state.closed) this.#signal(state, "SIGTERM");
    await this.#waitForClose(state, this.killGraceMs);
    if (!state.closed) this.#signal(state, "SIGKILL");
  }

  // Group-owning launches are signalled as a whole group so a Worker's uncollected leaves die with
  // it; a leaf launched from inside a Worker is signalled alone.
  #signal(state, signal) {
    const pid = state.child?.pid;
    if (state.ownsGroup && typeof pid === "number") {
      try {
        process.kill(-pid, signal);
        return;
      } catch (error) {
        if (error?.code === "ESRCH") return;
      }
    }
    state.child?.kill?.(signal);
  }

  async #waitForClose(state, timeoutMs) {
    if (state.closed) return;
    let timer;
    await Promise.race([
      state.closePromise,
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
    clearTimeout(timer);
  }

  #command(state, type) {
    if (state.done || state.child?.stdin?.destroyed) return Promise.reject(new Error("Pi RPC is unavailable."));
    const id = `${state.executionId}:${String(++state.commandSequence)}`;
    return new Promise((resolve, reject) => {
      const verifyInitialState = (data) => {
        if (state.done || state.phase !== "starting") return;
        clearTimeout(state.startupTimeout);
        state.startupTimeout = undefined;
        const model = data?.model;
        if (model?.provider !== state.spec.binding.provider || model?.id !== state.spec.binding.model || data?.thinkingLevel !== state.spec.binding.effort) {
          state.phase = "startup_failed";
          reject(new Error("Runtime binding does not match the resolved binding."));
          void this.#terminate(state, "binding mismatch");
          return;
        }
        const continuation = state.spec.continuation;
        if (continuation !== undefined && data?.sessionId !== continuation.sessionId) {
          state.phase = "startup_failed";
          reject(new Error(`Resumed session ${String(data?.sessionId)} does not match the requested continuation session.`));
          void this.#terminate(state, "continuation mismatch");
          return;
        }
        state.phase = "ready";
        state.sessionId = data?.sessionId;
        this.#emit(state, "binding_verified", { provider: model.provider, model: model.id, effort: data.thinkingLevel });
        if (continuation !== undefined) this.#emit(state, "continuation_verified", { sessionId: continuation.sessionId });
        queueMicrotask(() => { if (!state.done) this.#sendPrompt(state); });
        resolve(data);
      };
      state.commands.set(id, { command: type, resolve: type === "get_state" && !state.prompted ? verifyInitialState : resolve, reject });
      state.child.stdin.write(`${JSON.stringify({ id, type })}\n`, (error) => {
        if (error !== null && error !== undefined) { state.commands.delete(id); reject(error); }
      });
    });
  }

  #sendPrompt(state) {
    if (state.done || state.phase !== "ready" || state.cancelKind !== undefined) return;
    state.phase = "prompt_submitted";
    state.prompted = true;
    const id = `${state.executionId}:${String(++state.commandSequence)}`;
    state.commands.set(id, { command: "prompt", resolve: () => {}, reject: (error) => { if (!state.done) this.#finish(state, resultFor(state, "execution_failed", "", errorMessage(error))); } });
    state.child.stdin.write(`${JSON.stringify({ id, type: "prompt", message: state.spec.task })}\n`);
  }

  async #terminate(state) {
    if (state.done) return { executionId: state.executionId, outcome: state.result.outcome === "outcome_unknown" ? "outcome_unknown" : "cancelled" };
    try { state.child?.stdin?.write(`${JSON.stringify({ id: `${state.executionId}:abort`, type: "abort" })}\n`); } catch {}
    await delay(Math.min(100, this.killGraceMs));
    if (!state.closed) this.#signal(state, "SIGTERM");
    await this.#waitForClose(state, this.killGraceMs);
    if (!state.closed) this.#signal(state, "SIGKILL");
    await this.#waitForClose(state, this.killGraceMs);
    const outcome = state.closed ? (state.cancelKind ?? "cancelled") : "outcome_unknown";
    if (!state.done) this.#finish(state, resultFor(state, outcome, state.finalText, state.closed ? undefined : "Process termination could not be confirmed."));
    return { executionId: state.executionId, outcome: outcome === "outcome_unknown" ? "outcome_unknown" : "cancelled" };
  }

  #emit(state, type, detail) {
    state.observations.push({ executionId: state.executionId, sequence: ++state.observationSequence, at: this.clock().toISOString(), type, ...(detail === undefined ? {} : { detail: structuredClone(detail) }) });
    if (state.observations.length > 200) state.observations.shift();
    for (const waiter of state.waiters) waiter();
    state.waiters.clear();
  }

  #finish(state, result) {
    if (state.done) return;
    if (!OUTCOMES.has(result.outcome)) throw new Error(`Invalid outcome ${result.outcome}`);
    state.done = true;
    state.result = result;
    clearTimeout(state.startupTimeout);
    clearTimeout(state.settlementTimer);
    state.settlementTimer = undefined;
    this.#emit(state, "terminal", { outcome: result.outcome });
    for (const pending of state.commands.values()) pending.reject(new Error("Execution ended."));
    state.commands.clear();
    state.resultResolve(result);
  }

}

function createState(executionId, spec, acceptedAt) {
  let resultResolve;
  let closeResolve;
  return { executionId, spec: structuredClone(spec), acceptedAt, observations: [], observationSequence: 0, waiters: new Set(), commands: new Map(), commandSequence: 0, toolActions: new Map(), done: false, closed: false, prompted: false, phase: "starting", completing: false, finalText: "", resultPromise: new Promise((resolve) => { resultResolve = resolve; }), resultResolve, closePromise: new Promise((resolve) => { closeResolve = resolve; }), closeResolve };
}

export function summarizeToolAction(toolName, args) {
  const path = concisePath(args?.path);
  if (toolName === "read") return bounded(`reading ${path ?? "file"}`, 56);
  if (toolName === "edit") return bounded(`editing ${path ?? "file"}`, 56);
  if (toolName === "write") return bounded(`writing ${path ?? "file"}`, 56);
  if (toolName === "ls") return bounded(`listing ${path ?? "files"}`, 56);
  if (toolName === "grep") return bounded(`searching ${concisePath(args?.path) ?? "files"}`, 56);
  if (toolName === "find") return bounded(`finding ${concisePath(args?.path) ?? "files"}`, 56);
  if (toolName === "bash" || toolName === "powershell") return bounded(`running ${safeCommandName(args?.command) ?? toolName}`, 56);
  return cleanText(toolName) || "working";
}

function concisePath(value) {
  const parts = cleanText(value).split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || undefined;
}

function cleanText(value) {
  return stripVTControlCharacters(String(value ?? "")).replace(/\s+/g, " ").trim();
}

function safeCommandName(value) {
  const parts = cleanText(value).split(" ");
  const executable = parts[0]?.split(/[\\/]/).at(-1);
  if (!["npm", "pnpm", "yarn", "git", "node", "python", "python3", "mvn", "gradle", "gradlew", "cargo", "go"].includes(executable)) return undefined;
  const safe = parts.slice(1, executable === "npm" && parts[1] === "run" ? 3 : 2).filter((part) => /^[\w.:-]+$/.test(part) && !/(?:token|secret|password|key)/i.test(part));
  return [executable, ...safe].join(" ");
}

function validateSpec(spec, hostTools, now, maxAgeMs, overlay) {
  if (!spec || typeof spec !== "object") throw typedError("INVALID_SPEC", "ResolvedExecutionSpec is required.");
  for (const field of ["task", "profile", "cognitiveRole", "cwd"]) if (typeof spec[field] !== "string" || spec[field].trim() === "") throw typedError("INVALID_SPEC", `${field} is required.`);
  if (!Array.isArray(spec.tools) || spec.tools.some((tool) => !hostTools.has(tool))) throw typedError("CAPABILITY_EXCEEDED", "Requested tools exceed the host capability ceiling.");
  const kind = spec.kind ?? "subagent";
  if (!EXECUTION_KINDS.has(kind)) throw typedError("INVALID_SPEC", `kind must be one of ${[...EXECUTION_KINDS].join(", ")}.`);
  if (spec.continuation !== undefined && (typeof spec.continuation !== "object" || spec.continuation === null || typeof spec.continuation.sessionId !== "string" || spec.continuation.sessionId.trim() === "")) {
    throw typedError("INVALID_SPEC", "continuation.sessionId must be a non-empty string when continuation is present.");
  }
  if (spec.parentSessionId !== undefined && (typeof spec.parentSessionId !== "string" || spec.parentSessionId.trim() === "")) {
    throw typedError("INVALID_SPEC", "parentSessionId must be a non-empty string when present.");
  }
  if (spec.telemetryConcept !== undefined && (typeof spec.telemetryConcept !== "string" || spec.telemetryConcept.trim() === "")) {
    throw typedError("INVALID_SPEC", "telemetryConcept must be a non-empty string when present.");
  }
  const binding = spec.binding;
  if (!binding || binding.cognitiveRole !== spec.cognitiveRole || !binding.provider || !binding.model || !binding.effort) throw typedError("INVALID_BINDING", "Resolved binding does not match the requested Cognitive Role.");
  // The overlay must reach every nested Pi. A binding resolved without it, or against different
  // bytes, means routing was not actually narrowed and must fail closed.
  if (overlay === undefined) {
    if (binding.routingOverlay !== undefined) throw typedError("INVALID_BINDING", "Binding records a routing overlay that is not active in this process.");
  } else if (binding.routingOverlay?.path !== overlay.path || binding.routingOverlay?.sha256 !== overlay.sha256) {
    throw typedError("INVALID_BINDING", "Binding was not resolved against the active routing overlay bytes.");
  } else if (!overlay.allowed.has(`${binding.provider}/${binding.model}`)) {
    throw typedError("INVALID_BINDING", `Binding model ${binding.provider}/${binding.model} is outside the active routing overlay allowlist.`);
  }
  if (INDEPENDENT_ROLES.has(spec.cognitiveRole)) {
    const independence = binding.independence;
    if (independence?.kind === "fresh-context-distinct-model") {
      // Under an explicit overlay, independence is fresh context on a distinct model rather than a
      // second provider family.
      if (overlay === undefined) throw typedError("INVALID_BINDING", "Distinct-model independence requires an active routing overlay.");
      if (spec.continuation !== undefined) throw typedError("INVALID_BINDING", "Independent Cognitive Roles require fresh context, not a resumed session.");
      const author = `${independence.authorProvider}/${independence.authorModel}`;
      const selected = `${independence.selectedProvider}/${independence.selectedModel}`;
      if (selected !== `${binding.provider}/${binding.model}`) throw typedError("INVALID_BINDING", "Independence metadata does not describe the resolved binding.");
      if (author === selected) throw typedError("INVALID_BINDING", "Independent review must run on a different model than the recorded author model.");
      if (!overlay.allowed.has(author)) throw typedError("INVALID_BINDING", `Recorded author model ${author} is outside the active routing overlay allowlist.`);
    } else {
      const selectedFamily = providerFamily(binding.provider);
      const independentOfFamily = providerFamily(independence?.independentOfProvider);
      if (!independence || independentOfFamily === undefined || independence.independentOfFamily !== independentOfFamily || independence.independentOfFamily === independence.selectedFamily || independence.selectedFamily !== selectedFamily) {
        throw typedError("INVALID_BINDING", "Independent Cognitive Roles require a verified cross-family binding.");
      }
    }
  } else if (binding.independence !== undefined) {
    throw typedError("INVALID_BINDING", "Independence metadata is valid only for an independent Cognitive Role.");
  }
  if (!["fresh-quota", "degraded-quota-telemetry"].includes(binding.admission)) throw typedError("INVALID_BINDING", "Binding quota admission is invalid.");
  const quota = binding.quotaSnapshot;
  if (!quota || !["fresh", "stale", "unavailable"].includes(quota.telemetryStatus) || !Array.isArray(quota.relevantWindows)) throw typedError("INVALID_BINDING", "Binding quota telemetry is invalid.");
  if (binding.admission === "degraded-quota-telemetry") {
    if (quota.telemetryStatus === "fresh") throw typedError("INVALID_BINDING", "Degraded quota admission requires stale or unavailable telemetry.");
    return { telemetryStatus: quota.telemetryStatus, error: quota.error };
  }
  if (quota.telemetryStatus !== "fresh" || quota.stale !== false || quota.error !== null) throw typedError("INVALID_BINDING", "Fresh quota admission requires fresh, valid telemetry.");
  if (quota.relevantWindows.some((window) => Number(window?.percentRemaining) <= 0)) throw typedError("QUOTA_EXHAUSTED", "Fresh quota evidence confirms an exhausted relevant window.");
  const freshness = quota.refreshedAt ?? quota.generatedAt;
  if (typeof freshness !== "string" || !Number.isFinite(Date.parse(freshness)) || now.valueOf() - Date.parse(freshness) > maxAgeMs || Date.parse(freshness) > now.valueOf() + 60_000) {
    return { telemetryStatus: "stale", error: "Quota binding evidence exceeded the freshness window." };
  }
}

function resultFor(state, outcome, text = "", diagnostic) {
  const b = state.spec.binding;
  const max = state.resultMaxChars ?? 8_000;
  const truncated = text.length > max;
  return {
    outcome,
    text: truncated ? `${text.slice(0, max)}…\n\n[TRUNCATED at ${max} characters. A truncated result is evidence of an oversized assignment and cannot satisfy verification; re-run a narrower bounded task.]` : text,
    truncated,
    kind: state.kind ?? "subagent",
    profile: state.spec.profile,
    cognitiveRole: state.spec.cognitiveRole,
    provider: b.provider, model: b.model, effort: b.effort,
    quotaAdmission: state.quotaAdmission, quotaTelemetryStatus: state.quotaTelemetryStatus,
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    ...(diagnostic ? { diagnostic: bounded(diagnostic, 8_000) } : {}),
  };
}
function providerFamily(provider) {
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai" || provider === "openai-codex") return "openai";
  return undefined;
}
function assistantText(message) { return Array.isArray(message.content) ? message.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n") : ""; }
function typedError(code, message) { const error = new Error(message); error.code = code; return error; }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function bounded(value, max) { return value.length <= max ? value : `${value.slice(0, max)}…`; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function attachJsonl(stream, onValue, onError) { const decoder = new StringDecoder("utf8"); let buffer = ""; const consume = () => { for (;;) { const index = buffer.indexOf("\n"); if (index < 0) return; let line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (line.endsWith("\r")) line = line.slice(0, -1); if (!line) continue; try { onValue(JSON.parse(line)); } catch (error) { onError(error); } } }; stream?.on("data", (chunk) => { buffer += typeof chunk === "string" ? chunk : decoder.write(chunk); consume(); }); stream?.on("end", () => { buffer += decoder.end(); consume(); }); }
