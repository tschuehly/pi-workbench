import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, openSync, closeSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import { zstdDecompressSync } from "node:zlib";

export const AUDIT_SCHEMA_VERSION = 1;
export const AUDIT_FORMAT = "pi-workbench.agent-input-audit";
const ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const jsonValue = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item));

export function isInside(root, cwd) {
  try {
    const target = statSync(cwd).isDirectory() ? realpathSync(cwd) : "";
    return target === root || target.startsWith(`${root}${sep}`);
  } catch { return false; }
}

export function assertSafeAuditRoot(root, { create = false } = {}) {
  const base = resolve(root);
  const chain = [];
  for (let current = base;; current = dirname(current)) {
    chain.push(current);
    if (dirname(current) === current) break;
  }
  for (const path of chain.reverse()) {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe audit path component: ${path}`);
    } catch (error) {
      if (error?.code !== "ENOENT" || !create) throw error;
      mkdirSync(path, { mode: 0o700 });
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe audit path component: ${path}`);
    }
  }
  return base;
}

function safeDirectory(base, name, create = false) {
  const path = join(base, name);
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe audit directory: ${path}`);
  } catch (error) {
    if (error?.code !== "ENOENT" || !create) throw error;
    mkdirSync(path, { mode: 0o700 });
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe audit directory: ${path}`);
  }
  return path;
}

function safeFile(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`unsafe audit record: ${path}`);
  return path;
}

export function createAuditStore(root) {
  const base = assertSafeAuditRoot(root, { create: true });
  for (const name of ["captures", "events", "previews", "exports"]) {
    const dir = safeDirectory(base, name, true);
    chmodSync(dir, 0o700);
    if (name === "exports") chmodSync(safeDirectory(dir, ".access", true), 0o700);
  }
  chmodSync(base, 0o700);
  const writeImmutable = (kind, id, value) => {
    if (!ID.test(id)) throw new Error(`invalid audit identity: ${id}`);
    assertSafeAuditRoot(base);
    const folder = kind === "capture" ? "captures" : kind === "preview" ? "previews" : "events";
    const suffix = kind === "event" ? `.${randomUUID()}` : "";
    const directory = safeDirectory(base, folder);
    const path = join(directory, `${id}${suffix}.json`);
    const fd = openSync(path, "wx", 0o600);
    try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); }
    finally { closeSync(fd); }
    return path;
  };
  return {
    root: base,
    writeCapture(value) { return writeImmutable("capture", value.id, value); },
    writeEvent(value) { return writeImmutable("event", value.captureId, value); },
    writePreview(value) { return writeImmutable("preview", value.id, value); },
  };
}

export function snapshotSources(options, commands = []) {
  const contextFiles = (options.contextFiles ?? []).map((file) => sourceSnapshot(file.path, file.content, "context-file"));
  const byPath = new Map();
  for (const skill of options.skills ?? []) byPath.set(skill.filePath, { ...skill, availability: "loaded-catalog-source" });
  for (const command of commands.filter((item) => item.source === "skill")) {
    const path = command.sourceInfo?.path;
    if (path && !byPath.has(path)) byPath.set(path, {
      name: command.name.replace(/:\d+$/, ""), filePath: path, sourceInfo: command.sourceInfo,
      disableModelInvocation: true, availability: "installed-explicit-command",
    });
  }
  const skills = [...byPath.values()].map((skill) => ({
    name: skill.name,
    description: skill.description ?? null,
    filePath: skill.filePath,
    baseDir: skill.baseDir ?? null,
    sourceInfo: jsonValue(skill.sourceInfo ?? null),
    disableModelInvocation: skill.disableModelInvocation === true,
    availability: skill.availability,
    loadedSourceContent: null,
    diskAtCapture: diskSnapshot(skill.filePath),
  }));
  return { contextFiles, skills };
}

function sourceSnapshot(path, loadedContent, kind) {
  return {
    kind, path,
    loadedSourceContent: { content: loadedContent, sha256: sha256(loadedContent), bytes: Buffer.byteLength(loadedContent) },
    diskAtCapture: diskSnapshot(path),
  };
}

export function snapshotFileVersion(path, role) {
  return { role, path, evidence: "disk bytes read when this extension module loaded; exact saved prompts/request bytes remain primary evidence", ...diskSnapshot(path) };
}

function diskSnapshot(path) {
  try {
    const content = readFileSync(path, "utf8");
    return { status: "observed", content, sha256: sha256(content), bytes: Buffer.byteLength(content) };
  } catch (error) {
    return { status: "missing", error: error instanceof Error ? error.message : String(error) };
  }
}

export function providerCoverage(model) {
  const api = model?.api ?? null;
  const baseUrl = model?.baseUrl ?? "";
  const rawBase = baseUrl.trim() || (api === "openai-codex-responses" ? "https://chatgpt.com/backend-api" : "https://api.anthropic.com");
  let parsedBase;
  try { parsedBase = new URL(rawBase); } catch { return { status:"unsupported", api, provider:model?.provider ?? null, httpUrl:null, webSocketUrl:null, limitations:"invalid provider base URL" }; }
  if (parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash)
    return { status:"unsupported", api, provider:model?.provider ?? null, httpUrl:null, webSocketUrl:null, limitations:"provider URLs containing credentials, query parameters, or fragments are not captured" };
  if (api === "openai-codex-responses") {
    const normalized = rawBase.replace(/\/+$/, "");
    const http = normalized.endsWith("/codex/responses") ? normalized : normalized.endsWith("/codex") ? `${normalized}/responses` : `${normalized}/codex/responses`;
    const ws = new URL(http); ws.protocol = ws.protocol === "http:" ? "ws:" : "wss:";
    return { status: "supported", api, provider: model.provider, httpUrl: new URL(http).toString(), webSocketUrl: ws.toString(), limitations: "HTTP fetch and Node global WebSocket send only" };
  }
  if (api === "anthropic-messages") {
    const base = rawBase.replace(/\/+$/, "");
    return { status: "supported", api, provider: model.provider, httpUrl: new URL(`${base}/v1/messages`).toString(), webSocketUrl: null, limitations: "Anthropic SDK fetch transport only" };
  }
  return { status: "unsupported", api, provider: model?.provider ?? null, httpUrl: null, webSocketUrl: null, limitations: "This audit slice supports Anthropic HTTP/SSE and Codex HTTP/SSE or Node WebSocket" };
}

export function createTransportObserver({ current, capture, outcome, error, drainTimeoutMs = 1000 }) {
  const pending = new Map();
  let installation = null;

  const report = (problem) => {
    try {
      const result = error(problem);
      if (result?.then) result.catch((nested) => console.error("agent audit error callback failed:", formatError(nested)));
    } catch (nested) { console.error("agent audit error callback failed:", formatError(nested)); }
  };
  const track = (task, job) => {
    const settled = Promise.resolve(task).catch((problem) => { if (job.accept) report(problem); }).finally(() => pending.delete(settled));
    pending.set(settled, job);
  };
  const observe = (logical, transport, url, data, metadata, send) => {
    const id = randomUUID(), sentAt = new Date().toISOString(), job = { accept: true };
    logical.transportIds.push(id);
    const body = bodyEvidence(data, metadata.contentEncoding);
    const save = (sendOutcome, thrown = null) => track(body.then((evidence) => {
      if (job.accept) return capture({ id, sentAt, transport, url, metadata, body: evidence, sendOutcome, error: thrown && formatError(thrown), logical });
    }), job);
    let result;
    try { result = send(); }
    catch (thrown) { save("threw", thrown); throw thrown; }
    save("invoked");
    if (transport === "http-fetch") track(Promise.resolve(result).then(
      (response) => { if (job.accept) return outcome({ captureId: id, type: "transport-outcome", status: "response-headers", httpStatus: response?.status ?? null, at: new Date().toISOString() }); },
      (thrown) => { if (job.accept) return outcome({ captureId: id, type: "transport-outcome", status: "failed", error: formatError(thrown), aborted: thrown?.name === "AbortError", at: new Date().toISOString() }); },
    ), job);
    return result;
  };

  return {
    install() {
      if (installation?.active) return { ok: false, reason: "already-installed" };
      const fetchDelegate = globalThis.fetch;
      if (typeof fetchDelegate !== "function") return { ok: false, reason: "fetch-unavailable" };
      const state = { active: true, fetchDelegate, fetchWrapper: null, webSocketPrototype: null, sendDelegate: null, sendDescriptor: null, sendWrapper: null };
      state.fetchWrapper = function auditFetch(input, init) {
        const send = () => Reflect.apply(fetchDelegate, this, [input, init]);
        if (!state.active) return send();
        const url = requestUrl(input);
        const logical = current();
        if (!logical || !matches(logical.coverage, "http-fetch", url)) return send();
        const prepared = prepareFetch(input, init);
        return observe(logical, "http-fetch", url, prepared.body, prepared.metadata, send);
      };
      globalThis.fetch = state.fetchWrapper;

      const WebSocketCtor = globalThis.WebSocket;
      if (typeof WebSocketCtor === "function" && typeof WebSocketCtor.prototype?.send === "function") {
        const prototype = WebSocketCtor.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "send");
        const sendDelegate = prototype.send;
        const sendWrapper = function auditWebSocketSend(data) {
          const send = () => Reflect.apply(sendDelegate, this, [data]);
          if (!state.active) return send();
          const url = String(this?.url ?? "");
          const logical = current();
          if (!logical || !matches(logical.coverage, "websocket-send", url)) return send();
          return observe(logical, "websocket-send", url, data, { contentType: null, contentEncoding: null }, send);
        };
        try {
          Object.defineProperty(prototype, "send", { configurable: descriptor?.configurable ?? true, enumerable: descriptor?.enumerable ?? false, writable: descriptor?.writable ?? true, value: sendWrapper });
          Object.assign(state, { webSocketPrototype: prototype, sendDelegate, sendDescriptor: descriptor, sendWrapper });
        } catch (problem) { report(new Error(`WebSocket.prototype.send could not be observed: ${formatError(problem)}`)); }
      }
      installation = state;
      return { ok: true, webSocket: state.sendWrapper ? "prototype-wrapped" : "unavailable" };
    },
    restore() {
      const state = installation;
      if (!state) return [];
      state.active = false;
      const conflicts = [];
      if (globalThis.fetch === state.fetchWrapper) globalThis.fetch = state.fetchDelegate;
      else conflicts.push("fetch wrapper changed after audit installation; retained audit delegate is inert");
      if (state.sendWrapper) {
        if (state.webSocketPrototype.send === state.sendWrapper) Object.defineProperty(state.webSocketPrototype, "send", state.sendDescriptor ?? { configurable: true, writable: true, value: state.sendDelegate });
        else conflicts.push("WebSocket.prototype.send changed after audit installation; retained audit delegate is inert");
      }
      installation = null;
      return conflicts;
    },
    async drain() {
      if (!pending.size) return { complete: true, abandoned: 0 };
      const snapshot = [...pending.keys()];
      let timer;
      const complete = await Promise.race([
        Promise.all(snapshot).then(() => true),
        new Promise((resolve) => { timer = setTimeout(() => resolve(false), drainTimeoutMs); }),
      ]);
      clearTimeout(timer);
      if (complete) return { complete: true, abandoned: 0 };
      let abandoned = 0;
      for (const task of snapshot) {
        const job = pending.get(task);
        if (!job) continue;
        job.accept = false; pending.delete(task); abandoned++;
      }
      return { complete: false, abandoned };
    },
  };
}

function matches(coverage, transport, rawUrl) {
  if (coverage?.status !== "supported") return false;
  try {
    const actual = new URL(rawUrl).toString();
    return transport === "http-fetch" ? actual === coverage.httpUrl : actual === coverage.webSocketUrl;
  } catch { return false; }
}

function requestUrl(input) {
  return typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
}

function prepareFetch(input, init) {
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const headers = new Headers(init?.headers ?? request?.headers ?? undefined);
  let body = Object.prototype.hasOwnProperty.call(init ?? {}, "body") ? init.body : null;
  if (!Object.prototype.hasOwnProperty.call(init ?? {}, "body") && request) {
    try { body = request.clone(); } catch (error) { body = { auditMissing: formatError(error) }; }
  }
  return {
    body,
    metadata: {
      method: init?.method ?? request?.method ?? "GET",
      contentType: headers.get("content-type"),
      contentEncoding: headers.get("content-encoding"),
    },
  };
}

async function bodyEvidence(value, contentEncoding) {
  if (value && typeof value === "object" && "auditMissing" in value) return { status: "missing", reason: value.auditMissing };
  let bytes;
  let representation;
  if (value == null) { bytes = Buffer.alloc(0); representation = "none"; }
  else if (typeof value === "string") { bytes = Buffer.from(value); representation = "string-utf8"; }
  else if (value instanceof URLSearchParams) { bytes = Buffer.from(value.toString()); representation = "url-search-params"; }
  else if (typeof Blob !== "undefined" && value instanceof Blob) { bytes = Buffer.from(await value.arrayBuffer()); representation = "blob"; }
  else if (typeof Request !== "undefined" && value instanceof Request) { bytes = Buffer.from(await value.arrayBuffer()); representation = "request-clone"; }
  else if (value instanceof ArrayBuffer) { bytes = Buffer.from(value); representation = "array-buffer"; }
  else if (ArrayBuffer.isView(value)) { bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength); representation = value.constructor.name; }
  else return { status: "unsupported", reason: `body type ${value?.constructor?.name ?? typeof value} cannot be copied without changing the request` };

  let decodedBytes = bytes;
  let decodedFrom = null;
  if (contentEncoding?.toLowerCase() === "zstd") {
    try { decodedBytes = zstdDecompressSync(bytes); decodedFrom = "zstd"; }
    catch (error) { decodedBytes = null; decodedFrom = `zstd-error: ${formatError(error)}`; }
  }
  let text = null;
  if (decodedBytes) {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(decodedBytes); } catch {}
  }
  return {
    status: "observed", representation, byteLength: bytes.length, sha256: sha256(bytes), base64: bytes.toString("base64"),
    interpretation: text === null ? { status: "binary-or-undecodable", decodedFrom } : { status: "decoded", charset: "utf-8", decodedFrom, text },
  };
}

export function findExactSkillEvidence(payload, skills, visibleSkills, formatSkillsForPrompt, { api = null, contextMessages = [], cwd = process.cwd() } = {}) {
  const strings = [];
  walkStrings(payload, strings);
  const catalog = formatSkillsForPrompt(visibleSkills);
  const instructionText = api === "openai-codex-responses"
    ? [payload?.instructions].filter((value) => typeof value === "string")
    : api === "anthropic-messages"
      ? (typeof payload?.system === "string" ? [payload.system] : (payload?.system ?? []).filter((part) => part?.type === "text").map((part) => part.text))
      : [];
  const matches = catalog ? instructionText.reduce((total, text) => total + countOccurrences(text, catalog), 0) : 0;
  const explicitSkillWrappers = [];
  const known = new Map(skills.map((skill) => [`${skill.name}\u0000${skill.filePath}`, skill]));
  const pattern = /^<skill name="([^"]+)" location="([^"]+)">\nReferences are relative to ([^\n]+)\.\n\n([\s\S]*?)\n<\/skill>(?:\n\n[\s\S]+)?$/;
  for (const text of strings) {
    const match = text.match(pattern);
    if (!match || !known.has(`${match[1]}\u0000${match[2]}`)) continue;
    explicitSkillWrappers.push({ name: match[1], filePath: match[2], baseDir: match[3], returnedText: match[4], sha256: sha256(match[4]), evidence: "exact-pi-skill-wrapper-in-request" });
  }
  const readToolResults = findReadSkillEvidence(contextMessages, strings, skills, cwd);
  return {
    advertisedCatalog: !catalog ? { status: "absent", skills: [] } : matches === 1 ? { status: "observed", skills: visibleSkills.map(({ name }) => name), evidence: "one exact generated catalog occurrence in provider instruction fields" } : { status: "unknown", matches, reason: "provider instruction fields contained zero or multiple exact generated catalog occurrences" },
    loadedSkillEvidence: {
      status: "partial",
      explicitSkillWrappers,
      readToolResults: readToolResults.classified,
      unclassifiedReadResults: readToolResults.unclassified,
      limitations: "Detects exact Pi /skill wrappers and read tool results with a concrete known skill path, toolCallId, and exact returned text present in this request. Other automatic or retained instructions remain unclassified; an empty detection list does not mean no skill was loaded.",
    },
  };
}

function countOccurrences(text, needle) {
  let count = 0, at = 0;
  while ((at = text.indexOf(needle, at)) >= 0) { count++; at += needle.length; }
  return count;
}

function findReadSkillEvidence(messages, requestStrings, skills, cwd) {
  const calls = new Map();
  for (const message of messages ?? []) if (message?.role === "assistant") {
    for (const part of message.content ?? []) if (part?.type === "toolCall" && part.name === "read" && typeof part.id === "string")
      calls.set(part.id, part.arguments?.path);
  }
  const knownPaths = new Map();
  for (const skill of skills) {
    try { knownPaths.set(realpathSync(skill.filePath), skill); } catch {}
  }
  const classified = [], unclassified = [];
  for (const message of messages ?? []) {
    if (message?.role !== "toolResult" || message.toolName !== "read" || !calls.has(message.toolCallId)) continue;
    const requestedPath = calls.get(message.toolCallId);
    const returnedText = (message.content ?? []).filter((part) => part?.type === "text").map((part) => part.text).join("\n");
    const sentText = returnedText.length > 0 && requestStrings.some((text) => text.includes(returnedText));
    const sentToolCallId = requestStrings.some((text) => text.includes(message.toolCallId));
    let skill;
    try { if (typeof requestedPath === "string") skill = knownPaths.get(realpathSync(resolve(cwd, requestedPath))); } catch {}
    const evidence = { toolCallId: message.toolCallId, requestedPath: requestedPath ?? null, returnedText, sha256: sha256(returnedText), truncationMarkerPresent: /\[(?:Output |File content )?truncated/i.test(returnedText), requestTextEvidence: sentText, requestToolCallIdEvidence: sentToolCallId };
    if (skill && sentText && sentToolCallId) classified.push({ name: skill.name, filePath: skill.filePath, ...evidence });
    else unclassified.push({ ...evidence, reason: !skill ? "path does not resolve to a known installed skill" : "exact result text or toolCallId was not found in the outgoing request" });
  }
  return { classified, unclassified };
}

function walkStrings(value, output, seen = new Set()) {
  if (typeof value === "string") { output.push(value); return; }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) for (const item of value) walkStrings(item, output, seen);
  else for (const item of Object.values(value)) walkStrings(item, output, seen);
}

function validateRecord(value, format, label) {
  if (!value || value.format !== format || value.schemaVersion !== AUDIT_SCHEMA_VERSION)
    throw new Error(`${label} has unsupported format/schema: ${value?.format ?? "missing"} v${value?.schemaVersion ?? "missing"}`);
  return value;
}

function readJsonRecord(path, format, label) {
  let value;
  try { value = JSON.parse(readFileSync(safeFile(path), "utf8")); }
  catch (error) { throw new Error(`${label} is corrupt or unreadable: ${formatError(error)}`); }
  return validateRecord(value, format, label);
}

export function readPreviewSet(root, id) {
  if (!ID.test(id)) throw new Error("preview id must be a UUID");
  const base = assertSafeAuditRoot(root);
  return readJsonRecord(join(safeDirectory(base, "previews"), `${id}.json`), `${AUDIT_FORMAT}.previews`, `preview ${id}`);
}

export function listPreviewSets(root) {
  let base;
  try { base = assertSafeAuditRoot(root); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const folder = safeDirectory(base, "previews");
  return readdirSync(folder).filter((name) => name.endsWith(".json")).sort().map((name) => {
    const id = name.replace(/\.json$/, "");
    try {
      if (!ID.test(id)) throw new Error(`unexpected preview filename: ${name}`);
      const value = readJsonRecord(join(folder, name), `${AUDIT_FORMAT}.previews`, `preview ${id}`);
      if (value.id !== id) throw new Error(`preview identity mismatch: ${name}`);
      return { ...value, status: "readable" };
    } catch (error) { return { id, status: "unreadable", reason: formatError(error) }; }
  });
}

export function readCaptureSet(root, id, { materializeOutputs = false } = {}) {
  if (!ID.test(id)) throw new Error("capture id must be a UUID");
  const base = assertSafeAuditRoot(root);
  const capture = readJsonRecord(join(safeDirectory(base, "captures"), `${id}.json`), AUDIT_FORMAT, `capture ${id}`);
  if (capture.id !== id) throw new Error(`capture identity mismatch: ${id}`);
  const eventsDirectory = safeDirectory(base, "events");
  const events = readdirSync(eventsDirectory).filter((name) => name.startsWith(`${id}.`) && name.endsWith(".json")).sort().map((name) => {
    const event = readJsonRecord(join(eventsDirectory, name), AUDIT_FORMAT, `event ${name}`);
    if (event.captureId !== id) throw new Error(`event capture identity mismatch: ${name}`);
    return event;
  });
  const result = { schemaVersion: capture.schemaVersion, format: capture.format, capture, events };
  if (materializeOutputs) result.nativeOutputs = materializeNativeOutputs(capture, events);
  return result;
}

function materializeNativeOutputs(capture, events) {
  const link = events.find((event) => event.type === "native-output-link");
  if (!link) return { status: "unfinished", limitation: "no turn_end link was observed", entries: [] };
  if (!capture.session?.sessionFile) return { status: "missing", limitation: "the native session is ephemeral", entries: [] };
  try {
    const lines = readFileSync(capture.session.sessionFile, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const header = lines.find((entry) => entry.type === "session");
    if (header?.id !== capture.session.sessionId) return { status: "missing", limitation: "session file identity no longer matches", entries: [] };
    const byId = new Map(lines.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
    const entries = link.entryIds.map((entryId) => byId.get(entryId)).filter(Boolean);
    const missingEntryIds = link.entryIds.filter((entryId) => !byId.has(entryId));
    return {
      status: missingEntryIds.length || link.entryIds.length === 0 ? "missing" : link.sharedByCaptureIds?.length > 1 ? "ambiguous-shared-attempt-group" : "observed",
      sessionId: header.id, sessionFile: capture.session.sessionFile, groupId: link.groupId,
      entryIds: link.entryIds, missingEntryIds, entries,
      limitation: "Native persisted, postprocessed session entries; not raw provider response bytes and not guessed one-to-one request responses.",
    };
  } catch (error) { return { status: "missing", limitation: formatError(error), entries: [] }; }
}

export function listCaptures(root) {
  let base;
  try { base = assertSafeAuditRoot(root); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const folder = safeDirectory(base, "captures");
  return readdirSync(folder).filter((name) => name.endsWith(".json")).sort().map((name) => {
    const id = name.replace(/\.json$/, "");
    try {
      if (!ID.test(id)) throw new Error(`unexpected capture filename: ${name}`);
      const value = readJsonRecord(join(folder, name), AUDIT_FORMAT, `capture ${id}`);
      if (value.id !== id) throw new Error(`capture identity mismatch: ${name}`);
      return { id: value.id, status: "readable", timestamp: value.timestamp, transport: value.transport?.kind, provider: value.provider?.provider, model: value.provider?.model, sessionId: value.session?.sessionId };
    } catch (error) { return { id, status: "unreadable", reason: formatError(error) }; }
  });
}

export function removePreviewSet(root, id) {
  if (!ID.test(id)) throw new Error("preview id must be a UUID");
  const base = assertSafeAuditRoot(root);
  readPreviewSet(base, id);
  const referenced = listCaptures(base).filter((capture) => capture.status === "readable")
    .some((capture) => readCaptureSet(base, capture.id).capture.previewSetId === id);
  if (referenced) throw new Error("preview set is still referenced by a readable capture; clean that capture first");
  const previewPath = join(safeDirectory(base, "previews"), `${id}.json`);
  const exportPath = join(safeDirectory(base, "exports"), `preview-${id}`);
  const accessDirectory = optionalDirectory(safeDirectory(base, "exports"), ".access");
  const tokenPath = accessDirectory && join(accessDirectory, `preview-${id}.token`);
  assertRemovableExport(exportPath); if (tokenPath) assertOptionalFile(tokenPath);
  assertSafeAuditRoot(base);
  rmSync(previewPath); rmSync(exportPath, { recursive: true, force: true }); if (tokenPath) rmSync(tokenPath, { force: true });
}

export function removeCapture(root, id) {
  let base;
  try { base = assertSafeAuditRoot(root); }
  catch (error) { if (error?.code === "ENOENT") return; throw error; }
  if (id === "all") { assertSafeAuditRoot(base); rmSync(base, { recursive: true, force: true }); return; }
  if (!ID.test(id)) throw new Error("capture id must be a UUID or all");
  const capturesDirectory = safeDirectory(base, "captures"), capturePath = join(capturesDirectory, `${id}.json`);
  let capture = null, captureExists = true;
  try { safeFile(capturePath); } catch (error) { if (error?.code === "ENOENT") captureExists = false; else throw error; }
  if (captureExists) try { capture = readJsonRecord(capturePath, AUDIT_FORMAT, `capture ${id}`); if (capture.id !== id) throw new Error(`capture identity mismatch: ${id}`); } catch {}
  const previewSetId = capture?.previewSetId;
  if (previewSetId !== null && previewSetId !== undefined && !ID.test(previewSetId)) throw new Error("capture has invalid previewSetId; cleanup aborted");
  const eventsDirectory = safeDirectory(base, "events"), exportsDirectory = safeDirectory(base, "exports");
  const eventPaths = readdirSync(eventsDirectory).filter((name) => name.startsWith(`${id}.`)).map((name) => safeFile(join(eventsDirectory, name)));
  const accessDirectory = optionalDirectory(exportsDirectory, ".access");
  const exportPath = join(exportsDirectory, id), tokenPath = accessDirectory && join(accessDirectory, `${id}.token`);
  assertRemovableExport(exportPath); if (tokenPath) assertOptionalFile(tokenPath);
  assertSafeAuditRoot(base);
  if (captureExists) rmSync(capturePath); for (const path of eventPaths) rmSync(path);
  rmSync(exportPath, { recursive: true, force: true }); if (tokenPath) rmSync(tokenPath, { force: true });
}

function assertRemovableExport(path) {
  try { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe audit export: ${path}`); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}
function assertOptionalFile(path) {
  try { safeFile(path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
function optionalDirectory(base, name) {
  try { return safeDirectory(base, name); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

export const formatError = (error) => error instanceof Error ? `${error.name}: ${error.message}` : String(error);
