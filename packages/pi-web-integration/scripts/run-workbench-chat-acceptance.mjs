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
  const ownedClientDist = args.ownedClientDist === undefined ? undefined : resolve(args.ownedClientDist);
  const screenshotsDir = args.screenshotsDir === undefined ? undefined : resolve(args.screenshotsDir);
  if (screenshotsDir !== undefined && ownedClientDist === undefined) throw new Error('Screenshots require the owned client');
  if (screenshotsDir !== undefined) await mkdir(screenshotsDir, { recursive: true });
  const clientIndex = join(ownedClientDist ?? join(piWebRoot, "dist/client"), "index.html");
  await readFile(clientIndex).catch(() => { throw new Error(`Built client assets are required: ${clientIndex}`); });

  // Keep the owned root short enough for macOS's Unix-domain socket limit.
  const root = args.root ?? await mkdtemp(join(tmpdir(), "pw-accept-"));
  const [webPort, browserPort] = await allocateDistinctPorts();
  const stack = await createIsolatedPiWebStack({ root: resolve(root), webPort, browserPort, pendingAskFixture: ownedClientDist !== undefined, ...(ownedClientDist === undefined ? {} : { ownedClientDist }) });
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
    await cp(join(WORKBENCH_ROOT, "packages"), join(stack.paths.data, "plugins/pi-workbench"), { recursive: true, errorOnExist: true });
    // The owned proof seeds a real daemon-memory ask from the fixture manifest,
    // so its web fixture must write that manifest before sessiond starts.
    let sessiond;
    let web;
    if (ownedClientDist !== undefined) {
      await mkdir(join(stack.paths.agent, "extensions"), { recursive: true });
      await cp(join(SCRIPT_DIR, "controlled-dialog-extension.ts"), join(stack.paths.agent, "extensions/controlled-dialog-extension.ts"));
      web = startLogged(stack, "web", tsx, [join(SCRIPT_DIR, "owned-chat-fixture-server.mjs")], piWebRoot);
      await waitForHttp(`http://127.0.0.1:${webPort}/api/pi-web/health`, 60_000, web);
      await waitForFile(stack.paths.fixtureManifest, 10_000, web);
      await seedOwnedTranscript(stack, piWebRoot);
      await seedOwnedWorkstream(stack);
      sessiond = startLogged(stack, "sessiond", tsx, ["src/server/sessiond.ts"], piWebRoot);
      await waitForFile(stack.paths.socket, 60_000, sessiond);
    } else {
      sessiond = startLogged(stack, "sessiond", tsx, ["src/server/sessiond.ts"], piWebRoot);
      await waitForFile(stack.paths.socket, 15_000, sessiond);
      web = startLogged(stack, "web", tsx, ["src/server/fixtureServer.ts"], piWebRoot);
      await waitForFile(stack.paths.fixtureManifest, 10_000, web);
    }
    await waitForHttp(`http://127.0.0.1:${webPort}/api/projects`, 20_000, web);
    await waitForHttp(`http://127.0.0.1:${webPort}/`, 20_000, web);
    const controlledFixture = JSON.parse(await readFile(stack.paths.fixtureManifest, "utf8"));
    const initialUrl = ownedClientDist === undefined ? `http://127.0.0.1:${webPort}/` : ownedFixtureUrl(webPort, controlledFixture.anchors[0]).href;
    const browser = startLogged(stack, "chromium", chrome, chromeArgs(browserPort, stack.paths.chromeProfile, initialUrl), piWebRoot);
    await waitForHttp(`http://127.0.0.1:${browserPort}/json/version`, 15_000, browser);
    await delay(1_000);

    const cdp = await openExistingPage(browserPort, initialUrl, "Pi Workbench");
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Log.enable");
      const result = await withTimeout(ownedClientDist === undefined
        ? runBrowserAcceptance(cdp, browserPort, webPort, controlledFixture, { sessiond, web })
        : runOwnedBrowserAcceptance(cdp, webPort, controlledFixture, { sessiond, web, workstreamsDirectory: stack.paths.workstreams, screenshotsDir }), 90_000, "Browser acceptance exceeded its owned 90-second deadline");
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

async function seedOwnedTranscript(stack, piWebRoot) {
  // Add real persisted Pi messages before the isolated daemon opens the fixture session.
  const fixture = JSON.parse(await readFile(stack.paths.fixtureManifest, "utf8"));
  const first = fixture.anchors[0];
  const { SessionManager } = await import(pathToFileURL(join(piWebRoot, "node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href);
  const entry = (await SessionManager.list(first.cwd, stack.paths.sessions)).find(session => session.id === first.sessionId);
  if (!entry) throw new Error("Isolated fixture session not found for transcript seed");
  const manager = SessionManager.open(entry.path, stack.paths.sessions);
  const timestamp = Date.parse(fixture.fixedClock) + 900_000;
  manager.appendMessage({ role: "assistant", content: [
    { type: "thinking", thinking: "Controlled thought block" },
    { type: "toolCall", id: "controlled-read", name: "read", arguments: { path: '<img src=x onerror="window.__transcriptInjected=1">' } },
    { type: "text", text: "Controlled structured reply" },
  ], api: "anthropic-messages", provider: "controlled-fixture", model: "no-model", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp });
  manager.appendMessage({ role: "toolResult", toolCallId: "controlled-read", toolName: "read", content: [{ type: "text", text: '<script>window.__transcriptInjected=1</script> Controlled tool output' }], isError: false, timestamp: timestamp + 1 });
}

async function seedOwnedWorkstream(stack) {
  const fixture = JSON.parse(await readFile(stack.paths.fixtureManifest, "utf8"));
  const second = fixture.anchors[1];
  const store = createUserLocalWorkstreamStore({ directory: stack.paths.workstreams });
  const created = await store.create({ workstreamId: "ws-controlled-owned", idempotencyKey: "fixture-create", title: "Controlled Workstream", producer: "fixture" });
  await store.append({ workstreamId: "ws-controlled-owned", expectedRevision: created.acceptedRevision, idempotencyKey: "fixture-associate", records: [
    { type: "session.pending", producer: "fixture", sourceSessionId: second.sessionId, payload: { sessionId: second.sessionId, associationKey: "fixture-association", machineId: second.machineId, projectId: second.projectId, workspaceId: second.workspaceId } },
    { type: "session.confirmed", producer: "fixture", sourceSessionId: second.sessionId, payload: { sessionId: second.sessionId, associationKey: "fixture-association", machineId: second.machineId, projectId: second.projectId, workspaceId: second.workspaceId } },
    { type: "checkpoint.replaced", producer: "fixture", sourceSessionId: second.sessionId, payload: { sessionId: second.sessionId, checkpoint: { id: "controlled-checkpoint", whatChanged: "Controlled checkpoint result", remains: "Controlled remaining work", next: "Controlled next step", nextSessionPrompt: "Resume controlled work", references: [] } } },
    { type: "human-task.upsert", producer: "fixture", sourceSessionId: second.sessionId, payload: { task: { id: "controlled-task", title: "Controlled owner decision", detail: "Should the isolated fixture proceed?", answerKind: "yes-no", materiality: "material", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] } } },
    { type: "human-task.upsert", producer: "fixture", sourceSessionId: second.sessionId, payload: { task: { id: "controlled-text-task", title: "Controlled written answer", detail: "Draft this answer across navigation.", answerKind: "free-text", materiality: "material", options: [] } } },
    { type: "link.upsert", producer: "fixture", sourceSessionId: second.sessionId, payload: { link: { id: "controlled-link", kind: "file", reference: '<img src=x onerror="window.__workstreamInjected=1">', label: "Controlled reference" } } },
  ] });
}

async function prepareFixture(stack) {
  await writeFile(stack.paths.config, `${JSON.stringify({
    host: "127.0.0.1", port: stack.ports.web, allowedHosts: true, spawnSessions: false, subsessions: false, askUser: true,
    pathAccess: { allowedPaths: [stack.root] }, plugins: {},
  }, null, 2)}\n`, "utf8");
  await writeFile(stack.paths.machines, '{"machines":[]}\n', { encoding: "utf8", mode: 0o600 });
}

function ownedFixtureUrl(webPort, anchor) {
  if (anchor === undefined) throw new Error("Controlled fixture needs a Chat anchor");
  const url = new URL(`http://127.0.0.1:${webPort}/`);
  url.searchParams.set("id", anchor.sessionId);
  url.searchParams.set("cwd", anchor.cwd);
  url.searchParams.set("machine", anchor.machineId);
  return url;
}

async function runOwnedBrowserAcceptance(cdp, webPort, fixture, runtime) {
  async function capture(name) {
    if (runtime.screenshotsDir === undefined) return;
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(runtime.screenshotsDir, `${name}.png`), Buffer.from(data, 'base64'));
  }
  const first = fixture.anchors[0];
  const base = ownedFixtureUrl(webPort, first);
  const statusUrl = new URL(`api/machines/local/sessions/${encodeURIComponent(first.sessionId)}/status`, base);
  statusUrl.searchParams.set("cwd", first.cwd);
  const serverStatus = await requestJson(statusUrl);
  const checks = [{ id: "real-daemon-pending-ask", passed: serverStatus.pendingAsk?.questions?.[0]?.id === "fixture-choice", detail: JSON.stringify({ sessionId: serverStatus.sessionId, askId: serverStatus.pendingAsk?.askId }) }];
  await waitForBrowserExpression(cdp, `document.querySelector('#connection')?.textContent?.includes('connected') === true`, 20_000);
  await waitForBrowserExpression(cdp, `document.querySelector('#ask form') !== null`, 10_000);
  const mounted = await evaluate(cdp, `({ history: document.querySelector('#history')?.textContent ?? '', ask: document.querySelector('#ask')?.textContent ?? '', earlier: document.querySelector('#earlier')?.hidden, queued: document.querySelector('#queued')?.textContent ?? '', queueHidden: document.querySelector('#queue')?.hidden })`);
  checks.push({ id: "owned-chat-history-and-question", passed: mounted.history.includes(first.transcriptMarker) && mounted.ask.includes("Which controlled fixture answer?") && mounted.earlier === false, detail: JSON.stringify({ marker: mounted.history.includes(first.transcriptMarker), ask: mounted.ask, earlier: mounted.earlier }) });
  const shell = await evaluate(cdp, `({ active: document.querySelector('.shell').classList.contains('chat-active'), chatWidth: document.querySelector('.conversation-panel').getBoundingClientRect().width, filesHidden: getComputedStyle(document.querySelector('#files')).display === 'none', composerVisible: document.querySelector('#composer').getBoundingClientRect().height > 0 })`);
  checks.push({ id: 'owned-chat-pi-web-style-shell', passed: shell.active && shell.chatWidth > 600 && shell.filesHidden && shell.composerVisible, detail: JSON.stringify(shell) });
  await capture('chat-desktop');
  const seededPageUrl = new URL(`api/machines/local/sessions/${encodeURIComponent(first.sessionId)}/messages?cwd=${encodeURIComponent(first.cwd)}&limit=20`, base);
  const seededPage = await requestJson(seededPageUrl);
  const structured = await evaluate(cdp, `({ headings: [...document.querySelectorAll('#history article strong')].slice(-2).map(node => node.textContent), thoughts: [...document.querySelectorAll('#history summary')].map(node => node.textContent), text: document.querySelector('#history').textContent, unsafeElements: document.querySelectorAll('#history img, #history script').length, injected: window.__transcriptInjected === 1 })`);
  const persistedAssistant = seededPage.messages.find(message => message.role === 'assistant' && message.content?.some?.(part => part.type === 'toolCall' && part.id === 'controlled-read'));
  checks.push({ id: "owned-chat-structured-tool-thinking-history", passed: persistedAssistant?.content.some(part => part.type === 'thinking' && part.thinking === 'Controlled thought block') && seededPage.messages.some(message => message.role === 'toolResult' && message.toolName === 'read') && structured.headings[0] === 'Assistant' && structured.headings[1] === 'Tool result · read' && structured.thoughts.includes('Thinking') && structured.thoughts.includes('Tool call · read') && structured.text.includes('Controlled structured reply') && structured.text.includes('Controlled tool output') && structured.unsafeElements === 0 && !structured.injected, detail: JSON.stringify({ headings: structured.headings, summaries: structured.thoughts, persisted: !!persistedAssistant, unsafeElements: structured.unsafeElements, injected: structured.injected }) });
  await waitForBrowserExpression(cdp, `document.querySelector('#dialogs h2')?.textContent === 'Controlled extension confirmation'`, 15_000);
  const openDialogs = await requestJson(statusUrl);
  checks.push({ id: "owned-chat-real-extension-dialogs", passed: JSON.stringify(openDialogs.pendingDialogs?.map(dialog => dialog.kind)) === JSON.stringify(['confirm', 'select', 'input']) && openDialogs.pendingDialogs.every(dialog => dialog.runScoped === false), detail: JSON.stringify(openDialogs.pendingDialogs?.map(dialog => ({ id: dialog.dialogId, kind: dialog.kind }))) });
  const pendingReload = cdp.waitForEvent("Page.loadEventFired", 20_000);
  await cdp.send("Page.reload"); await pendingReload;
  await waitForBrowserExpression(cdp, `document.querySelector('#connection')?.textContent?.includes('connected') === true && document.querySelector('#dialogs h2')?.textContent === 'Controlled extension confirmation'`, 20_000);
  checks.push({ id: "owned-chat-dialog-rehydrates-on-reload", passed: (await evaluate(cdp, `({ ask: document.querySelector('#ask form') !== null, count: document.querySelector('#dialogs small')?.textContent ?? '' })`)).ask && (await requestJson(statusUrl)).pendingDialogs?.length === 3, detail: "Pending ask and three daemon-owned dialogs survive browser reload" });
  await evaluate(cdp, `(() => { const original = window.fetch; window.__dialogCalls = []; window.fetch = (...args) => original(...args).then(async response => { if (args[1]?.method === 'POST' && String(args[0]).includes('/dialogs/')) window.__dialogCalls.push({ path: String(args[0]).split('/').at(-1), body: JSON.parse(args[1].body), status: response.status, result: (await response.clone().json()).result }); return response; }); })()`);
  const confirmReady = await evaluate(cdp, `({ buttons: [...document.querySelectorAll('#dialogs button')].map(button => button.textContent), heading: document.querySelector('#dialogs h2')?.textContent, connection: document.querySelector('#connection')?.textContent })`);
  if (!confirmReady.buttons.includes('Yes')) throw new Error(`Controlled dialog disappeared before confirmation: ${JSON.stringify({ ...confirmReady, server: (await requestJson(statusUrl)).pendingDialogs?.map(dialog => dialog.kind) })}`);
  try { await evaluate(cdp, `([...document.querySelectorAll('#dialogs button')].find(button => button.textContent === 'Yes')).click()`); }
  catch (error) { throw new Error(`Controlled dialog changed after reload: ${JSON.stringify({ before: confirmReady, after: await evaluate(cdp, `({ buttons: [...document.querySelectorAll('#dialogs button')].map(button => button.textContent), heading: document.querySelector('#dialogs h2')?.textContent, connection: document.querySelector('#connection')?.textContent })`), server: (await requestJson(statusUrl)).pendingDialogs?.map(dialog => dialog.kind) })}`, { cause: error }); }
  await waitForBrowserExpression(cdp, `document.querySelector('#dialogs h2')?.textContent === 'Controlled extension choice' && document.querySelector('#dialogs select')?.disabled === false`, 15_000);
  const afterConfirm = await requestJson(statusUrl);
  checks.push({ id: "owned-chat-confirm-through-real-daemon", passed: afterConfirm.pendingDialogs?.length === 2 && !afterConfirm.pendingDialogs.some(dialog => dialog.kind === 'confirm'), detail: JSON.stringify(afterConfirm.pendingDialogs?.map(dialog => dialog.kind)) });
  await evaluate(cdp, `(() => { document.querySelector('#dialogs select').value = 'Second'; document.querySelector('#dialogs button[type="submit"]').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#dialogs h2')?.textContent === 'Controlled extension input' && document.querySelector('#dialogs input')?.disabled === false`, 15_000);
  const afterSelect = await requestJson(statusUrl);
  checks.push({ id: "owned-chat-select-through-real-daemon", passed: afterSelect.pendingDialogs?.length === 1 && afterSelect.pendingDialogs[0].kind === 'input', detail: JSON.stringify(afterSelect.pendingDialogs?.map(dialog => dialog.kind)) });
  await evaluate(cdp, `([...document.querySelectorAll('#dialogs button')].find(button => button.textContent === 'Cancel dialog')).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#dialogs form') === null`, 15_000);
  const dialogCalls = await evaluate(cdp, `window.__dialogCalls`);
  checks.push({ id: "owned-chat-cancel-through-real-daemon", passed: !(await requestJson(statusUrl)).pendingDialogs?.length && JSON.stringify(dialogCalls.map(call => [call.path, call.body.value, call.status, call.result])) === JSON.stringify([['answer', true, 200, 'closed'], ['answer', 'Second', 200, 'closed'], ['cancel', undefined, 200, 'closed']]) && dialogCalls.every((call, index) => call.body.cwd === first.cwd && call.body.dialogId === openDialogs.pendingDialogs[index].dialogId), detail: JSON.stringify(dialogCalls) });
  const modelUrl = new URL(`api/machines/local/sessions/${encodeURIComponent(first.sessionId)}/models?cwd=${encodeURIComponent(first.cwd)}`, base);
  const levelsUrl = new URL(`api/machines/local/sessions/${encodeURIComponent(first.sessionId)}/thinking-levels?cwd=${encodeURIComponent(first.cwd)}`, base);
  const [availableModels, availableLevels] = await Promise.all([requestJson(modelUrl), requestJson(levelsUrl)]);
  const limitations = [{ code: "QUEUE_FIXTURE_EMPTY", state: "partial", message: "Fixture has no queued messages; real promote/clear behavior is only covered by deterministic client tests, not browser acceptance." }, { code: "ROSTER_STATUS_INJECTED", state: "partial", message: "The isolated daemon has no live Worker/Subagent; browser roster projection uses a controlled activity payload injected into its real status response. Live execution/binding still needs a bounded smoke." }];
  checks.push({ id: "owned-chat-empty-queue-state", passed: !serverStatus.pendingMessageCount && !serverStatus.queuedMessages.length && mounted.queued === '' && mounted.queueHidden === !(serverStatus.isStreaming || serverStatus.isCompacting), detail: JSON.stringify({ queueHidden: mounted.queueHidden, queued: mounted.queued, isStreaming: serverStatus.isStreaming }) });
  if (!availableModels.models.length) {
    limitations.push({ code: "NO_FIXTURE_MODELS", state: "partial", message: "Credential-free fixture offers no model: real model mutation is untested; deterministic client tests cover selection and server response." });
    limitations.push({ code: "IMAGE_NO_MODEL", state: "partial", message: "Image prompt reaches the real daemon and is accepted, but this fixture cannot establish that a model consumed the image or produced a response." });
  }
  if (availableLevels.levels.length < 2) limitations.push({ code: "SINGLE_FIXTURE_THINKING_LEVEL", state: "partial", message: "Only one thinking level is available: mutation verifies the real route and response but not a value transition." });
  await waitForBrowserExpression(cdp, `document.querySelector('#thinking option')?.textContent !== 'Loading…' && document.querySelector('#thinking')?.disabled === ${availableLevels.levels.length === 0}`, 15_000);
  const controlView = await evaluate(cdp, `({ models: [...document.querySelector('#model').options].slice(1).map(o => JSON.parse(o.value)), levels: [...document.querySelector('#thinking').options].slice(1).map(o => o.value), modelDisabled: document.querySelector('#model').disabled, thinkingDisabled: document.querySelector('#thinking').disabled })`);
  checks.push({ id: "owned-chat-model-thinking-options", passed: JSON.stringify(controlView.models) === JSON.stringify(availableModels.models.map(m => [m.provider, m.id])) && JSON.stringify(controlView.levels) === JSON.stringify(availableLevels.levels) && controlView.modelDisabled === (availableModels.models.length === 0) && controlView.thinkingDisabled === (availableLevels.levels.length === 0), detail: JSON.stringify(controlView) });
  if (availableLevels.levels.length) {
    await evaluate(cdp, `(() => { const original = window.fetch; window.__controlCalls = []; window.fetch = (...args) => original(...args).then(response => { if (args[1]?.method === 'POST' && String(args[0]).endsWith('/thinking-level')) window.__controlCalls.push({ status: response.status, body: JSON.parse(args[1].body) }); return response; }); })()`);
    const chosenLevel = availableLevels.levels.find(level => level !== serverStatus.thinkingLevel) ?? availableLevels.levels[0];
    await evaluate(cdp, `(() => { const select = document.querySelector('#thinking'); select.value = ${JSON.stringify(chosenLevel)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    try { await waitForBrowserExpression(cdp, `window.__controlCalls?.length === 1 && document.querySelector('#thinking')?.disabled === false`, 15_000); }
    catch (error) { throw new Error(`Thinking mutation did not settle: ${JSON.stringify(await evaluate(cdp, `({ calls: window.__controlCalls, disabled: document.querySelector('#thinking')?.disabled, value: document.querySelector('#thinking')?.value, error: document.querySelector('#error')?.textContent, connection: document.querySelector('#connection')?.textContent })`))}`, { cause: error }); }
    const result = await evaluate(cdp, `({ call: window.__controlCalls[0], selected: document.querySelector('#thinking').value, error: document.querySelector('#error').textContent })`);
    const updatedStatus = await requestJson(statusUrl);
    checks.push({ id: "owned-chat-thinking-mutation", passed: result.call.status === 200 && result.call.body.cwd === first.cwd && result.call.body.level === chosenLevel && result.selected === chosenLevel && updatedStatus.thinkingLevel === chosenLevel && !result.error, detail: JSON.stringify({ ...result, serverThinking: updatedStatus.thinkingLevel }) });
  }
  await evaluate(cdp, `(() => { window.__historyAnchor = document.querySelector('#history article'); window.__historyDetail = document.querySelector('#history article details'); if (window.__historyDetail) window.__historyDetail.open = true; window.__askDraftForm = document.querySelector('#ask form'); document.querySelector('#ask input[type="text"]').value = 'Unsubmitted answer'; document.querySelector('#ask input[value="one"]').click(); document.querySelector('#earlier').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#earlier')?.hidden === true`, 10_000);
  const askDraft = await evaluate(cdp, `({ sameForm: window.__askDraftForm === document.querySelector('#ask form'), text: document.querySelector('#ask input[type="text"]')?.value, chosen: document.querySelector('#ask input[value="one"]')?.checked })`);
  checks.push({ id: "owned-chat-pending-answer-survives-history-and-status-rerender", passed: askDraft.sameForm && askDraft.text === 'Unsubmitted answer' && askDraft.chosen === true, detail: JSON.stringify(askDraft) });
  await evaluate(cdp, `document.querySelector('#ask input[type="text"]').value = ''`);
  const page = await evaluate(cdp, `document.querySelector('#history')?.textContent ?? ''`);
  checks.push({ id: "owned-chat-history-paging", passed: page.includes(`${first.transcriptMarker} page 1`), detail: JSON.stringify({ firstPagePresent: page.includes(`${first.transcriptMarker} page 1`) }) });
  const retainedHistory = await evaluate(cdp, `({ anchor: [...document.querySelectorAll('#history article')].includes(window.__historyAnchor), expanded: window.__historyDetail?.isConnected && window.__historyDetail.open })`);
  checks.push({ id: "owned-chat-transcript-retains-expanded-history-during-paging", passed: retainedHistory.anchor && retainedHistory.expanded, detail: JSON.stringify(retainedHistory) });
  await evaluate(cdp, `(() => { const input = document.querySelector('#ask input[value="one"]'); if (!input) throw Error('Fixture ask option missing'); input.click(); document.querySelector('#ask button').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#ask form') === null`, 15_000);
  const closed = await requestJson(statusUrl);
  checks.push({ id: "owned-chat-answer-through-real-daemon", passed: closed.pendingAsk === undefined, detail: JSON.stringify({ sessionId: closed.sessionId, pendingAsk: closed.pendingAsk?.askId }) });
  await evaluate(cdp, `(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })); const input = document.querySelector('#image-input'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  checks.push({ id: "owned-chat-rejects-unsupported-attachment", passed: (await evaluate(cdp, `({ error: document.querySelector('#image-error').textContent, staged: document.querySelector('#images').children.length })`)).staged === 0 && (await evaluate(cdp, `document.querySelector('#image-error').textContent`)).includes('Other files cannot be attached yet'), detail: "SVG file rejected without staging or a server request" });
  await evaluate(cdp, `(async () => { const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'isolated.png', { type: 'image/png' })); const input = document.querySelector('#image-input'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#images')?.textContent?.includes('[PIC_1] isolated.png') === true`, 10_000);
  await evaluate(cdp, `(() => { const original = window.fetch; window.__attachmentCalls = []; window.__promptResponses = []; window.__rejectImageOnce = true; window.__disconnectImageOnce = false; window.fetch = (...args) => { if (args[1]?.method === 'POST' && String(args[0]).endsWith('/prompt')) { const body = JSON.parse(args[1].body); window.__attachmentCalls.push({ cwd: body.cwd, text: body.text, kind: body.attachments?.[0]?.kind, reference: body.attachments?.[0]?.reference, mimeType: body.attachments?.[0]?.mimeType, name: body.attachments?.[0]?.name, dataLength: body.attachments?.[0]?.data?.length }); if (window.__rejectImageOnce) { window.__rejectImageOnce = false; return Promise.resolve(new Response('{"error":"controlled rejection"}', { status: 400 })); } if (window.__disconnectImageOnce) { window.__disconnectImageOnce = false; return Promise.reject(new Error('controlled disconnect')); } } return original(...args).then(async response => { if (String(args[0]).endsWith('/prompt')) window.__promptResponses.push({ status: response.status, contentType: response.headers.get('content-type'), text: await response.clone().text() }); return response; }); }; const draft = document.querySelector('#draft'); draft.value = 'Image from isolated fixture'; draft.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#send').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#error')?.textContent?.includes('400') === true`, 10_000);
  const retained = await evaluate(cdp, `({ draft: document.querySelector('#draft').value, staged: document.querySelector('#images').textContent, calls: window.__attachmentCalls.length })`);
  checks.push({ id: "owned-chat-image-rejection-keeps-draft", passed: retained.draft === 'Image from isolated fixture' && retained.staged.includes('[PIC_1] isolated.png') && retained.calls === 1, detail: JSON.stringify(retained) });
  await evaluate(cdp, `(() => { window.__disconnectImageOnce = true; document.querySelector('#send').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#retry-send')?.hidden === false && document.querySelector('#send')?.disabled === true`, 10_000);
  const uncertain = await evaluate(cdp, `({ staged: document.querySelector('#images').textContent, draft: document.querySelector('#draft').value, error: document.querySelector('#error').textContent, calls: window.__attachmentCalls.length })`);
  checks.push({ id: "owned-chat-unknown-image-send-locks-retry", passed: uncertain.calls === 2 && uncertain.draft === 'Image from isolated fixture' && uncertain.staged.includes('[PIC_1]') && uncertain.error.includes('Check transcript'), detail: JSON.stringify(uncertain) });
  await evaluate(cdp, `(() => { const original = window.confirm; window.confirm = () => true; document.querySelector('#retry-send').click(); window.confirm = original; document.querySelector('#send').click(); })()`);
  await waitForBrowserExpression(cdp, `window.__attachmentCalls?.length === 3 && document.querySelector('#images')?.children.length === 0`, 15_000);
  const imageSend = await evaluate(cdp, `({ calls: window.__attachmentCalls, draft: document.querySelector('#draft').value, error: document.querySelector('#error').textContent, responses: window.__promptResponses })`);
  checks.push({ id: "owned-chat-image-through-real-daemon", passed: imageSend.calls.every(call => call.cwd === first.cwd && call.text === 'Image from isolated fixture' && call.kind === 'image' && call.reference === '[PIC_1]' && call.mimeType === 'image/png' && call.name === 'isolated.png' && call.dataLength > 40) && imageSend.draft === '' && !imageSend.error, detail: JSON.stringify(imageSend) });
  await evaluate(cdp, `(() => { const draft = document.querySelector('#draft'); draft.value = 'first line\\nsecond line'; draft.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const composer = await evaluate(cdp, `({ nativeEditor: document.querySelector('#draft') instanceof HTMLTextAreaElement, send: document.querySelector('#send') instanceof HTMLButtonElement, stop: document.querySelector('#stop') instanceof HTMLButtonElement })`);
  checks.push({ id: "owned-chat-composer-controls", passed: composer.nativeEditor && composer.send && composer.stop, detail: JSON.stringify(composer) });
  await evaluate(cdp, `(async () => { const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'unsubmitted.png', { type: 'image/png' })); const input = document.querySelector('#image-input'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#images')?.textContent?.includes('unsubmitted.png') === true`, 10_000);
  const reload = cdp.waitForEvent("Page.loadEventFired", 20_000);
  await cdp.send("Page.reload"); await reload;
  await waitForBrowserExpression(cdp, `document.querySelector('#connection')?.textContent?.includes('connected') === true`, 20_000);
  const afterReload = await evaluate(cdp, `({ history: document.querySelector('#history')?.textContent ?? '', ask: document.querySelector('#ask form') !== null, draft: document.querySelector('#draft')?.value ?? '', staged: document.querySelector('#images')?.children.length ?? -1 })`);
  assertChildAlive(runtime.sessiond);
  checks.push({ id: "owned-chat-reload-and-daemon-continuity", passed: afterReload.history.includes(first.transcriptMarker) && !afterReload.ask && afterReload.draft === 'first line\nsecond line' && afterReload.staged === 0, detail: JSON.stringify({ history: afterReload.history.includes(first.transcriptMarker), ask: afterReload.ask, draft: afterReload.draft, staged: afterReload.staged, sessiondPid: runtime.sessiond.pid }) });
  const initialIdentity = await evaluate(cdp, `({ project: new URL(location.href).searchParams.get('project'), workspace: new URL(location.href).searchParams.get('workspace'), session: new URL(location.href).searchParams.get('id') })`);
  checks.push({ id: "owned-chat-catalog-identity", passed: initialIdentity.project === first.projectId && initialIdentity.workspace === first.workspaceId && initialIdentity.session === first.sessionId, detail: JSON.stringify(initialIdentity) });
  const second = fixture.anchors[1];
  await evaluate(cdp, `document.querySelector('#chat-back').click()`);
  const chooser = await evaluate(cdp, `(() => { const card = document.querySelector('.navigation-panel').getBoundingClientRect(); const controls = [...document.querySelectorAll('#workstreams .section-header button')].map(node => node.getBoundingClientRect().right); return { visible: card.width > 0, chatHidden: getComputedStyle(document.querySelector('.conversation-panel')).display === 'none', cardRight: card.right, controlRight: Math.max(...controls) }; })()`);
  checks.push({ id: 'owned-chat-chooser-back-navigation', passed: chooser.visible && chooser.chatHidden && chooser.controlRight <= chooser.cardRight, detail: JSON.stringify(chooser) });
  await capture('chooser-desktop');
  await evaluate(cdp, `([...document.querySelectorAll('#catalog button')].find(x => x.textContent === 'Controlled project 2') ?? (() => { throw Error('No second project') })()).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#catalog')?.textContent?.includes('Borealis files') === true`, 15_000);
  const chosen = await evaluate(cdp, `({ workspace: document.querySelector('#catalog select')?.value, session: new URL(location.href).searchParams.get('id') })`);
  checks.push({ id: "owned-chat-workspace-navigation", passed: chosen.workspace === second.workspaceId && chosen.session === null, detail: JSON.stringify(chosen) });
  await evaluate(cdp, `([...document.querySelectorAll('#catalog button')].find(x => x.textContent === 'Borealis files') ?? (() => { throw Error('No second session') })()).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#history')?.textContent?.includes(${JSON.stringify(second.transcriptMarker)}) === true`, 20_000);
  const existing = await evaluate(cdp, `({ id: new URL(location.href).searchParams.get('id'), project: new URL(location.href).searchParams.get('project'), workspace: new URL(location.href).searchParams.get('workspace') })`);
  checks.push({ id: "owned-chat-existing-session-navigation", passed: existing.id === second.sessionId && existing.project === second.projectId && existing.workspace === second.workspaceId, detail: JSON.stringify(existing) });
  await evaluate(cdp, `document.querySelector('#chat-back').click()`);
  await evaluate(cdp, `([...document.querySelectorAll('#catalog button')].find(x => x.textContent === 'Controlled project 1')).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#catalog')?.textContent?.includes('Atlas transcript') === true`, 15_000);
  await evaluate(cdp, `([...document.querySelectorAll('#catalog button')].find(x => x.textContent === 'New Chat')).click()`);
  await waitForBrowserExpression(cdp, `new URL(location.href).searchParams.get('id') !== null`, 30_000);
  const created = await evaluate(cdp, `({ id: new URL(location.href).searchParams.get('id'), project: new URL(location.href).searchParams.get('project'), workspace: new URL(location.href).searchParams.get('workspace'), error: document.querySelector('#catalog-error')?.textContent })`);
  const createdStatus = await requestJson(new URL(`api/machines/local/sessions/${encodeURIComponent(created.id)}/status?cwd=${encodeURIComponent(first.cwd)}`, base));
  checks.push({ id: "owned-chat-new-session-identity", passed: created.id !== first.sessionId && created.project === first.projectId && created.workspace === first.workspaceId && createdStatus.sessionId === created.id && !created.error, detail: JSON.stringify(created) });
  const reloadNew = cdp.waitForEvent("Page.loadEventFired", 20_000);
  await cdp.send("Page.reload"); await reloadNew;
  await waitForBrowserExpression(cdp, `document.querySelector('#connection')?.textContent?.includes('connected') === true`, 20_000);
  const resumed = await evaluate(cdp, `({ id: new URL(location.href).searchParams.get('id'), listed: document.querySelector('#catalog')?.textContent?.includes('New Chat (not yet saved)'), error: document.querySelector('#catalog-error')?.textContent })`);
  checks.push({ id: "owned-chat-transient-session-reload", passed: resumed.id === created.id && resumed.listed && !resumed.error, detail: JSON.stringify(resumed) });
  await evaluate(cdp, `document.querySelector('#workstreams-toggle').click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail')?.textContent?.includes('Controlled checkpoint result') === true`, 15_000);
  const workstream = await evaluate(cdp, `({ text: document.querySelector('#workstreams').textContent, revision: document.querySelector('#workstream-detail h3')?.textContent, injected: window.__workstreamInjected === 1, unsafeElements: document.querySelectorAll('#workstreams img').length, error: document.querySelector('#workstream-error').textContent })`);
  await capture('workstreams-desktop');
  checks.push({ id: "owned-workstreams-real-service-projection", passed: workstream.text.includes('Controlled owner decision · pending') && workstream.text.includes('Controlled reference') && workstream.text.includes('Controlled next step') && workstream.revision.includes('revision 2') && workstream.unsafeElements === 0 && !workstream.injected && !workstream.error, detail: JSON.stringify({ revision: workstream.revision, task: workstream.text.includes('Controlled owner decision · pending'), link: workstream.text.includes('Controlled reference'), error: workstream.error, unsafeElements: workstream.unsafeElements }) });
  await evaluate(cdp, `Array.from(document.querySelectorAll('#workstream-detail article')).find(item => item.textContent.includes('Controlled owner decision')).querySelector('button').click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail')?.textContent?.includes('Controlled owner decision · answered') === true`, 15_000);
  const answered = await evaluate(cdp, `({ heading: document.querySelector('#workstream-detail h3').textContent, task: Array.from(document.querySelectorAll('#workstream-detail article')).find(item => item.textContent.includes('Controlled owner decision')).textContent, error: document.querySelector('#workstream-error').textContent })`);
  checks.push({ id: "owned-workstreams-human-task-real-store-answer", passed: answered.heading.includes('revision 3') && answered.task.includes('Answer: Yes · revision 3') && !answered.error, detail: JSON.stringify(answered) });
  await evaluate(cdp, `document.querySelector('#workstream-refresh').click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail h3')?.textContent?.includes('revision 3') === true`, 15_000);
  checks.push({ id: "owned-workstreams-manual-refresh", passed: (await evaluate(cdp, `document.querySelector('#workstream-error').textContent`)) === '', detail: 'Scoped service re-read after answer' });
  await evaluate(cdp, `(() => { const draft = document.querySelector('#workstream-detail textarea'); draft.value = '<img src=x onerror=window.__taskInjected=1> preserved answer'; draft.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#workstream-refresh').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail textarea')?.value?.includes('preserved answer') === true`, 15_000);
  checks.push({ id: "owned-workstreams-unsubmitted-draft-survives-refresh", passed: (await evaluate(cdp, `({ text: document.querySelector('#workstream-detail textarea')?.value, unsafe: document.querySelectorAll('#workstream-detail img').length, injected: window.__taskInjected === 1 })`)).unsafe === 0 && !(await evaluate(cdp, `window.__taskInjected === 1`)), detail: 'Free-text draft remains inert across scoped service refresh' });
  await evaluate(cdp, `([...document.querySelectorAll('#workstream-detail button')].find(x => x.textContent === 'Open associated Chat')).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#history')?.textContent?.includes(${JSON.stringify(second.transcriptMarker)}) === true`, 20_000);
  const association = await evaluate(cdp, `({ id: new URL(location.href).searchParams.get('id'), project: new URL(location.href).searchParams.get('project'), workspace: new URL(location.href).searchParams.get('workspace'), error: document.querySelector('#workstream-error').textContent })`);
  checks.push({ id: "owned-workstreams-confirmed-session-navigation", passed: association.id === second.sessionId && association.project === second.projectId && association.workspace === second.workspaceId && !association.error, detail: JSON.stringify(association) });
  await navigate(cdp, await evaluate(cdp, 'location.href'), 20_000);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail')?.textContent?.includes('Controlled owner decision · answered') === true`, 15_000);
  const restored = await evaluate(cdp, `({ heading: document.querySelector('#workstream-detail h3')?.textContent, error: document.querySelector('#workstream-error')?.textContent, task: Array.from(document.querySelectorAll('#workstream-detail article')).find(item => item.textContent.includes('Controlled owner decision'))?.textContent })`);
  checks.push({ id: "owned-workstreams-answer-persists-after-reload", passed: restored.heading?.includes('revision 3') && restored.task?.includes('Answer: Yes') && !restored.error, detail: JSON.stringify(restored) });
  const retainedDraft = await evaluate(cdp, `({ text: document.querySelector('#workstream-detail textarea')?.value, keys: [...Array(sessionStorage.length).keys()].map(index => sessionStorage.key(index)).filter(key => key.startsWith('workbench:workstream:draft:')), location: location.href, injected: window.__taskInjected === 1, unsafe: document.querySelectorAll('#workstream-detail img').length })`);
  retainedDraft.stored = retainedDraft.keys.length;
  checks.push({ id: "owned-workstreams-draft-survives-chat-navigation-and-reload", passed: retainedDraft.text === '<img src=x onerror=window.__taskInjected=1> preserved answer' && retainedDraft.stored === 1 && !retainedDraft.injected && retainedDraft.unsafe === 0, detail: JSON.stringify(retainedDraft) });
  if (!retainedDraft.text?.includes('preserved answer')) throw new Error(`Draft was not restored: ${JSON.stringify(retainedDraft)}`);
  await evaluate(cdp, `document.querySelector('#workstream-detail form button').click()`);
  try { await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail h3')?.textContent?.includes('revision 4') === true || document.querySelector('#workstream-error')?.textContent?.length > 0`, 15_000); }
  catch (error) { throw new Error(`Draft submit did not settle: ${JSON.stringify(await evaluate(cdp, `({ heading: document.querySelector('#workstream-detail h3')?.textContent, error: document.querySelector('#workstream-error')?.textContent, form: document.querySelector('#workstream-detail form')?.outerHTML, value: document.querySelector('#workstream-detail textarea')?.value, connection: document.querySelector('#connection')?.textContent })`))}`, { cause: error }); }
  const submittedDraft = await evaluate(cdp, `({ error: document.querySelector('#workstream-error')?.textContent, heading: document.querySelector('#workstream-detail h3')?.textContent, task: [...document.querySelectorAll('#workstream-detail article')].find(item => item.textContent.includes('Controlled written answer'))?.textContent, stored: [...Array(sessionStorage.length).keys()].map(index => sessionStorage.key(index)).filter(key => key.startsWith('workbench:workstream:draft:')).length, injected: window.__taskInjected === 1, unsafe: document.querySelectorAll('#workstream-detail img').length })`);
  if (!submittedDraft.heading?.includes('revision 4')) throw new Error(`Draft answer did not commit: ${JSON.stringify(submittedDraft)}`);
  checks.push({ id: "owned-workstreams-draft-commits-exact-answer-and-clears", passed: submittedDraft.task?.includes('Answer: <img src=x onerror=window.__taskInjected=1> preserved answer · revision 4') && submittedDraft.stored === 0 && !submittedDraft.injected && submittedDraft.unsafe === 0, detail: JSON.stringify(submittedDraft) });
  const externalStore = createUserLocalWorkstreamStore({ directory: runtime.workstreamsDirectory });
  await externalStore.append({ workstreamId: 'ws-controlled-owned', expectedRevision: 4, idempotencyKey: 'fixture-external-task', records: [{ type: 'human-task.upsert', producer: 'fixture', sourceSessionId: fixture.anchors[1].sessionId, payload: { task: { id: 'controlled-external-task', title: 'Externally added task', answerKind: 'free-text', materiality: 'material', options: [] } } }] });
  await evaluate(cdp, `document.querySelector('#workstream-check').click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-error')?.textContent?.includes('refresh and review') === true`, 15_000);
  const watched = await evaluate(cdp, `({ heading: document.querySelector('#workstream-detail h3')?.textContent, error: document.querySelector('#workstream-error')?.textContent, newTask: document.querySelector('#workstream-detail')?.textContent?.includes('Externally added task') })`);
  checks.push({ id: 'owned-workstreams-real-watch-flags-stale-snapshot', passed: watched.heading?.includes('revision 4') && watched.error.includes('refresh and review') && !watched.newTask, detail: JSON.stringify(watched) });
  await evaluate(cdp, `document.querySelector('#workstream-refresh').click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail h3')?.textContent?.includes('revision 5') === true`, 15_000);
  checks.push({ id: 'owned-workstreams-watch-reconciles-after-refresh', passed: (await evaluate(cdp, `({ task: document.querySelector('#workstream-detail')?.textContent?.includes('Externally added task'), error: document.querySelector('#workstream-error')?.textContent })`)).task === true, detail: 'Registered Workstream service returned externally added task after explicit refresh' });
  await evaluate(cdp, `(() => { const original = window.fetch; window.__savedFetch = original; window.fetch = (...args) => String(args[0]).endsWith('/append') ? Promise.reject(Error('Controlled lost response before commit')) : original(...args); const text = document.querySelector('#workstream-detail textarea'); text.value = 'My uncommitted answer'; text.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#workstream-detail form button').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-error')?.textContent?.includes('Answer outcome unknown') === true`, 15_000);
  await evaluate(cdp, `window.fetch = window.__savedFetch`);
  await evaluate(cdp, `([...document.querySelectorAll('#catalog button')].find(x => x.textContent === 'Controlled project 1')).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail h3')?.textContent?.includes('revision 5') === true`, 15_000);
  const crossScopeAnswer = await evaluate(cdp, `({ retry: document.querySelector('#workstream-detail')?.textContent?.includes('Retry the exact saved answer'), stored: [...Array(localStorage.length).keys()].map(index => localStorage.key(index)).filter(key => key.startsWith('workbench:workstream:answer:')).length })`);
  checks.push({ id: 'owned-workstreams-unknown-answer-follows-workspace-switch', passed: crossScopeAnswer.retry && crossScopeAnswer.stored === 1, detail: JSON.stringify(crossScopeAnswer) });
  await externalStore.append({ workstreamId: 'ws-controlled-owned', expectedRevision: 5, idempotencyKey: 'fixture-competing-answer', records: [{ type: 'human-task.answered', producer: 'fixture', sourceSessionId: fixture.anchors[1].sessionId, payload: { taskId: 'controlled-external-task', answerId: 'fixture-answer-b', answer: { kind: 'free-text', text: 'Other answer B' } } }] });
  await evaluate(cdp, `document.querySelector('#workstream-refresh').click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail h3')?.textContent?.includes('revision 6') === true`, 15_000);
  const answerConflictView = await evaluate(cdp, `({ text: document.querySelector('#workstream-detail')?.textContent, error: document.querySelector('#workstream-error')?.textContent, stored: [...Array(localStorage.length).keys()].map(index => localStorage.key(index)).filter(key => key.startsWith('workbench:workstream:answer:')).length })`);
  checks.push({ id: 'owned-workstreams-competing-answer-preserves-unknown-request', passed: answerConflictView.text?.includes('My uncommitted answer') && answerConflictView.text?.includes('Other answer B') && answerConflictView.error?.includes('different saved answer is preserved') && answerConflictView.stored === 1, detail: JSON.stringify({ preserved: answerConflictView.text?.includes('My uncommitted answer'), other: answerConflictView.text?.includes('Other answer B'), error: answerConflictView.error, stored: answerConflictView.stored }) });
  await evaluate(cdp, `(() => { window.confirm = () => true; [...document.querySelectorAll('#workstream-detail button')].find(x => x.textContent.includes('discard saved answer')).click(); })()`);
  const dismissed = await evaluate(cdp, `[...Array(localStorage.length).keys()].map(index => localStorage.key(index)).filter(key => key.startsWith('workbench:workstream:answer:')).length`);
  checks.push({ id: 'owned-workstreams-explicit-conflict-dismissal', passed: dismissed === 0, detail: `Saved unknown request count after explicit dismissal: ${dismissed}` });
  await evaluate(cdp, `(() => { const title = document.querySelector('#workstream-title'); title.value = '<img src=x onerror=window.__createdTitleInjected=1> Owned creation'; const original = window.fetch; window.__savedFetch = original; window.fetch = async (...args) => { const result = await original(...args); if (String(args[0]).endsWith('/create')) throw Error('Controlled lost create response after commit'); return result; }; document.querySelector('#workstream-create button').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-error')?.textContent?.includes('Creation outcome unknown') === true`, 15_000);
  const pendingCreate = await evaluate(cdp, `({ locked: document.querySelector('#workstream-create button').disabled, retry: document.querySelector('#workstream-list')?.textContent?.includes('Retry exact saved Workstream creation'), stored: [...Array(localStorage.length).keys()].map(index => localStorage.key(index)).filter(key => key.startsWith('workbench:workstream:create:')).length })`);
  checks.push({ id: 'owned-workstreams-unknown-create-blocks-duplicate', passed: pendingCreate.locked && pendingCreate.retry && pendingCreate.stored === 1, detail: JSON.stringify(pendingCreate) });
  await evaluate(cdp, `(() => { window.fetch = window.__savedFetch; document.querySelector('#workstream-refresh').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail h3')?.textContent?.includes('Owned creation') === true`, 15_000);
  const createdWorkstream = await evaluate(cdp, `({ title: document.querySelector('#workstream-detail h3')?.textContent, stored: [...Array(localStorage.length).keys()].map(index => localStorage.key(index)).filter(key => key.startsWith('workbench:workstream:create:')).length, unsafe: document.querySelectorAll('#workstreams img').length, injected: window.__createdTitleInjected === 1, error: document.querySelector('#workstream-error').textContent })`);
  const createdSummaries = await externalStore.list();
  checks.push({ id: 'owned-workstreams-lost-create-response-reconciles-real-store', passed: createdWorkstream.title?.includes('revision 1') && createdWorkstream.stored === 0 && !createdWorkstream.unsafe && !createdWorkstream.injected && !createdWorkstream.error && createdSummaries.filter(item => item.title?.includes('Owned creation')).length === 1, detail: JSON.stringify(createdWorkstream) });
  const createdWorkstreamId = createdSummaries.find(item => item.title?.includes('Owned creation'))?.id;
  if (!createdWorkstreamId) throw new Error('Owned Workstream creation identity missing');
  await evaluate(cdp, `(() => { const original = window.fetch; window.__launchPostCount = 0; window.fetch = async (...args) => { if (args[1]?.method === 'POST' && String(args[0]) === '/api/machines/local/sessions') { window.__launchPostCount++; const created = await original(...args); window.__launchPostStatus = created.status; window.__launchPostBody = await created.clone().text(); throw Error('Controlled lost launch response after creation'); } return original(...args); }; [...document.querySelectorAll('#workstream-detail button')].find(x => x.textContent === 'Start Workstream Chat').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail')?.textContent?.includes('Reconcile launch (no new session POST)') === true`, 20_000);
  const uncertainLaunch = await evaluate(cdp, `({ posts: window.__launchPostCount, status: window.__launchPostStatus, body: window.__launchPostBody, stored: [...Array(localStorage.length).keys()].map(i => localStorage.key(i)).filter(key => key.startsWith('workbench:workstream:launch-prompt:')).length, urlId: new URL(location.href).searchParams.get('id') })`);
  const pendingLaunchSnapshot = await externalStore.inspect(createdWorkstreamId);
  const lookupUrl = new URL(`api/machines/local/sessions/workstream-launch/${encodeURIComponent(pendingLaunchSnapshot.sessions[0].associationKey)}?cwd=${encodeURIComponent(first.cwd)}`, base);
  const launchLookup = await requestJson(lookupUrl);
  checks.push({ id: 'owned-workstreams-lost-session-response-preserves-exact-launch', passed: uncertainLaunch.posts === 1 && uncertainLaunch.status === 200 && uncertainLaunch.stored === 1 && uncertainLaunch.urlId === null && pendingLaunchSnapshot.sessions.length === 1 && pendingLaunchSnapshot.sessions[0].status === 'pending' && launchLookup.status === 'found', detail: JSON.stringify({ ...uncertainLaunch, launchLookup, sessionStatuses: pendingLaunchSnapshot.sessions.map(item => item.status) }) });
  await navigate(cdp, await evaluate(cdp, 'location.href'), 20_000);
  try { await waitForBrowserExpression(cdp, `document.querySelector('#workstream-list')?.textContent?.includes('Owned creation') === true`, 20_000); }
  catch (error) { throw new Error(`Lost-launch reload failed: ${JSON.stringify(await evaluate(cdp, `({ connection: document.querySelector('#connection')?.textContent, error: document.querySelector('#error')?.textContent, catalog: document.querySelector('#catalog-error')?.textContent, url: location.href })`))}`, { cause: error }); }
  await evaluate(cdp, `([...document.querySelectorAll('#workstream-list button')].find(x => x.textContent.includes('Owned creation'))).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail')?.textContent?.includes('Reconcile launch (no new session POST)') === true`, 15_000);
  await evaluate(cdp, `(() => { const original = window.fetch; window.__reconcilePosts = 0; window.fetch = (...args) => { if (args[1]?.method === 'POST' && String(args[0]) === '/api/machines/local/sessions') window.__reconcilePosts++; return original(...args); }; [...document.querySelectorAll('#workstream-detail button')].find(x => x.textContent.includes('Reconcile launch')).click(); })()`);
  try { await waitForBrowserExpression(cdp, `document.querySelector('#draft')?.value?.includes('You are pairing in Pi Workbench Workstream') === true && document.querySelector('#connection')?.textContent?.includes('connected') === true`, 20_000); }
  catch (error) { throw new Error(`Launch reconcile did not open reviewable Chat: ${JSON.stringify(await evaluate(cdp, `({ draft: document.querySelector('#draft')?.value?.slice(0, 200), connection: document.querySelector('#connection')?.textContent, error: document.querySelector('#workstream-error')?.textContent, catalog: document.querySelector('#catalog-error')?.textContent, url: location.href })`))}`, { cause: error }); }
  const launched = await evaluate(cdp, `({ id: new URL(location.href).searchParams.get('id'), draft: document.querySelector('#draft').value, posts: window.__reconcilePosts, sendUnknown: document.querySelector('#retry-send')?.hidden === false })`);
  const confirmedLaunch = await externalStore.inspect(createdWorkstreamId);
  checks.push({ id: 'owned-workstreams-reconciles-session-with-reviewable-draft-no-send', passed: launched.id && launched.id !== second.sessionId && launched.draft.includes(createdWorkstreamId) && !launched.sendUnknown && launched.posts === 0 && confirmedLaunch.sessions.length === 1 && confirmedLaunch.sessions[0].status === 'active' && confirmedLaunch.sessions[0].id === launched.id, detail: JSON.stringify({ id: launched.id, draftBytes: launched.draft.length, posts: launched.posts, sessions: confirmedLaunch.sessions.map(item => [item.id, item.status]) }) });
  await navigate(cdp, await evaluate(cdp, 'location.href'), 20_000);
  await waitForBrowserExpression(cdp, `document.querySelector('#draft')?.value?.includes('You are pairing in Pi Workbench Workstream') === true`, 20_000);
  checks.push({ id: 'owned-workstreams-exact-launch-draft-survives-reload', passed: (await evaluate(cdp, `document.querySelector('#draft').value`)) === launched.draft, detail: `Stored exact draft length: ${launched.draft.length}` });
  await evaluate(cdp, `document.querySelector('#chat-back').click()`);
  await evaluate(cdp, `([...document.querySelectorAll('#catalog button')].find(x => x.textContent === 'Controlled project 2')).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-list')?.textContent?.includes('Controlled Workstream') === true`, 15_000);
  await evaluate(cdp, `([...document.querySelectorAll('#workstream-list button')].find(x => x.textContent.includes('Controlled Workstream')) ?? (() => { throw Error('Original Workstream missing') })()).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail h3')?.textContent?.includes('Controlled Workstream') === true`, 15_000);
  await evaluate(cdp, `([...document.querySelectorAll('#workstream-detail button')].find(x => x.textContent === 'Open associated Chat')).click()`);
  await waitForBrowserExpression(cdp, `new URL(location.href).searchParams.get('id') === '${fixture.anchors[1].sessionId}' && document.querySelector('#connection')?.textContent?.includes('connected') === true`, 15_000);
  await evaluate(cdp, `(() => { const original = window.fetch; window.__continuationPromptPosts = 0; window.fetch = (...args) => { if (args[1]?.method === 'POST' && String(args[0]).includes('/sessions/') && String(args[0]).endsWith('/prompt')) window.__continuationPromptPosts++; return original(...args); }; document.querySelector('#workstreams-toggle').click(); })()`);
  await waitForBrowserExpression(cdp, `[...document.querySelectorAll('#workstream-detail button')].some(x => x.textContent === 'Continue checkpoint controlled-checkpoint')`, 15_000);
  await evaluate(cdp, `(() => { window.__staleCheckpointConfirmations = 0; window.confirm = () => { window.__staleCheckpointConfirmations++; return true; }; [...document.querySelectorAll('#workstream-detail button')].find(x => x.textContent === 'Continue checkpoint controlled-checkpoint').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#draft')?.value?.includes('--- BEGIN OWNER-CONFIRMED NEXT-SESSION PROMPT ---') === true && document.querySelector('#connection')?.textContent?.includes('connected') === true`, 20_000);
  const continued = await evaluate(cdp, `({ id: new URL(location.href).searchParams.get('id'), draft: document.querySelector('#draft')?.value, promptPosts: window.__continuationPromptPosts, confirmations: window.__staleCheckpointConfirmations })`);
  const continuedSnapshot = await externalStore.inspect('ws-controlled-owned');
  checks.push({ id: 'owned-workstreams-checkpoint-continuation-exact-draft-and-association', passed: continued.id && continued.id !== second.sessionId && continued.draft.includes('Resume controlled work') && continued.draft.includes('controlled-checkpoint') && continued.promptPosts === 0 && continuedSnapshot.sessions.some(item => item.id === continued.id && item.status === 'active' && item.workspaceId === second.workspaceId), detail: JSON.stringify({ id: continued.id, promptPosts: continued.promptPosts, confirmations: continued.confirmations, matches: continuedSnapshot.sessions.filter(item => item.id === continued.id).map(item => [item.id, item.status, item.workspaceId]) }) });
  await evaluate(cdp, `document.querySelector('#workstreams-toggle').click()`);
  await evaluate(cdp, `([...document.querySelectorAll('#workstream-detail article')].find(item => item.textContent.includes(${JSON.stringify(second.sessionId)}))?.querySelector('button'))?.click()`);
  await waitForBrowserExpression(cdp, `new URL(location.href).searchParams.get('id') === '${fixture.anchors[1].sessionId}' && document.querySelector('#connection')?.textContent?.includes('connected') === true`, 15_000);
  const anchorlessId = 'ws-controlled-anchorless';
  await externalStore.create({ workstreamId: anchorlessId, idempotencyKey: 'fixture-anchorless-create', title: 'Anchor repair fixture', producer: 'fixture' });
  await externalStore.append({ workstreamId: anchorlessId, expectedRevision: 1, idempotencyKey: 'fixture-anchorless-session', records: [
    { type: 'session.pending', producer: 'fixture', payload: { associationKey: 'fixture-legacy', sessionId: first.sessionId } },
    { type: 'session.confirmed', producer: 'fixture', payload: { associationKey: 'fixture-legacy', sessionId: first.sessionId } },
  ] });
  await evaluate(cdp, `(() => { document.querySelector('#workstreams-toggle').click(); document.querySelector('#workstream-refresh').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-list')?.textContent?.includes('Anchor repair fixture') === true`, 15_000);
  await evaluate(cdp, `([...document.querySelectorAll('#workstream-list button')].find(x => x.textContent.includes('Anchor repair fixture'))).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail')?.textContent?.includes('Find registered local location') === true`, 15_000);
  await evaluate(cdp, `([...document.querySelectorAll('#workstream-detail button')].find(x => x.textContent === 'Find registered local location')).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail')?.textContent?.includes('Repair to') === true`, 15_000);
  await evaluate(cdp, `(() => { window.confirm = () => true; [...document.querySelectorAll('#workstream-detail button')].find(x => x.textContent.startsWith('Repair to')).click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail h3')?.textContent?.includes('revision 3') === true && document.querySelector('#workstream-detail')?.textContent?.includes('Open associated Chat') === true`, 15_000);
  const repairedAnchor = (await externalStore.inspect(anchorlessId)).sessions.find(session => session.id === first.sessionId);
  checks.push({ id: 'owned-workstreams-repairs-verified-registered-location', passed: repairedAnchor?.status === 'active' && repairedAnchor.machineId === 'local' && repairedAnchor.projectId === first.projectId && repairedAnchor.workspaceId === first.workspaceId, detail: JSON.stringify({ status: repairedAnchor?.status, project: repairedAnchor?.projectId, workspace: repairedAnchor?.workspaceId }) });
  await evaluate(cdp, `([...document.querySelectorAll('#workstream-detail button')].find(x => x.textContent === 'Open associated Chat')).click()`);
  await waitForBrowserExpression(cdp, `new URL(location.href).searchParams.get('id') === '${fixture.anchors[0].sessionId}' && document.querySelector('#connection')?.textContent?.includes('connected') === true`, 15_000);
  checks.push({ id: 'owned-workstreams-repaired-session-opens-registered-chat', passed: (await evaluate(cdp, `new URL(location.href).searchParams.get('workspace')`)) === first.workspaceId, detail: `Verified workspace: ${first.workspaceId}` });
  await evaluate(cdp, `document.querySelector('#chat-back').click()`);
  await evaluate(cdp, `([...document.querySelectorAll('#catalog button')].find(x => x.textContent === 'Controlled project 2')).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-list')?.textContent?.includes('Controlled Workstream') === true`, 15_000);
  await evaluate(cdp, `([...document.querySelectorAll('#workstream-list button')].find(x => x.textContent.includes('Controlled Workstream'))).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#workstream-detail')?.textContent?.includes(${JSON.stringify(second.sessionId)}) === true`, 15_000);
  await evaluate(cdp, `([...document.querySelectorAll('#workstream-detail article')].find(item => item.textContent.includes(${JSON.stringify(second.sessionId)}))?.querySelector('button'))?.click()`);
  await waitForBrowserExpression(cdp, `new URL(location.href).searchParams.get('id') === '${fixture.anchors[1].sessionId}' && document.querySelector('#connection')?.textContent?.includes('connected') === true`, 15_000);
  await evaluate(cdp, `(() => { const original = window.fetch; window.fetch = async (...args) => { const response = await original(...args); if (!String(args[0]).includes('/sessions/') || !String(args[0]).includes('/status?')) return response; const status = await response.clone().json(); status.extensionStatuses = { 'pi-workbench:activity': JSON.stringify({ schemaVersion: 1, items: [{ id: 'delegate:worker-one', kind: 'worker', name: 'Files review', role: 'independent-review', model: 'anthropic/claude-sonnet', effort: 'high', objective: '<img src=x onerror=window.__rosterInjected=1>', activity: 'reading files', reportedStatus: 'Checking paths' }, { id: 'delegate:child-two', kind: 'subagent', name: 'QA', role: 'investigation', model: 'openai/gpt-6-luna', effort: 'medium', objective: 'Verify browser', activity: 'success' }] }) }; return new Response(JSON.stringify(status), { status: response.status, headers: { 'Content-Type': 'application/json' } }); }; document.querySelector('#catalog li button[aria-current="page"]').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#delegation')?.textContent?.includes('Files review · Running') === true`, 15_000);
  const roster = await evaluate(cdp, `({ text: document.querySelector('#delegation').textContent, rows: document.querySelectorAll('#delegation article').length, unsafeElements: document.querySelectorAll('#delegation img').length, injected: window.__rosterInjected === 1 })`);
  checks.push({ id: "owned-roster-isolated-status-projection", passed: roster.rows === 2 && roster.text.includes('anthropic/claude-sonnet · high') && roster.text.includes('Subagent · QA · Uncollected') && roster.text.includes('openai/gpt-6-luna · medium') && roster.text.includes('Reported: Checking paths') && roster.unsafeElements === 0 && !roster.injected, detail: JSON.stringify(roster) });
  await evaluate(cdp, `document.querySelector('#files-toggle').click()`);
  const filesPanel = await evaluate(cdp, `({ visible: document.querySelector('#files').getBoundingClientRect().width > 0, expanded: document.querySelector('#files-toggle').getAttribute('aria-expanded') })`);
  checks.push({ id: 'owned-files-pi-web-style-toggle', passed: filesPanel.visible && filesPanel.expanded === 'true', detail: JSON.stringify(filesPanel) });
  await evaluate(cdp, `([...document.querySelectorAll('#file-tree button')].find(x => x.textContent.includes('README.md')) ?? (() => { throw Error('README missing') })()).click()`);
  try { await waitForBrowserExpression(cdp, `document.querySelector('#file-detail pre')?.textContent?.includes('fixture-file-2') === true`, 15_000); }
  catch (error) { throw new Error(`Files read did not settle: ${JSON.stringify(await evaluate(cdp, `({ error: document.querySelector('#file-error')?.textContent, detail: document.querySelector('#file-detail')?.textContent?.slice(0, 500), selected: document.querySelector('#catalog select')?.value, tree: document.querySelector('#file-tree')?.textContent?.slice(0, 500) })`))}`, { cause: error }); }
  const source = await evaluate(cdp, `({ editable: document.querySelector('#file-detail textarea')?.disabled === false, text: document.querySelector('#file-detail pre')?.textContent, path: document.querySelector('#file-detail h3')?.textContent })`);
  await capture('files-desktop');
  checks.push({ id: 'owned-files-real-workspace-read', passed: source.editable && source.text.includes('fixture-file-2') && source.path.includes('README.md'), detail: JSON.stringify(source) });
  await evaluate(cdp, `(() => { const editor = document.querySelector('#file-detail textarea'); editor.value = '# Browser edit\\n'; editor.dispatchEvent(new Event('input', { bubbles: true })); window.confirm = () => false; [...document.querySelectorAll('#catalog button')].find(x => x.textContent === 'Controlled project 1').click(); })()`);
  const dirty = await evaluate(cdp, `({ text: document.querySelector('#file-detail textarea')?.value, workspace: document.querySelector('#catalog select')?.value, saveDisabled: [...document.querySelectorAll('#file-detail button')].find(x => x.textContent === 'Save file')?.disabled })`);
  checks.push({ id: 'owned-files-dirty-workspace-switch-blocked', passed: dirty.text === '# Browser edit\n' && dirty.workspace === second.workspaceId && dirty.saveDisabled === false, detail: JSON.stringify(dirty) });
  await evaluate(cdp, `(() => { const picker = document.querySelector('#catalog select'); const other = document.createElement('option'); other.value = 'fixture-other-workspace'; other.textContent = 'Another workspace'; picker.append(other); picker.value = other.value; picker.dispatchEvent(new Event('change')); })()`);
  const blockedPicker = await evaluate(cdp, `({ selected: document.querySelector('#catalog select')?.value, text: document.querySelector('#file-detail textarea')?.value })`);
  checks.push({ id: 'owned-files-rejected-workspace-picker-restored', passed: blockedPicker.selected === second.workspaceId && blockedPicker.text === '# Browser edit\n', detail: JSON.stringify(blockedPicker) });
  const fileReady = await evaluate(cdp, `({ detail: document.querySelector('#file-detail')?.textContent?.slice(0, 300), error: document.querySelector('#file-error')?.textContent, buttons: [...document.querySelectorAll('#file-detail button')].map(x => x.textContent) })`);
  if (!fileReady.buttons.includes('Save file')) throw new Error(`Files editing unavailable: ${JSON.stringify({ source, dirty, fileReady })}`);
  await evaluate(cdp, `([...document.querySelectorAll('#file-detail button')].find(x => x.textContent === 'Save file')).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#file-detail h3')?.textContent?.includes('Unsaved changes') === false && document.querySelector('#file-detail pre')?.textContent === '# Browser edit\\n'`, 15_000);
  const savedFile = await readFile(join(second.cwd, 'README.md'), 'utf8');
  checks.push({ id: 'owned-files-versioned-write-real-backend', passed: savedFile === '# Browser edit\n', detail: JSON.stringify({ savedFile }) });
  await writeFile(join(second.cwd, 'README.md'), '# External change\n');
  await evaluate(cdp, `(() => { const editor = document.querySelector('#file-detail textarea'); editor.value = '# Preserve my edit\\n'; editor.dispatchEvent(new Event('input', { bubbles: true })); [...document.querySelectorAll('#file-detail button')].find(x => x.textContent === 'Save file').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#file-error')?.textContent?.includes('Conflict:') === true`, 15_000);
  const conflict = await evaluate(cdp, `({ draft: document.querySelector('#file-detail textarea')?.value, error: document.querySelector('#file-error')?.textContent })`);
  checks.push({ id: 'owned-files-stale-version-rejected', passed: conflict.draft === '# Preserve my edit\n' && (await readFile(join(second.cwd, 'README.md'), 'utf8')) === '# External change\n', detail: JSON.stringify(conflict) });
  // Safari can retain textarea focus across a disabled save/reload. Emulate that
  // focus behavior in Chromium so a stale DOM value cannot regain a fresh version.
  await evaluate(cdp, `(() => { const editor = document.querySelector('#file-detail textarea'); Object.defineProperty(document, 'activeElement', { configurable: true, get: () => editor }); window.confirm = () => true; [...document.querySelectorAll('#file-detail button')].find(x => x.textContent === 'Reload file').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#file-detail pre')?.textContent === '# External change\\n'`, 15_000);
  const reloaded = await evaluate(cdp, `(() => { const editor = document.querySelector('#file-detail textarea'); const result = { source: editor.value, preview: document.querySelector('#file-detail pre').textContent, dirty: document.querySelector('#file-detail h3').textContent.includes('Unsaved changes') }; delete document.activeElement; return result; })()`);
  checks.push({ id: 'owned-files-focused-editor-shows-confirmed-reload', passed: reloaded.source === '# External change\n' && reloaded.preview === '# External change\n' && !reloaded.dirty, detail: JSON.stringify(reloaded) });
  await writeFile(join(second.cwd, 'danger.md'), '<img src=x onerror=window.__fileInjected=1>\\n');
  await writeFile(join(second.cwd, 'large.md'), 'L'.repeat(512 * 1024 + 1));
  await evaluate(cdp, `(() => { window.confirm = () => true; document.querySelector('#file-refresh').click(); })()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#file-tree')?.textContent?.includes('danger.md') === true`, 15_000);
  await evaluate(cdp, `([...document.querySelectorAll('#file-tree button')].find(x => x.textContent.includes('danger.md'))).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#file-detail pre')?.textContent?.includes('<img src=x') === true`, 15_000);
  const inert = await evaluate(cdp, `({ escaped: document.querySelector('#file-detail pre').textContent, images: document.querySelectorAll('#file-detail img').length, injected: window.__fileInjected === 1 })`);
  checks.push({ id: 'owned-files-untrusted-text-inert', passed: inert.images === 0 && !inert.injected && inert.escaped.includes('<img src=x'), detail: JSON.stringify(inert) });
  await evaluate(cdp, `([...document.querySelectorAll('#file-tree button')].find(x => x.textContent.includes('large.md'))).click()`);
  await waitForBrowserExpression(cdp, `document.querySelector('#file-detail h3')?.textContent?.includes('Truncated view') === true`, 15_000);
  const large = await evaluate(cdp, `({ disabled: document.querySelector('#file-detail textarea')?.disabled, bytes: document.querySelector('#file-detail pre')?.textContent?.length, saveDisabled: [...document.querySelectorAll('#file-detail button')].find(x => x.textContent === 'Save file')?.disabled })`);
  const traversal = await fetch(new URL(`api/machines/local/projects/${encodeURIComponent(second.projectId)}/workspaces/${encodeURIComponent(second.workspaceId)}/file?path=${encodeURIComponent('../README.md')}`, base));
  checks.push({ id: 'owned-files-bounded-and-confined', passed: large.disabled && large.saveDisabled && large.bytes <= 512 * 1024 && traversal.status === 400, detail: JSON.stringify({ ...large, traversal: traversal.status }) });
  if (runtime.screenshotsDir !== undefined) {
    await evaluate(cdp, `([...document.querySelectorAll('#file-tree button')].find(x => x.textContent.includes('README.md'))).click()`);
    await waitForBrowserExpression(cdp, `document.querySelector('#file-detail h3')?.textContent?.includes('README.md') === true && document.querySelector('#file-detail pre')?.textContent?.length > 0`, 15_000);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 820, deviceScaleFactor: 1, mobile: false });
    const narrowFiles = await evaluate(cdp, `({ header: document.querySelector('.conversation-header').getBoundingClientRect().height, filesHeight: document.querySelector('.workspace-panel').getBoundingClientRect().height, composerHidden: getComputedStyle(document.querySelector('.composer-shell')).display === 'none' })`);
    checks.push({ id: 'owned-files-narrow-full-pane', passed: narrowFiles.header > 0 && narrowFiles.filesHeight > 650 && narrowFiles.composerHidden, detail: JSON.stringify(narrowFiles) });
    await capture('chat-files-narrow');
    await evaluate(cdp, `document.querySelector('#files-toggle').click()`);
    const narrowChat = await evaluate(cdp, `(() => { const composer = document.querySelector('.composer-shell'); return { chatHeight: document.querySelector('.conversation-panel').getBoundingClientRect().height, composerVisible: getComputedStyle(composer).display !== 'none', composerHeight: composer.getBoundingClientRect().height, composerScroll: composer.scrollHeight - composer.clientHeight, sendBottom: document.querySelector('#send').getBoundingClientRect().bottom, viewportHeight: innerHeight, filesHidden: getComputedStyle(document.querySelector('.workspace-panel')).display === 'none' }; })()`);
    checks.push({ id: 'owned-chat-narrow-restored-after-files', passed: narrowChat.chatHeight > 750 && narrowChat.composerVisible && narrowChat.filesHidden && narrowChat.sendBottom <= narrowChat.viewportHeight, detail: JSON.stringify(narrowChat) });
    await capture('chat-narrow');
    await evaluate(cdp, `document.querySelector('#workstreams-toggle').click()`);
    await waitForBrowserExpression(cdp, `document.querySelector('.navigation-panel')?.getBoundingClientRect().height > 650 && getComputedStyle(document.querySelector('.conversation-panel')).order === '-1'`, 10_000);
    const narrowWorkstreams = await evaluate(cdp, `({ height: document.querySelector('.navigation-panel').getBoundingClientRect().height, header: document.querySelector('.conversation-header').getBoundingClientRect().height, composerHidden: getComputedStyle(document.querySelector('.composer-shell')).display === 'none' })`);
    checks.push({ id: 'owned-workstreams-narrow-full-pane', passed: narrowWorkstreams.height > 650 && narrowWorkstreams.header > 0 && narrowWorkstreams.composerHidden, detail: JSON.stringify(narrowWorkstreams) });
    await capture('workstreams-narrow');
    await evaluate(cdp, `document.querySelector('#files-toggle').click()`);
    await waitForBrowserExpression(cdp, `document.querySelector('#files')?.getBoundingClientRect().height > 650 && !document.querySelector('.shell')?.classList.contains('show-workstreams')`, 10_000);
    checks.push({ id: 'owned-narrow-panel-switch-exclusive', passed: await evaluate(cdp, `document.querySelector('#workstreams-toggle').getAttribute('aria-expanded') === 'false' && document.querySelector('#files-toggle').getAttribute('aria-expanded') === 'true'`), detail: 'Files replaces Workstreams without splitting the narrow pane.' });
    await evaluate(cdp, `document.querySelector('#files-toggle').click()`);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reducedMotion = await evaluate(cdp, `parseFloat(getComputedStyle(document.querySelector('#send')).animationDuration)`);
    checks.push({ id: 'owned-shell-reduced-motion', passed: reducedMotion < 0.001, detail: `Computed Send animation duration: ${reducedMotion}s` });
  }
  return { status: checks.every(check => check.passed) ? "passed" : "failed", checks, limitations };
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
  await waitForBrowserExpression(cdp, `document.querySelector("pi-workbench-app")?.shadowRoot?.querySelector("workstream-chooser")?.loading === false`, 15_000);
  const root = await evaluate(cdp, `(() => {
    const app = document.querySelector("pi-workbench-app");
    const shadow = app?.shadowRoot;
    const workstreams = shadow?.querySelector("workstream-chooser");
    return {
      title: document.title,
      workbench: app !== null,
      chooser: shadow?.querySelector('[data-view="chooser"]') !== null,
      legacy: document.querySelector("pi-web-app") !== null,
      files: shadow?.querySelector("workspace-files-panel") !== null,
      terminal: shadow?.querySelector("terminal-panel") !== null,
      workstreamError: workstreams?.shadowRoot?.querySelector(".error")?.textContent?.trim() ?? "",
    };
  })()`);
  checks.push({ id: "workbench-chat-root", passed: root.title === "Pi Workbench" && root.workbench && root.chooser && !root.legacy && !root.files && !root.terminal && root.workstreamError === "", detail: JSON.stringify(root) });

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
  child.on("error", (error) => { child.spawnError = error; });
  child.recentOutput = () => `${child.spawnError?.message ?? ""}\n${Buffer.concat(chunks).toString("utf8")}`;
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
function assertChildAlive(child) { if (child.spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error(`Owned process exited early\n${child.recentOutput?.() ?? ""}`); }

async function allocateDistinctPorts() { const first = await freePort(); let second = await freePort(); while (second === first) second = await freePort(); return [first, second]; }
function freePort() { return new Promise((resolvePort, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => typeof address === "object" && address !== null ? resolvePort(address.port) : reject(new Error("Could not allocate port"))); }); }); }
function chromeArgs(port, profile, initialUrl) { return ["--headless=new", `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "--window-size=1440,900", "--force-device-scale-factor=1", "--disable-background-networking", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--disable-features=Translate,MediaRouter,OptimizationHints", "--use-mock-keychain", "--password-store=basic", "--no-proxy-server", "--disable-component-update", "--disable-domain-reliability", "--disable-sync", "--metrics-recording-only", "--no-default-browser-check", "--no-first-run", "--no-sandbox", initialUrl]; }
async function openExistingPage(port, requestedUrl, expectedTitle = "Pi Workbench") {
  const started = Date.now();
  let pages = [];
  while (Date.now() - started < 15_000) {
    pages = await requestJson(new URL(`http://127.0.0.1:${port}/json/list`));
    const info = pages.find((candidate) => candidate.type === "page" && sameApplicationPage(candidate.url, requestedUrl));
    if (info?.webSocketDebuggerUrl !== undefined && info.title === expectedTitle) {
      if (process.env.PI_WEB_ACCEPTANCE_TRACE === "1") process.stderr.write(`[cdp-open] ${JSON.stringify({ requested: requestedUrl, actual: info.url })}\n`);
      return CDP.connect(info.webSocketDebuggerUrl);
    }
    await delay(100);
  }
  throw new Error(`Chromium did not open the owned application page: ${JSON.stringify(pages.map((page) => page.url))}`);
}
function sameApplicationPage(actual, requested) {
  if (actual === requested) return true;
  try {
    const a = new URL(actual), r = new URL(requested);
    return a.origin === r.origin && a.pathname === r.pathname && r.searchParams.has("id")
      && ["id", "cwd", "machine"].every(key => a.searchParams.get(key) === r.searchParams.get(key));
  } catch { return false; }
}
async function navigate(cdp, url, timeout) { const loaded = cdp.waitForEvent("Page.loadEventFired", timeout).catch(() => undefined); await withTimeout(cdp.send("Runtime.evaluate", { expression: `location.assign(${JSON.stringify(url)}); true`, returnByValue: true }), Math.min(timeout, 10_000), "CDP navigation evaluation did not respond"); await loaded; }
async function evaluate(cdp, expression) { const response = await withTimeout(cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), 10_000, "CDP Runtime.evaluate did not respond"); if (response.exceptionDetails) throw new Error(`Browser evaluation failed for ${expression.slice(0, 240)}: ${JSON.stringify(response.exceptionDetails)}`); return response.result?.value; }
class CDP {
  static connect(url) { return new Promise((resolveCdp, reject) => { const ws = new WebSocket(url); const cdp = new CDP(ws); ws.addEventListener("open", () => resolveCdp(cdp), { once: true }); ws.addEventListener("error", () => reject(new Error("CDP websocket error")), { once: true }); }); }
  constructor(ws) { this.ws = ws; this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); ws.addEventListener("message", (event) => this.onMessage(event)); ws.addEventListener("close", () => { for (const pending of this.pending.values()) pending.reject(new Error("CDP websocket closed")); this.pending.clear(); }); }
  send(method, params = {}) { const id = this.nextId++; return new Promise((resolveSend, reject) => { this.pending.set(id, { resolve: resolveSend, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  waitForEvent(method, timeoutMs) { return new Promise((resolveEvent, reject) => { const listener = (params) => { clearTimeout(timer); this.listeners.set(method, (this.listeners.get(method) ?? []).filter((item) => item !== listener)); resolveEvent(params); }; const timer = setTimeout(() => { this.listeners.set(method, (this.listeners.get(method) ?? []).filter((item) => item !== listener)); reject(new Error(`Timed out waiting for ${method}`)); }, timeoutMs); this.listeners.set(method, [...this.listeners.get(method) ?? [], listener]); }); }
  close() { this.ws.close(); }
  onMessage(event) { const message = JSON.parse(String(event.data)); if (process.env.PI_WEB_ACCEPTANCE_TRACE === "1") process.stderr.write(`[cdp] ${JSON.stringify({ id: message.id, method: message.method, error: message.error, ...(message.method === "Runtime.exceptionThrown" || message.method === "Log.entryAdded" ? { params: message.params } : {}) })}\n`); if (message.id !== undefined) { const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result ?? {}); return; } for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {}); }
}

function parseArgs(argv) { const parsed = {}; for (let index = 0; index < argv.length; index += 1) { const arg = argv[index]; if (arg === "--keep-temp") parsed.keepTemp = true; else if (["--root", "--pi-web-root", "--chrome-bin", "--owned-client-dist", "--screenshots-dir"].includes(arg)) { const value = argv[++index]; if (!value) throw new Error(`${arg} requires a value`); parsed[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value; } else if (arg === "--help") { process.stdout.write("Usage: node packages/pi-web-integration/scripts/run-workbench-chat-acceptance.mjs [--pi-web-root PATH] [--owned-client-dist PATH] [--chrome-bin PATH] [--root TEMP] [--screenshots-dir PATH] [--keep-temp]\n"); process.exit(0); } else throw new Error(`Unknown argument: ${arg}`); } return parsed; }
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
