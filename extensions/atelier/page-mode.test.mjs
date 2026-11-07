import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import workingMode from "../working-mode/index.ts";
import { registerTelemetry } from "../telemetry/index.ts";
import atelier from "./index.ts";

// Page mode at its one seam: a real Pi session with a scripted model, Working Mode, Atelier and an injected telemetry
// recorder, the Session Page served over HTTP by the Atelier host. HOME is a temp folder, so the Session Page and
// its scratch folder stay out of the real home; a fake `open` records the browser launch.
const base = mkdtempSync(join(process.env.PI_TMP ?? tmpdir(), "page-mode-"));
process.env.HOME = join(base, "home");
delete process.env.PI_TMP_ROOT;
delete process.env.PI_WORKBENCH_WORKSTREAM_DIR;
process.env.ATELIER_PAGE_CHECK = "off";
const bin = join(base, "bin"), launches = join(base, "opened");
mkdirSync(bin);
writeFileSync(launches, "");
writeFileSync(join(bin, "open"), `#!/bin/sh\necho "$@" >> ${launches}\n`);
chmodSync(join(bin, "open"), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;
const opened = () => readFileSync(launches, "utf8").split("\n").filter(Boolean);

async function until(probe, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function session() {
  const cwd = realpathSync(mkdtempSync(join(base, "project-")));
  const agentDir = join(cwd, "agent");
  const faux = fauxProvider();
  const requests = [], queue = [], recorded = [];
  faux.setResponses(Array.from({ length: 40 }, () => (context) => {
    requests.push(context);
    return queue.shift() ?? fauxAssistantMessage("");
  }));
  const recorder = { record: (type, data = {}) => recorded.push({ type, at: new Date().toISOString(), ...data }), close() {} };
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, systemPrompt: "BASE",
    noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [(pi) => pi.registerProvider(faux.provider), (pi) => registerTelemetry(pi, recorder), atelier, workingMode],
  });
  await resourceLoader.reload();
  const modelRuntime = await ModelRuntime.create({ authPath: `${agentDir}/auth.json`, modelsPath: null, refreshOnCreate: false });
  const sessionManager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, resourceLoader, settingsManager, sessionManager, model: faux.getModel(), noTools: "builtin",
    sessionStartEvent: { type: "session_start", reason: "startup" },
  });
  await session.bindExtensions({});
  const messages = () => sessionManager.getEntries().filter((e) => e.type === "message").map((e) => e.message);
  const results = (tool) => messages().filter((m) => m.role === "toolResult" && m.toolName === tool);
  const text = (m) => typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "").join("");
  // The Session Page as the session was told it; on macOS the browser was given the same URL.
  const sessionPage = async () => {
    const note = await until(() => sessionManager.getEntries().find((e) => e.type === "custom_message" && e.customType === "atelier:session-page"));
    const { page, url } = note.details;
    if (process.platform === "darwin") await until(() => opened().includes(url));
    return { url, page };
  };
  const reply = (...replies) => queue.push(...replies);
  const tool = (args) => fauxAssistantMessage(fauxToolCall("atelier", args));
  // Quit as Pi does: session_shutdown first (the Atelier host stops serving), then dispose.
  const close = async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); };
  return { close, session, sessionManager, requests, recorded, messages, results, text, sessionPage, reply, tool };
}
const served = async (url) => (await fetch(url)).text();

test("/mode surface page creates the Session Page, stores revision 1 and opens it in the browser", async () => {
  const s = await session();
  await s.session.prompt("/mode surface page");
  const { url, page } = await s.sessionPage();
  const html = await served(url);
  assert.match(html, /atl-key="header"/);
  assert.match(html, /atl-key="composer"/);
  assert.match(html, /id="atl-log"/);
  s.reply(s.tool({ action: "revisions", page }), fauxAssistantMessage(""));
  await s.session.prompt("list the revisions");
  const [listed] = s.results("atelier");
  assert.equal(listed.isError, false, s.text(listed));
  assert.match(s.text(listed), /^Revision 1\b/m);
  assert.doesNotMatch(s.text(listed), /^Revision 2\b/m);
  // The header's Log link shows the transcript, read-only.
  const log = /id="atl-log"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*id="atl-log"/.exec(html);
  assert.ok(log, "the header links the Log");
  assert.match(await served(new URL(log[1] ?? log[2], url)), /list the revisions/);
  await s.close();
});
