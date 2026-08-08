#!/usr/bin/env node
import { accessSync, constants } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createIsolatedPiWebStack, assertExecutable } from "./lib/isolated-pi-web-stack.mjs";
import { createUserLocalWorkstreamStore } from "../../workstream-store/src/index.js";

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
    await seedPairedWorkstreams(stack, controlledFixture.anchors);
    const initialUrl = fixtureUrl(`http://127.0.0.1:${webPort}/`, controlledFixture.anchors[0], "pi-workbench:workstreams.view").href;
    const browser = startLogged(stack, "chromium", chrome, chromeArgs(browserPort, stack.paths.chromeProfile, initialUrl), piWebRoot);
    await waitForHttp(`http://127.0.0.1:${browserPort}/json/version`, 15_000, browser);
    await delay(1_000);

    const cdp = await openExistingPage(browserPort, initialUrl);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Log.enable");
      const result = await withTimeout(runBrowserAcceptance(cdp, webPort, controlledFixture), 90_000, "Browser acceptance exceeded its owned 90-second deadline");
      for (const blocker of result.blockers) process.stdout.write(`${JSON.stringify({ type: "FIXTURE_BLOCKER", ...blocker })}\n`);
      for (const check of result.checks) process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_CHECK", ...check })}\n`);
      process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_RESULT", status: result.status, failures: result.checks.filter((check) => !check.passed).length, blockers: result.blockers.length })}\n`);
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
  const pluginRoot = join(stack.paths.data, "plugins", "pi-workbench");
  const packageRoot = pluginRoot;
  await mkdir(pluginRoot, { recursive: true });
  await Promise.all([
    cp(join(WORKBENCH_ROOT, "packages/package.json"), join(pluginRoot, "package.json")),
    cp(join(WORKBENCH_ROOT, "packages/pi-web-integration"), join(packageRoot, "pi-web-integration"), { recursive: true, filter: (source) => !source.includes("/evidence/unified-ui/") }),
    cp(join(WORKBENCH_ROOT, "packages/workstream-store"), join(packageRoot, "workstream-store"), { recursive: true }),
    cp(join(WORKBENCH_ROOT, "packages/workstream-session-coordination"), join(packageRoot, "workstream-session-coordination"), { recursive: true }),
  ]);
  await writeFile(stack.paths.config, `${JSON.stringify({
    host: "127.0.0.1", port: stack.ports.web, allowedHosts: true, spawnSessions: false, subsessions: false, askUser: true,
    pathAccess: { allowedPaths: [stack.root] }, plugins: { "pi-workbench": { enabled: true } },
  }, null, 2)}\n`, "utf8");
  await writeFile(stack.paths.machines, '{"machines":[]}\n', { encoding: "utf8", mode: 0o600 });
}

async function seedPairedWorkstreams(stack, anchors) {
  const store = createUserLocalWorkstreamStore({ directory: stack.paths.workstreams });
  await store.create({ workstreamId: "ws-controlled-associated", idempotencyKey: "controlled-create", title: "Controlled associated sessions", producer: "owner" });
  const records = [0, 2].flatMap((index) => {
    const anchor = anchors[index];
    if (anchor === undefined) throw new Error(`Controlled fixture anchor ${String(index + 1)} is missing`);
    const associationKey = `controlled-association-${String(index + 1)}`;
    return [
      { type: "session.pending", producer: "pi-web", payload: { sessionId: anchor.sessionId, associationKey, machineId: anchor.machineId, projectId: anchor.projectId, workspaceId: anchor.workspaceId } },
      { type: "session.confirmed", producer: "pi-web", payload: { sessionId: anchor.sessionId, associationKey, machineId: anchor.machineId, projectId: anchor.projectId, workspaceId: anchor.workspaceId } },
    ];
  });
  await store.append({ workstreamId: "ws-controlled-associated", expectedRevision: 1, idempotencyKey: "controlled-associate", records });
}

async function runBrowserAcceptance(cdp, webPort, controlledFixture) {
  const checks = [];
  const blockers = controlledFixture.blockers.map((blocker) => ({ ...blocker }));
  const anchors = controlledFixture.anchors;
  const baseUrl = `http://127.0.0.1:${webPort}/`;
  process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_PROGRESS", phase: "browser-started" })}\n`);

  const firstUrl = fixtureUrl(baseUrl, anchors[0], "pi-workbench:workstreams.view");
  process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_PROGRESS", phase: "initial-navigation" })}\n`);
  await waitForDeepText(cdp, "Controlled associated sessions", 15_000);
  process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_PROGRESS", phase: "app-mounted" })}\n`);
  process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_PROGRESS", phase: "workbench-visible" })}\n`);

  await clickDeepSelector(cdp, `summary[aria-label="Open Pi menu"]`);
  await clickDeepText(cdp, "Settings");
  await waitForDeepText(cdp, "Appearance", 5_000);
  await clickDeepText(cdp, "Appearance");
  await waitForDeepText(cdp, "Shell profile", 5_000);
  await clickDeepSelector(cdp, `input[name="shell-profile"][value="pi-workbench:shell.workbench"]`);
  const previewDiagnostic = await evaluate(cdp, `(() => { const app = document.querySelector("pi-web-app"); const dialog = app?.shadowRoot?.querySelector("settings-dialog"); return { settingsSection: app?.settingsSection, previewShellProfileId: app?.previewShellProfileId, settingsDialog: dialog !== null, shellProfileError: app?.shellProfileError }; })()`);
  process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_PROGRESS", phase: "shell-profile-preview", detail: previewDiagnostic })}\n`);
  await clickDeepText(cdp, "Apply shell");
  await waitForBrowserExpression(cdp, `JSON.parse(localStorage.getItem("pi-web:shell-profile:v1") ?? "{}").profileId === "pi-workbench:shell.workbench"`, 5_000);
  await clickDeepSelector(cdp, `button[aria-label="Close settings"]`);

  await navigate(cdp, baseUrl, 20_000);
  await waitForDeepText(cdp, "Shell profile · Pi Workbench", 15_000);
  await waitForDeepText(cdp, "Controlled associated sessions", 15_000);
  const selectedProfile = await evaluate(cdp, `(() => {
    const app = document.querySelector("pi-web-app")?.shadowRoot;
    const toolbar = app?.querySelector(".shell-profile-toolbar");
    const menu = toolbar?.querySelector("app-pi-menu")?.shadowRoot;
    const reset = [...(menu?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.trim() === "Use default PI WEB profile");
    const toolbarRect = toolbar?.getBoundingClientRect();
    const triggerRect = menu?.querySelector("summary")?.getBoundingClientRect();
    return {
      routeView: new URL(location.href).searchParams.get("view"),
      primaryView: app?.querySelector("app-primary-view")?.contribution?.id,
      toolbarInline: toolbar instanceof HTMLElement && toolbar.parentElement?.tagName === "MAIN",
      triggerInsideToolbar: toolbarRect !== undefined && triggerRect !== undefined && triggerRect.top >= toolbarRect.top && triggerRect.bottom <= toolbarRect.bottom,
      resetAvailable: reset instanceof HTMLButtonElement,
    };
  })()`);
  await clickDeepSelector(cdp, `summary[aria-label="Open Pi menu"]`);
  const resetInvoked = await clickDeepText(cdp, "Use default PI WEB profile");
  await waitForBrowserExpression(cdp, `JSON.parse(localStorage.getItem("pi-web:shell-profile:v1") ?? "{}").profileId === "core:shell.default"`, 5_000);
  const resetProfileId = await evaluate(cdp, `JSON.parse(localStorage.getItem("pi-web:shell-profile:v1") ?? "{}").profileId`);
  checks.push({
    id: "shell-profile-workbench-select-default-reset",
    passed: previewDiagnostic.settingsSection === "appearance" && previewDiagnostic.previewShellProfileId === "pi-workbench:shell.workbench" && previewDiagnostic.settingsDialog === true && previewDiagnostic.shellProfileError === "" && selectedProfile.routeView === null && selectedProfile.primaryView === "pi-workbench:workstreams.view" && selectedProfile.toolbarInline && selectedProfile.triggerInsideToolbar && selectedProfile.resetAvailable && resetInvoked === true && resetProfileId === "core:shell.default",
    detail: JSON.stringify({ previewDiagnostic, ...selectedProfile, resetInvoked, resetProfileId }),
  });
  await navigate(cdp, firstUrl.href, 20_000);
  await waitForDeepText(cdp, "Controlled associated sessions", 15_000);

  const duplicateComposition = await evaluate(cdp, `(() => {
    const find = (root, selector) => {
      const direct = root.querySelector?.(selector);
      if (direct) return direct;
      for (const node of root.querySelectorAll?.("*") ?? []) if (node.shadowRoot) { const nested = find(node.shadowRoot, selector); if (nested) return nested; }
      return undefined;
    };
    const plugin = find(document, "pi-workbench-workstreams");
    const pluginButtons = plugin?.shadowRoot ? [...plugin.shadowRoot.querySelectorAll("button")] : [];
    const ownsNavigator = pluginButtons.some((button) => /^(?:Expand|Collapse) navigator$/u.test(button.textContent?.trim() ?? ""));
    return find(document, "app-pi-menu") !== undefined && ownsNavigator;
  })()`);
  checks.push({ id: "current-composition-native-host", passed: duplicateComposition === false, code: duplicateComposition ? "CURRENT_COMPOSITION_MISMATCH" : undefined, detail: duplicateComposition ? "Workbench still renders its duplicate unified destination navigator inside the dedicated primary view." : "No duplicate plugin navigator was found." });
  process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_PROGRESS", phase: "composition-classified" })}\n`);

  const projects = await requestJson(new URL("api/projects", baseUrl));
  const native = { catalogs: [], paging: [], files: [], git: [], terminals: [], context: [], hostSelections: [] };
  for (let index = 0; index < anchors.length; index += 1) {
    process.stdout.write(`${JSON.stringify({ type: "ACCEPTANCE_PROGRESS", phase: "native-anchor", ordinal: index + 1 })}\n`);
    const anchor = anchors[index];
    const projectId = anchor.projectId;
    const project = projects.find((value) => value.id === projectId);
    const workspaces = await requestJson(new URL(`api/projects/${encodeURIComponent(projectId)}/workspaces`, baseUrl));
    const workspace = workspaces[0];
    if (workspace === undefined) throw new Error(`Controlled workspace missing for ${projectId}`);
    const cwd = workspace.path;
    const sessionsUrl = new URL("api/sessions", baseUrl);
    sessionsUrl.searchParams.set("cwd", cwd);
    const sessions = await requestJson(sessionsUrl);
    native.catalogs.push({ id: anchor.sessionId, found: sessions.length === 1 && sessions[0]?.id === anchor.sessionId, project: project?.id, workspace: workspace.id });

    const chatUrl = fixtureUrl(baseUrl, anchor, "chat");
    await navigate(cdp, chatUrl.href, 20_000);
    const transcriptVisible = await waitForDeepText(cdp, anchor.transcriptMarker, 15_000).then(() => true, () => false);
    native.hostSelections.push({ sessionId: anchor.sessionId, projectId, workspaceId: workspace.id, transcriptVisible });

    const messagesUrl = new URL(`api/sessions/${encodeURIComponent(anchor.sessionId)}/messages`, baseUrl);
    messagesUrl.searchParams.set("cwd", cwd);
    messagesUrl.searchParams.set("limit", "20");
    const page = await requestJson(messagesUrl);
    native.paging.push({ total: page.total, start: page.start, marker: JSON.stringify(page).includes(anchor.transcriptMarker) });
    const statusUrl = new URL(`api/sessions/${encodeURIComponent(anchor.sessionId)}/status`, baseUrl);
    statusUrl.searchParams.set("cwd", cwd);
    const sessionStatus = await requestJson(statusUrl);
    native.context.push(sessionStatus.contextUsage ?? null);

    const tree = await requestJson(new URL(`api/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspace.id)}/tree`, baseUrl));
    native.files.push(JSON.stringify(tree).includes("README.md"));
    const git = await requestJson(new URL(`api/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspace.id)}/git/status`, baseUrl));
    native.git.push(JSON.stringify(git).includes("tracked.txt") && JSON.stringify(git).includes(`untracked-${String(index + 1)}`));

    const marker = `terminal-anchor-${String(index + 1)}`;
    const run = await requestJson(new URL(`api/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspace.id)}/terminal-command-runs`, baseUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ origin: "controlled-acceptance", title: `Controlled terminal ${String(index + 1)}`, command: `printf ${marker}`, metadata: { fixture: "controlled" } }),
    });
    const output = await captureTerminalOutput(baseUrl, projectId, workspace.id, run.terminalId, marker);
    const completed = await waitForTerminalRun(baseUrl, run.id);
    native.terminals.push({ projectId: run.projectId, workspaceId: run.workspaceId, command: run.command, terminalId: run.terminalId, runId: run.id, status: completed.status, output });
  }

  checks.push({ id: "native-session-catalog-complete-anchors", passed: native.catalogs.every((entry) => entry.found && entry.project && entry.workspace), detail: JSON.stringify(native.catalogs) });
  checks.push({ id: "native-session-route-restoration", passed: native.hostSelections.every((entry) => entry.transcriptVisible), detail: JSON.stringify(native.hostSelections) });
  checks.push({ id: "chat-transcript-paging", passed: native.paging.every((page) => page.total > 100 && page.start > 0 && page.marker), detail: JSON.stringify(native.paging) });
  if (native.context.every((usage) => usage !== null)) checks.push({ id: "context-usage", passed: true, detail: JSON.stringify(native.context) });
  else blockers.push({ code: "CONTEXT_USAGE_UNREACHABLE", state: "partial", message: "The production status seam reports null context usage for persisted no-model sessions. The fixture does not activate a model or fabricate runtime usage." });
  checks.push({ id: "workspace-files-scope", passed: native.files.every(Boolean), detail: JSON.stringify(native.files) });
  checks.push({ id: "workspace-git-scope", passed: native.git.every(Boolean), detail: JSON.stringify(native.git) });
  checks.push({ id: "terminal-process-scope", passed: native.terminals.every((run, index) => run.projectId === anchors[index]?.projectId && run.workspaceId === anchors[index]?.workspaceId && run.command.includes(`terminal-anchor-${String(index + 1)}`) && run.output.includes(`terminal-anchor-${String(index + 1)}`) && run.status === "succeeded" && run.terminalId), detail: JSON.stringify(native.terminals) });

  await navigate(cdp, firstUrl.href, 20_000);
  await waitForDeepText(cdp, "Controlled associated sessions", 15_000);
  const classification = await evaluate(cdp, `(() => {
    const app = document.querySelector("pi-web-app");
    const primary = app?.shadowRoot?.querySelector("app-primary-view")?.shadowRoot;
    const pluginRoot = primary?.querySelector("pi-workbench-workstreams")?.shadowRoot;
    const chunks = [];
    const visit = (root) => { for (const node of root?.querySelectorAll?.("*") ?? []) { if (node.shadowRoot) visit(node.shadowRoot); else if (node.children.length === 0 && node.textContent && node.tagName !== "STYLE" && node.tagName !== "SCRIPT") chunks.push(node.textContent); } };
    visit(pluginRoot);
    const text = chunks.join("\\n");
    return { hasChats: text.includes("Chats"), hasWorkstream: text.includes("Controlled associated sessions") };
  })()`);
  const inspected = await requestJson(new URL("api/pi-web-plugins/pi-workbench/service", baseUrl), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "inspect", input: { workstreamId: "ws-controlled-associated" } }),
  });
  const associatedIds = inspected.ok === true && Array.isArray(inspected.value?.sessions) ? inspected.value.sessions.map((session) => session.id).sort() : [];
  const expectedAssociatedIds = [anchors[0].sessionId, anchors[2].sessionId].sort();
  const unmatchedIds = anchors.filter((_, index) => index !== 0 && index !== 2).map((anchor) => anchor.sessionId);
  const classificationDetail = { ...classification, associatedIds, unmatchedCount: unmatchedIds.filter((id) => !associatedIds.includes(id)).length };
  checks.push({ id: "paired-workstream-classification", passed: classification.hasChats && classification.hasWorkstream && JSON.stringify(associatedIds) === JSON.stringify(expectedAssociatedIds) && classificationDetail.unmatchedCount === 3, detail: JSON.stringify(classificationDetail) });
  const viewportResults = [];
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 }, { name: "handoff-wide", width: 901, height: 900 },
    { name: "handoff-narrow", width: 900, height: 900 }, { name: "tiled", width: 760, height: 900 },
    { name: "mobile", width: 390, height: 844, mobile: true }, { name: "minimum", width: 320, height: 720, mobile: true },
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile === true });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "pointer", value: viewport.mobile === true ? "coarse" : "fine" }] });
    const visible = await waitForDeepText(cdp, "Controlled associated sessions", 5_000).then(() => true, () => false);
    viewportResults.push({ name: viewport.name, width: viewport.width, visible });
  }
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  viewportResults.push({ name: "emulated-200-percent-zoom", width: 320, visible: await waitForDeepText(cdp, "Controlled associated sessions", 5_000).then(() => true, () => false) });
  checks.push({ id: "responsive-emulation-smoke", passed: viewportResults.every((viewport) => viewport.visible), detail: JSON.stringify(viewportResults) });
  return { status: checks.some((check) => !check.passed) || blockers.length > 0 ? "partial" : "passed", checks, blockers };
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
  const diagnostic = await evaluate(cdp, `({ href: location.href, title: document.title, body: document.body?.innerHTML?.slice(0, 1000), app: document.querySelector("pi-web-app")?.outerHTML, shadow: document.querySelector("pi-web-app")?.shadowRoot?.innerHTML?.slice(0, 1000) })`).catch(() => undefined);
  throw new Error(`Browser text timed out waiting for ${JSON.stringify(text)}; visible text: ${String(visible).slice(0, 2000)}; diagnostic: ${JSON.stringify(diagnostic)}`);
}

async function captureTerminalOutput(baseUrl, projectId, workspaceId, terminalId, marker) {
  const url = new URL(`api/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(terminalId)}/socket`, baseUrl);
  url.protocol = "ws:";
  return new Promise((resolveOutput) => {
    const socket = new WebSocket(url);
    let output = "";
    const finish = () => { clearTimeout(timer); socket.close(); resolveOutput(output); };
    const timer = setTimeout(finish, 5_000);
    socket.addEventListener("message", (event) => { void (async () => {
      try {
        const raw = typeof event.data === "string" ? event.data : event.data instanceof Blob ? await event.data.text() : Buffer.from(event.data).toString("utf8");
        const message = JSON.parse(raw);
        if (message.type === "output") output += message.data;
        if (output.includes(marker) || message.type === "exit") finish();
      } catch { finish(); }
    })(); });
    socket.addEventListener("error", finish, { once: true });
  });
}

async function waitForTerminalRun(baseUrl, runId) {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const run = await requestJson(new URL(`api/terminal-command-runs/${encodeURIComponent(runId)}`, baseUrl));
    if (run.status === "succeeded" || run.status === "failed") return run;
    await delay(100);
  }
  throw new Error(`Terminal command run ${runId} exceeded its owned deadline`);
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
    const info = pages.find((candidate) => candidate.type === "page" && candidate.url.startsWith(requestedUrl.split("?")[0]));
    if (info?.webSocketDebuggerUrl !== undefined && info.title === "PI WEB") {
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

function parseArgs(argv) { const parsed = {}; for (let index = 0; index < argv.length; index += 1) { const arg = argv[index]; if (arg === "--keep-temp") parsed.keepTemp = true; else if (["--root", "--pi-web-root", "--chrome-bin"].includes(arg)) { const value = argv[++index]; if (!value) throw new Error(`${arg} requires a value`); parsed[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value; } else if (arg === "--help") { process.stdout.write("Usage: node packages/pi-web-integration/scripts/run-unified-shell-acceptance.mjs [--pi-web-root PATH] [--chrome-bin PATH] [--root TEMP] [--keep-temp]\n"); process.exit(0); } else throw new Error(`Unknown argument: ${arg}`); } return parsed; }
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
