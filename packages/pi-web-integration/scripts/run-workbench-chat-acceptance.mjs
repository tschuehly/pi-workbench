#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import { appendFile, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createIsolatedPiWebStack, assertExecutable } from "./lib/isolated-pi-web-stack.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKBENCH_ROOT = resolve(SCRIPT_DIR, "../../..");
export const BROWSER_UNAVAILABLE = Object.freeze({
  type: "BROWSER_UNAVAILABLE",
  code: "BROWSER_UNAVAILABLE",
  message: "No supported system Chromium was found. Set CHROME_BIN to an executable Chromium binary.",
});

export function findSystemChromium(env = process.env) {
  if (env.CHROME_BIN) return executableFile(env.CHROME_BIN) ? resolve(env.CHROME_BIN) : undefined;
  const macCandidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const candidate of macCandidates) if (executableFile(candidate)) return candidate;
  for (const command of ["chromium-browser", "chromium", "google-chrome", "google-chrome-stable"]) {
    for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
      const candidate = join(directory, command);
      if (executableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chrome = findSystemChromium({ ...process.env, ...(args.chromeBin === undefined ? {} : { CHROME_BIN: args.chromeBin }) });
  if (chrome === undefined) {
    process.stdout.write(`${JSON.stringify(BROWSER_UNAVAILABLE)}\n`);
    return 2;
  }

  const piWebRoot = resolve(args.piWebRoot ?? join(WORKBENCH_ROOT, "../pi-web"));
  const tsx = join(piWebRoot, "node_modules/.bin/tsx");
  await assertExecutable(tsx, "PI WEB tsx is unavailable; install dependencies in the owned PI WEB worktree");
  if (process.platform === "darwin") {
    const architecture = process.arch === "arm64" ? "arm64" : "x64";
    await assertExecutable(join(piWebRoot, `node_modules/node-pty/prebuilds/darwin-${architecture}/spawn-helper`), "PI WEB node-pty helper is not executable; repair the owned dependency installation");
  }
  await assertExecutable(chrome, "Chromium is unavailable");
  const clientIndex = join(piWebRoot, "dist/client/index.html");
  await readFile(clientIndex).catch(() => { throw new Error(`Built PI WEB client assets are required: ${clientIndex}`); });

  // Keep the owned root short enough for macOS's Unix-domain socket limit.
  const root = args.root ?? await mkdtemp(join(tmpdir(), "pw-accept-"));
  const [webPort, browserPort] = await allocateDistinctPorts();
  const stack = await createIsolatedPiWebStack({ root: resolve(root), webPort, browserPort });
  process.stdout.write(`${JSON.stringify({ type: "ISOLATION_PREFLIGHT", freshRoot: true, socketOnlySessiond: true, credentialVariables: 0, ownedPorts: 2 })}\n`);
  let interruptedExit;
  const onSignal = (signal) => {
    interruptedExit = signal === "SIGINT" ? 130 : 143;
    void stack.cleanup().finally(() => process.exit(interruptedExit));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await prepareFixture(stack);
    const sessiond = startLogged(stack, "sessiond", tsx, ["src/server/sessiond.ts"], piWebRoot);
    await waitForFile(stack.paths.socket, 15_000, sessiond);
    const web = startLogged(stack, "web", tsx, ["src/server/fixtureServer.ts"], piWebRoot);
    await waitForHttp(`http://127.0.0.1:${webPort}/api/projects`, 20_000, web);
    await waitForHttp(`http://127.0.0.1:${webPort}/`, 20_000, web);
    await waitForFile(stack.paths.fixtureManifest, 10_000, web);
    const controlledFixture = JSON.parse(await readFile(stack.paths.fixtureManifest, "utf8"));
    const initialUrl = `http://127.0.0.1:${webPort}/`;
    const browser = startLogged(stack, "chromium", chrome, chromeArgs(browserPort, stack.paths.chromeProfile, initialUrl), piWebRoot);
    await waitForHttp(`http://127.0.0.1:${browserPort}/json/version`, 15_000, browser);
    await delay(1_000);

    const cdp = await openExistingPage(browserPort, initialUrl);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Log.enable");
      const result = await withTimeout(runBrowserAcceptance(cdp, browserPort, webPort, controlledFixture, { sessiond, web }), 90_000, "Browser acceptance exceeded its owned 90-second deadline");
      for (const limitation of result.limitations) process.stdout.write(`${JSON.stringify({ type: "FIXTURE_LIMITATION", ...limitation })}\n`);
      for (const check of result.checks) process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_CHECK", ...check })}\n`);
      process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_RESULT", status: result.status, failures: result.checks.filter((check) => !check.passed).length, limitations: result.limitations.length })}\n`);
      return result.status === "passed" ? 0 : 1;
    } finally {
      cdp.close();
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    const cleanup = await stack.cleanup({ removeRoot: args.keepTemp !== true });
    process.stdout.write(`${JSON.stringify({ type: "CLEANUP_RESULT", ...cleanup })}\n`);
  }
}

async function prepareFixture(stack) {
  await writeFile(stack.paths.config, `${JSON.stringify({
    host: "127.0.0.1", port: stack.ports.web, allowedHosts: true, spawnSessions: false, subsessions: false, askUser: true,
    pathAccess: { allowedPaths: [stack.root] }, plugins: {},
  }, null, 2)}\n`, "utf8");
  await writeFile(stack.paths.machines, '{"machines":[]}\n', { encoding: "utf8", mode: 0o600 });
}

async function runBrowserAcceptance(cdp, browserPort, webPort, controlledFixture, runtime) {
  const checks = [];
  const anchors = controlledFixture.anchors;
  const first = anchors[0];
  const second = anchors[1];
  if (first === undefined || second === undefined) throw new Error("Controlled fixture needs two Chat anchors");
  const baseUrl = `http://127.0.0.1:${webPort}/`;
  const limitations = controlledFixture.blockers.map((blocker) => ({ ...blocker }));

  await waitForDeepText(cdp, "New Chat", 15_000);
  const root = await evaluate(cdp, `(() => {
    const app = document.querySelector("pi-workbench-app");
    const shadow = app?.shadowRoot;
    return {
      title: document.title,
      workbench: app !== null,
      chooser: shadow?.querySelector('[data-view="chooser"]') !== null,
      legacy: document.querySelector("pi-web-app") !== null,
      files: shadow?.querySelector("workspace-files-panel") !== null,
      terminal: shadow?.querySelector("terminal-panel") !== null,
    };
  })()`);
  checks.push({ id: "workbench-chat-root", passed: root.title === "Pi Workbench" && root.workbench && root.chooser && !root.legacy && !root.files && !root.terminal, detail: JSON.stringify(root) });

  const firstUrl = fixtureUrl(baseUrl, first, "chat");
  await navigate(cdp, firstUrl.href, 20_000);
  await waitForDeepText(cdp, first.transcriptMarker, 15_000);
  const mounted = await chatSnapshot(cdp);
  checks.push({
    id: "existing-chat-complete-identity",
    passed: mounted.machineId === first.machineId && mounted.projectId === first.projectId && mounted.workspaceId === first.workspaceId && mounted.sessionId === first.sessionId && mounted.chat && mounted.prompt && mounted.editor && mounted.send && mounted.stop && mounted.onSend && mounted.onStop,
    detail: JSON.stringify(mounted),
  });
  const backAvailable = await evaluate(cdp, `document.querySelector("pi-workbench-app")?.shadowRoot?.querySelector('button[aria-label="Back"]') instanceof HTMLButtonElement`);
  if (backAvailable) {
    await clickDeepSelector(cdp, 'button[aria-label="Back"]');
    await waitForDeepText(cdp, "New Chat", 10_000);
  }
  const backed = await evaluate(cdp, `(() => { const root = document.querySelector("pi-workbench-app")?.shadowRoot; const url = new URL(location.href); return { chooser: root?.querySelector('[data-view="chooser"]') !== null, project: root?.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? "", workspaceId: root?.querySelector('select[aria-label="Workspace"]')?.value ?? "", sessionId: url.searchParams.get("session") }; })()`);
  checks.push({ id: "chat-back-to-workspace-chooser", passed: backAvailable && backed.chooser && backed.project === "Controlled project 1" && backed.workspaceId === first.workspaceId && backed.sessionId === null, detail: JSON.stringify({ backAvailable, backed }) });
  await navigate(cdp, firstUrl.href, 20_000);
  await waitForDeepText(cdp, first.transcriptMarker, 15_000);
  const beforePaging = await chatSnapshot(cdp);
  if (beforePaging.hasMore) {
    await clickDeepText(cdp, "Load earlier messages");
    await waitForBrowserExpression(cdp, `document.querySelector("pi-workbench-app")?.shadowRoot?.querySelector("chat-view")?.messageStart === 0`, 10_000);
  }
  const paged = await chatSnapshot(cdp);
  const uiPaged = runtime.web.recentOutput().includes(`/sessions/${first.sessionId}/messages`) && runtime.web.recentOutput().includes("&before=");
  const pageUrl = new URL(`api/machines/${encodeURIComponent(first.machineId)}/sessions/${encodeURIComponent(first.sessionId)}/messages`, baseUrl);
  pageUrl.searchParams.set("cwd", first.cwd);
  pageUrl.searchParams.set("limit", "20");
  const page = await requestJson(pageUrl);
  checks.push({ id: "chat-transcript-paging", passed: beforePaging.onLoadMore && beforePaging.hasMore && uiPaged && page.total > 100 && page.start > 0 && paged.messageStart === 0, detail: JSON.stringify({ onLoadMore: beforePaging.onLoadMore, hadMore: beforePaging.hasMore, uiPaged, initialPageStart: page.start, renderedStart: paged.messageStart, messageTotal: paged.messageTotal }) });

  await clickDeepSelector(cdp, ".cm-content");
  await cdp.send("Input.insertText", { text: "first line\nsecond line" });
  const edited = await deepEditorText(cdp);
  const primaryModifier = process.platform === "darwin" ? 4 : 2;
  await dispatchShortcut(cdp, "z", primaryModifier);
  const undone = await deepEditorText(cdp);
  await dispatchShortcut(cdp, "z", primaryModifier | 8);
  const redone = await deepEditorText(cdp);
  checks.push({ id: "prompt-editor-multiline-undo-redo", passed: edited.includes("first line\nsecond line") && undone === "" && redone.includes("first line\nsecond line"), detail: JSON.stringify({ edited, undone, redone }) });

  await evaluate(cdp, `window.open(${JSON.stringify(baseUrl)}, "_blank"); true`);
  const secondPage = await openExistingPage(browserPort, baseUrl);
  try {
    await secondPage.send("Page.enable");
    await secondPage.send("Runtime.enable");
    await waitForDeepText(secondPage, "New Chat", 15_000);
    await clickDeepText(secondPage, "Controlled project 2");
    await waitForBrowserExpression(secondPage, `(() => { const root = document.querySelector("pi-workbench-app")?.shadowRoot; const select = root?.querySelector('select[aria-label="Workspace"]'); return [...(select?.options ?? [])].some((option) => option.value === ${JSON.stringify(second.workspaceId)}); })()`, 10_000);
    await selectDeepValue(secondPage, "Workspace", second.workspaceId);
    await waitForDeepText(secondPage, second.displayName, 10_000);
    const chooser = await evaluate(secondPage, `(() => {
      const root = document.querySelector("pi-workbench-app")?.shadowRoot;
      const button = [...(root?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent?.trim() === "New Chat");
      const session = root?.querySelector("button.session");
      const section = root?.querySelector(".chooser > section");
      const existing = root?.textContent?.includes(${JSON.stringify(second.displayName)}) === true;
      const title = session?.querySelector("strong");
      if (title) title.textContent = "unbroken-session-title-".repeat(30);
      const titleLineHeight = title === null || title === undefined ? Number.NaN : Number.parseFloat(getComputedStyle(title).lineHeight);
      return {
        newChat: button instanceof HTMLButtonElement,
        enabled: button instanceof HTMLButtonElement && !button.disabled,
        existing,
        sessionContained: session instanceof HTMLButtonElement && section instanceof HTMLElement && section.scrollWidth <= section.clientWidth && session.getBoundingClientRect().right <= section.getBoundingClientRect().right,
        sessionTitleClamped: title instanceof HTMLElement && Number.isFinite(titleLineHeight) && title.scrollHeight > title.clientHeight && title.clientHeight <= titleLineHeight * 2 + 1,
      };
    })()`);
    checks.push({ id: "chooser-session-text-contained", passed: chooser.sessionContained && chooser.sessionTitleClamped, detail: JSON.stringify(chooser) });
    await clickDeepText(secondPage, "New Chat");
    await waitForBrowserExpression(secondPage, `(() => { const id = document.querySelector("pi-workbench-app")?.shadowRoot?.querySelector('[data-view="chat"]')?.dataset.session ?? ""; return id !== "" && !id.startsWith("creating:"); })()`, 20_000);
    const created = await chatSnapshot(secondPage);
    checks.push({ id: "new-chat-complete-identity", passed: chooser.newChat && chooser.enabled && chooser.existing && created.machineId === second.machineId && created.projectId === second.projectId && created.workspaceId === second.workspaceId && created.sessionId !== "" && created.sessionId !== second.sessionId, detail: JSON.stringify({ chooser, created }) });

    const secondUrl = fixtureUrl(baseUrl, second, "chat");
    await navigate(secondPage, secondUrl.href, 20_000);
    await waitForDeepText(secondPage, second.transcriptMarker, 15_000);
    await clickDeepSelector(secondPage, ".cm-content");
    await secondPage.send("Input.insertText", { text: "second window draft" });
    const firstDraftBeforeReload = await deepEditorText(cdp);
    const secondDraft = await deepEditorText(secondPage);
    const reloaded = cdp.waitForEvent("Page.loadEventFired", 20_000);
    await cdp.send("Page.reload");
    await reloaded;
    await waitForDeepText(cdp, first.transcriptMarker, 15_000);
    const firstDraftAfterReload = await deepEditorText(cdp);
    const isolated = await Promise.all([chatSnapshot(cdp), chatSnapshot(secondPage)]);
    const statusUrl = new URL(`api/machines/${encodeURIComponent(first.machineId)}/sessions/${encodeURIComponent(first.sessionId)}/status`, baseUrl);
    statusUrl.searchParams.set("cwd", first.cwd);
    const daemonStatus = await requestJson(statusUrl);
    assertChildAlive(runtime.sessiond);
    checks.push({
      id: "two-window-isolation-and-runtime-continuity",
      passed: isolated[0].sessionId === first.sessionId && isolated[1].sessionId === second.sessionId && isolated[0].sessionId !== isolated[1].sessionId && firstDraftBeforeReload.includes("first line") && firstDraftAfterReload === firstDraftBeforeReload && secondDraft === "second window draft" && daemonStatus.sessionId === first.sessionId,
      detail: JSON.stringify({ first: isolated[0].sessionId, second: isolated[1].sessionId, firstDraftBeforeReload, firstDraftAfterReload, secondDraft, daemonSessionId: daemonStatus.sessionId, sessiondPid: runtime.sessiond.pid }),
    });
  } finally {
    secondPage.close();
  }

  return { status: checks.every((check) => check.passed) ? "passed" : "failed", checks, limitations };
}

async function chatSnapshot(cdp) {
  return evaluate(cdp, `(() => {
    const root = document.querySelector("pi-workbench-app")?.shadowRoot;
    const shell = root?.querySelector('[data-view="chat"]');
    const chat = root?.querySelector("chat-view");
    const prompt = root?.querySelector("prompt-editor");
    return {
      machineId: shell?.dataset.machine ?? "",
      projectId: shell?.dataset.project ?? "",
      workspaceId: shell?.dataset.workspace ?? "",
      sessionId: shell?.dataset.session ?? "",
      chat: chat !== null,
      prompt: prompt !== null,
      editor: prompt?.shadowRoot?.querySelector(".cm-content")?.getAttribute("contenteditable") === "true",
      send: prompt?.shadowRoot?.querySelector(".send-button") instanceof HTMLButtonElement,
      stop: prompt?.shadowRoot?.querySelector(".stop-button") instanceof HTMLButtonElement,
      onSend: typeof prompt?.onSend === "function",
      onStop: typeof prompt?.onStop === "function",
      onLoadMore: typeof chat?.onLoadMore === "function",
      hasMore: chat?.hasMore,
      messageStart: chat?.messageStart ?? 0,
      messageTotal: chat?.messageTotal ?? 0,
    };
  })()`);
}

async function deepEditorText(cdp) {
  return evaluate(cdp, `(() => { const content = document.querySelector("pi-workbench-app")?.shadowRoot?.querySelector("prompt-editor")?.shadowRoot?.querySelector(".cm-content"); if (content?.querySelector(".cm-placeholder") !== null) return ""; return [...content?.querySelectorAll(".cm-line") ?? []].map((line) => line.textContent ?? "").join("\\n"); })()`);
}

async function dispatchShortcut(cdp, key, modifiers) {
  const code = `Key${key.toUpperCase()}`;
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await delay(100);
}

async function selectDeepValue(cdp, label, value) {
  const selector = `select[aria-label="${label}"]`;
  return evaluate(cdp, `(() => {
    const select = document.querySelector("pi-workbench-app")?.shadowRoot?.querySelector(${JSON.stringify(selector)});
    if (!(select instanceof HTMLSelectElement)) throw new Error("Select not found: " + ${JSON.stringify(label)});
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return true;
  })()`);
}

function fixtureUrl(baseUrl, anchor, view) {
  if (anchor === undefined) throw new Error("Controlled fixture has no first anchor");
  const url = new URL(baseUrl);
  url.searchParams.set("project", anchor.projectId);
  url.searchParams.set("workspace", anchor.workspaceId);
  url.searchParams.set("session", anchor.sessionId);
  url.searchParams.set("view", view);
  return url;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url.pathname}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

async function clickDeepSelector(cdp, selector) {
  return evaluate(cdp, `(() => {
    const find = (root) => {
      const direct = root.querySelector?.(${JSON.stringify(selector)});
      if (direct) return direct;
      for (const node of root.querySelectorAll?.("*") ?? []) if (node.shadowRoot) { const nested = find(node.shadowRoot); if (nested) return nested; }
      return undefined;
    };
    const target = find(document);
    if (!(target instanceof HTMLElement)) throw new Error("Deep selector not found: " + ${JSON.stringify(selector)});
    target.focus();
    target.click();
    return true;
  })()`);
}

async function clickDeepText(cdp, text) {
  return evaluate(cdp, `(() => {
    const candidates = [];
    const visit = (root) => {
      for (const node of root.querySelectorAll?.("button, summary") ?? []) candidates.push(node);
      for (const node of root.querySelectorAll?.("*") ?? []) if (node.shadowRoot) visit(node.shadowRoot);
    };
    visit(document);
    const target = candidates.find((node) => node.textContent?.trim() === ${JSON.stringify(text)} || [...node.querySelectorAll("*")].some((child) => child.children.length === 0 && child.textContent?.trim() === ${JSON.stringify(text)}));
    if (!(target instanceof HTMLElement)) throw new Error("Deep control not found: " + ${JSON.stringify(text)});
    target.click();
    return true;
  })()`);
}

async function waitForBrowserExpression(cdp, expression, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(cdp, expression)) return;
    await delay(100);
  }
  throw new Error(`Browser expression timed out: ${expression}`);
}

async function waitForDeepText(cdp, text, timeoutMs) {
  const collect = `(() => {
    const chunks = [];
    const visit = (root) => { for (const node of root.querySelectorAll("*")) { if (node.shadowRoot) visit(node.shadowRoot); else if (node.children.length === 0 && node.textContent && node.tagName !== "STYLE" && node.tagName !== "SCRIPT") chunks.push(node.textContent); } };
    visit(document);
    return chunks.join("\\n");
  })()`;
  const started = Date.now();
  let visible = "";
  while (Date.now() - started < timeoutMs) {
    visible = await evaluate(cdp, collect);
    if (String(visible).includes(text)) return;
    await delay(100);
  }
  const diagnostic = await evaluate(cdp, `({ href: location.href, title: document.title, body: document.body?.innerHTML?.slice(0, 1000), app: document.querySelector("pi-workbench-app")?.outerHTML, shadow: document.querySelector("pi-workbench-app")?.shadowRoot?.innerHTML?.slice(0, 1000) })`).catch(() => undefined);
  throw new Error(`Browser text timed out waiting for ${JSON.stringify(text)}; visible text: ${String(visible).slice(0, 2000)}; diagnostic: ${JSON.stringify(diagnostic)}`);
}

function startLogged(stack, name, command, args, cwd) {
  const child = stack.spawnOwned(name, command, args, { cwd });
  const chunks = [];
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk) => { chunks.push(Buffer.from(chunk)); if (chunks.length > 200) chunks.shift(); void appendFile(join(stack.paths.logs, `${name}.log`), chunk).catch(() => undefined); });
  child.recentOutput = () => Buffer.concat(chunks).toString("utf8");
  return child;
}

async function waitForHttp(url, timeoutMs, child) {
  const started = Date.now(); let last;
  while (Date.now() - started < timeoutMs) {
    assertChildAlive(child);
    try { const response = await fetch(url); if (response.ok) return; last = `${response.status} ${response.statusText}`; } catch (error) { last = String(error); }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}: ${last ?? "no response"}\n${child.recentOutput?.() ?? ""}`);
}
async function waitForFile(path, timeoutMs, child) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    assertChildAlive(child);
    try { await stat(path); return; } catch { await delay(100); }
  }
  throw new Error(`Timed out waiting for ${path}\n${child.recentOutput?.() ?? ""}`);
}
function assertChildAlive(child) { if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Owned process exited early\n${child.recentOutput?.() ?? ""}`); }

async function allocateDistinctPorts() { const first = await freePort(); let second = await freePort(); while (second === first) second = await freePort(); return [first, second]; }
function freePort() { return new Promise((resolvePort, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => typeof address === "object" && address !== null ? resolvePort(address.port) : reject(new Error("Could not allocate port"))); }); }); }
function chromeArgs(port, profile, initialUrl) { return ["--headless=new", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "--window-size=1440,900", "--force-device-scale-factor=1", "--disable-background-networking", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--disable-features=Translate,MediaRouter,OptimizationHints", "--use-mock-keychain", "--password-store=basic", "--no-proxy-server", "--disable-component-update", "--disable-domain-reliability", "--disable-sync", "--metrics-recording-only", "--no-default-browser-check", "--no-first-run", "--no-sandbox", initialUrl]; }
async function openExistingPage(port, requestedUrl) {
  const started = Date.now();
  let pages = [];
  while (Date.now() - started < 15_000) {
    pages = await requestJson(new URL(`http://127.0.0.1:${port}/json/list`));
    const info = pages.find((candidate) => candidate.type === "page" && candidate.url === requestedUrl);
    if (info?.webSocketDebuggerUrl !== undefined && info.title === "Pi Workbench") {
      if (process.env.PI_WEB_ACCEPTANCE_TRACE === "1") process.stderr.write(`[cdp-open] ${JSON.stringify({ requested: requestedUrl, actual: info.url })}\n`);
      return CDP.connect(info.webSocketDebuggerUrl);
    }
    await delay(100);
  }
  throw new Error(`Chromium did not open the owned application page: ${JSON.stringify(pages.map((page) => page.url))}`);
}
async function navigate(cdp, url, timeout) { const loaded = cdp.waitForEvent("Page.loadEventFired", timeout).catch(() => undefined); await withTimeout(cdp.send("Runtime.evaluate", { expression: `location.assign(${JSON.stringify(url)}); true`, returnByValue: true }), Math.min(timeout, 10_000), "CDP navigation evaluation did not respond"); await loaded; }
async function evaluate(cdp, expression) { const response = await withTimeout(cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), 10_000, "CDP Runtime.evaluate did not respond"); if (response.exceptionDetails) throw new Error(`Browser evaluation failed: ${JSON.stringify(response.exceptionDetails)}`); return response.result?.value; }
class CDP {
  static connect(url) { return new Promise((resolveCdp, reject) => { const ws = new WebSocket(url); const cdp = new CDP(ws); ws.addEventListener("open", () => resolveCdp(cdp), { once: true }); ws.addEventListener("error", () => reject(new Error("CDP websocket error")), { once: true }); }); }
  constructor(ws) { this.ws = ws; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); ws.addEventListener("message", (event) => this.onMessage(event)); ws.addEventListener("close", () => { for (const pending of this.pending.values()) pending.reject(new Error("CDP websocket closed")); this.pending.clear(); }); }
  send(method, params = {}) { const id = this.nextId++; return new Promise((resolveSend, reject) => { this.pending.set(id, { resolve: resolveSend, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  waitForEvent(method, timeoutMs) { return new Promise((resolveEvent, reject) => { const listener = (params) => { clearTimeout(timer); this.listeners.set(method, (this.listeners.get(method) ?? []).filter((item) => item !== listener)); resolveEvent(params); }; const timer = setTimeout(() => { this.listeners.set(method, (this.listeners.get(method) ?? []).filter((item) => item !== listener)); reject(new Error(`Timed out waiting for ${method}`)); }, timeoutMs); this.listeners.set(method, [...this.listeners.get(method) ?? [], listener]); }); }
  close() { this.ws.close(); }
  onMessage(event) { const message = JSON.parse(String(event.data)); if (process.env.PI_WEB_ACCEPTANCE_TRACE === "1") process.stderr.write(`[cdp] ${JSON.stringify({ id: message.id, method: message.method, error: message.error, ...(message.method === "Runtime.exceptionThrown" || message.method === "Log.entryAdded" ? { params: message.params } : {}) })}\n`); if (message.id !== undefined) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result ?? {}); return; } for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {}); }
}

function parseArgs(argv) { const parsed = {}; for (let index = 0; index < argv.length; index += 1) { const arg = argv[index]; if (arg === "--keep-temp") parsed.keepTemp = true; else if (["--root", "--pi-web-root", "--chrome-bin"].includes(arg)) { const value = argv[++index]; if (!value) throw new Error(`${arg} requires a value`); parsed[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value; } else if (arg === "--help") { process.stdout.write("Usage: node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs [--pi-web-root PATH] [--chrome-bin PATH] [--root TEMP] [--keep-temp]\n"); process.exit(0); } else throw new Error(`Unknown argument: ${arg}`); } return parsed; }
function executableFile(path) { try { accessSync(path, constants.X_OK); return true; } catch { return false; } }
function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]);
}

const invokedPath = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_ERROR", code: error?.code ?? "HARNESS_ERROR", message: error instanceof Error ? error.message : String(error) })}\n`); process.exitCode = 3; }
}
