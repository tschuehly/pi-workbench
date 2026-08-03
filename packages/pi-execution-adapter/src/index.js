import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

const OUTCOMES = new Set(["success", "preflight_failed", "launch_failed", "execution_failed", "cancelled", "timed_out", "outcome_unknown"]);

export class PiRpcExecutionAdapter {
  constructor(options = {}) {
    this.command = options.command ?? "pi";
    this.concurrency = options.concurrency ?? 1;
    this.defaultTimeoutMs = options.timeoutMs ?? 20 * 60_000;
    this.bindingMaxAgeMs = options.bindingMaxAgeMs ?? 5 * 60_000;
    this.hostTools = new Set(options.hostTools ?? ["read", "bash", "grep", "find", "ls", "edit", "write"]);
    this.clock = options.clock ?? (() => new Date());
    this.spawn = options.spawn ?? nodeSpawn;
    this.killGraceMs = options.killGraceMs ?? 2_000;
    this.executions = new Map();
    this.activeCount = 0;
  }

  async dispatch(spec) {
    validateSpec(spec, this.hostTools, this.clock(), this.bindingMaxAgeMs);
    if (this.activeCount >= this.concurrency) throw typedError("CONCURRENCY_LIMIT", "The attended child concurrency cap is reached.");
    const executionId = randomUUID();
    const acceptedAt = this.clock().toISOString();
    const state = createState(executionId, spec, acceptedAt);
    this.executions.set(executionId, state);
    this.activeCount += 1;
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

  async cancel(executionId, reason) {
    const state = this.#state(executionId);
    if (state.done) {
      if (state.result.outcome === "cancelled" || state.result.outcome === "timed_out") return { executionId, outcome: "cancelled" };
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

  #state(executionId) {
    const state = this.executions.get(executionId);
    if (state === undefined) throw typedError("EXECUTION_NOT_FOUND", `Execution ${executionId} was not found.`);
    return state;
  }

  #launch(state) {
    const { spec } = state;
    const args = ["--mode", "rpc", "--provider", spec.binding.provider, "--model", spec.binding.model, "--thinking", spec.binding.effort, "--tools", spec.tools.join(","), "--name", `workbench-${spec.profile}-${state.executionId.slice(0, 8)}`];
    let child;
    try {
      child = this.spawn(this.command, args, { cwd: spec.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      state.child = child;
    } catch (error) {
      this.#finish(state, resultFor(state, "launch_failed", "", errorMessage(error)));
      return;
    }
    state.timeout = setTimeout(() => { state.cancelKind = "timed_out"; this.#emit(state, "timeout"); void this.#terminate(state); }, spec.timeoutMs ?? this.defaultTimeoutMs);
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
        this.#finish(state, resultFor(state, outcome, state.finalText, stderr || `Pi RPC exited (${String(code ?? signal)}).`));
      } else if (state.result?.outcome === "outcome_unknown") {
        this.#releaseSlot(state);
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
      return;
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      state.finalText = assistantText(event.message);
      const usage = event.message.usage;
      if (usage !== undefined) this.#emit(state, "usage", usage);
      return;
    }
    if (event.type === "tool_execution_start") this.#emit(state, "tool_start", { toolCallId: event.toolCallId, toolName: event.toolName });
    else if (event.type === "tool_execution_update") this.#emit(state, "tool_progress", { toolCallId: event.toolCallId, toolName: event.toolName });
    else if (event.type === "tool_execution_end") this.#emit(state, "tool_end", { toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError === true });
    else if (event.type === "extension_error") this.#emit(state, "diagnostic", { message: bounded(String(event.error ?? "Extension error"), 2_000) });
    else if (event.type === "agent_settled") void this.#completeSuccess(state);
  }

  async #completeSuccess(state) {
    if (state.done || state.completing || state.cancelKind !== undefined) return;
    state.completing = true;
    try {
      const current = await this.#command(state, "get_state");
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
    } catch (error) {
      if (!state.done) this.#finish(state, resultFor(state, "execution_failed", state.finalText, errorMessage(error)));
    }
  }

  #command(state, type) {
    if (state.done || state.child?.stdin?.destroyed) return Promise.reject(new Error("Pi RPC is unavailable."));
    const id = `${state.executionId}:${String(++state.commandSequence)}`;
    return new Promise((resolve, reject) => {
      const verifyInitialState = (data) => {
        const model = data?.model;
        if (model?.provider !== state.spec.binding.provider || model?.id !== state.spec.binding.model || data?.thinkingLevel !== state.spec.binding.effort) {
          reject(new Error("Runtime binding does not match the resolved binding."));
          void this.#terminate(state, "binding mismatch");
          return;
        }
        state.prompted = true;
        state.sessionId = data?.sessionId;
        this.#emit(state, "binding_verified", { provider: model.provider, model: model.id, effort: data.thinkingLevel });
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
    const id = `${state.executionId}:${String(++state.commandSequence)}`;
    state.commands.set(id, { command: "prompt", resolve: () => {}, reject: (error) => { if (!state.done) this.#finish(state, resultFor(state, "execution_failed", "", errorMessage(error))); } });
    state.child.stdin.write(`${JSON.stringify({ id, type: "prompt", message: state.spec.task })}\n`);
  }

  async #terminate(state) {
    if (state.done) return { executionId: state.executionId, outcome: state.result.outcome === "outcome_unknown" ? "outcome_unknown" : "cancelled" };
    try { state.child?.stdin?.write(`${JSON.stringify({ id: `${state.executionId}:abort`, type: "abort" })}\n`); } catch {}
    await delay(Math.min(100, this.killGraceMs));
    if (!state.closed) state.child?.kill?.("SIGTERM");
    await Promise.race([state.closePromise, delay(this.killGraceMs)]);
    if (!state.closed) state.child?.kill?.("SIGKILL");
    await Promise.race([state.closePromise, delay(this.killGraceMs)]);
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
    clearTimeout(state.timeout);
    if (result.outcome !== "outcome_unknown") this.#releaseSlot(state);
    this.#emit(state, "terminal", { outcome: result.outcome });
    for (const pending of state.commands.values()) pending.reject(new Error("Execution ended."));
    state.commands.clear();
    state.resultResolve(result);
  }

  #releaseSlot(state) {
    if (state.slotReleased) return;
    state.slotReleased = true;
    this.activeCount -= 1;
  }
}

function createState(executionId, spec, acceptedAt) {
  let resultResolve;
  let closeResolve;
  return { executionId, spec: structuredClone(spec), acceptedAt, observations: [], observationSequence: 0, waiters: new Set(), commands: new Map(), commandSequence: 0, done: false, closed: false, prompted: false, completing: false, finalText: "", resultPromise: new Promise((resolve) => { resultResolve = resolve; }), resultResolve, closePromise: new Promise((resolve) => { closeResolve = resolve; }), closeResolve };
}

function validateSpec(spec, hostTools, now, maxAgeMs) {
  if (!spec || typeof spec !== "object") throw typedError("INVALID_SPEC", "ResolvedExecutionSpec is required.");
  for (const field of ["task", "profile", "cognitiveRole", "cwd"]) if (typeof spec[field] !== "string" || spec[field].trim() === "") throw typedError("INVALID_SPEC", `${field} is required.`);
  if (!Array.isArray(spec.tools) || spec.tools.some((tool) => !hostTools.has(tool))) throw typedError("CAPABILITY_EXCEEDED", "Requested tools exceed the host capability ceiling.");
  const binding = spec.binding;
  if (!binding || binding.cognitiveRole !== spec.cognitiveRole || !binding.provider || !binding.model || !binding.effort) throw typedError("INVALID_BINDING", "Resolved binding does not match the requested Cognitive Role.");
  if (binding.quotaSnapshot?.stale !== false || binding.quotaSnapshot?.error !== null) throw typedError("STALE_BINDING", "Binding quota evidence is stale or invalid.");
  const freshness = binding.quotaSnapshot.refreshedAt ?? binding.quotaSnapshot.generatedAt;
  if (typeof freshness !== "string" || !Number.isFinite(Date.parse(freshness)) || now.valueOf() - Date.parse(freshness) > maxAgeMs || Date.parse(freshness) > now.valueOf() + 60_000) throw typedError("STALE_BINDING", "Binding quota evidence is not fresh.");
}

function resultFor(state, outcome, text = "", diagnostic) { const b = state.spec.binding; return { outcome, text: bounded(text, 50_000), profile: state.spec.profile, cognitiveRole: state.spec.cognitiveRole, provider: b.provider, model: b.model, effort: b.effort, ...(state.sessionId ? { sessionId: state.sessionId } : {}), ...(diagnostic ? { diagnostic: bounded(diagnostic, 8_000) } : {}) }; }
function assistantText(message) { return Array.isArray(message.content) ? message.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n") : ""; }
function typedError(code, message) { const error = new Error(message); error.code = code; return error; }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function bounded(value, max) { return value.length <= max ? value : `${value.slice(0, max)}…`; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function attachJsonl(stream, onValue, onError) { const decoder = new StringDecoder("utf8"); let buffer = ""; const consume = () => { for (;;) { const index = buffer.indexOf("\n"); if (index < 0) return; let line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (line.endsWith("\r")) line = line.slice(0, -1); if (!line) continue; try { onValue(JSON.parse(line)); } catch (error) { onError(error); } } }; stream?.on("data", (chunk) => { buffer += typeof chunk === "string" ? chunk : decoder.write(chunk); consume(); }); stream?.on("end", () => { buffer += decoder.end(); consume(); }); }
