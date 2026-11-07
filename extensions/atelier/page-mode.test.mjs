import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import workingMode from "../working-mode/index.ts";
import { registerTelemetry } from "../telemetry/index.ts";
import { buildReport } from "../telemetry/telemetry.mjs";
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
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); };
  live.push(close);
  return { close, session, sessionManager, requests, recorded, messages, results, text, sessionPage, reply, tool };
}
// A failed test leaves its session open; closing it after each test lets the run end.
const live = [];
test.afterEach(async () => { for (const close of live.splice(0)) await close(); });
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

test("editing the Working copy without an update leaves the served Session Page unchanged", async () => {
  const s = await session();
  await s.session.prompt("/mode surface page");
  const { url, page } = await s.sessionPage();
  const before = await served(url);
  writeFileSync(page, readFileSync(page, "utf8").replace('<main atl-key="main"></main>', '<main atl-key="main"><p atl-key="draft">Half done</p></main>'));
  assert.equal(await served(url), before);
  assert.doesNotMatch(await served(url), /Half done/);
  await s.close();
});

test("update stores the next revision and the served Page shows it; restore brings an earlier one back to the Working copy", async () => {
  const s = await session();
  await s.session.prompt("/mode surface page");
  const { url, page } = await s.sessionPage();
  const first = await served(url);
  writeFileSync(page, first.replace('<main atl-key="main"></main>', '<main atl-key="main"><p atl-key="status">Tests pass</p></main>'));
  s.reply(s.tool({ action: "update", page, text: "Added the test status" }), s.tool({ action: "revisions", page }), fauxAssistantMessage(""));
  await s.session.prompt("show it");
  assert.match(await served(url), /Tests pass/);
  const [update, listed] = s.results("atelier");
  assert.equal(update.isError, false, s.text(update));
  assert.match(s.text(update), /Stored as revision 2\b/);
  assert.match(s.text(listed), /^Revision 2 .*Added the test status$/m);
  const events = await (await fetch(new URL(`/.atelier/events?page=${encodeURIComponent(decodeURIComponent(new URL(url).pathname.slice(1)))}`, url))).json();
  assert.deepEqual(events.entries.filter((e) => e.type === "update").map((e) => [e.revision, e.note]), [[1, undefined], [2, "Added the test status"]]);

  s.reply(s.tool({ action: "restore", page, revision: 1 }), fauxAssistantMessage(""));
  await s.session.prompt("bring back revision 1");
  const restore = s.results("atelier").at(-1);
  assert.equal(restore.isError, false, s.text(restore));
  assert.equal(readFileSync(page, "utf8"), first, "the Working copy is revision 1 again");
  assert.match(await served(url), /Tests pass/, "nothing is shown before the next update");
});

test("attend marks an existing Key and names the Attention channel; an unknown Key or an older Kernel is refused", async () => {
  const s = await session();
  await s.session.prompt("/mode surface page");
  await s.session.prompt("/mode attention switching");
  const { url, page } = await s.sessionPage();
  const cwd = s.sessionManager.getCwd();
  const old = join(cwd, "old.html"), body = "export {};\n";
  writeFileSync(old, '<!doctype html><p atl-key="header">Old</p><script type="module" src="atelier.js"></script>');
  writeFileSync(join(cwd, "atelier.js"), `// atelier-copy 2.13.0 sha256:${createHash("sha256").update(body).digest("hex")} old\n${body}`);
  writeFileSync(page, readFileSync(page, "utf8").replace('<main atl-key="main"></main>', '<main atl-key="main"><p atl-key="due">Friday</p></main>'));
  s.reply(
    s.tool({ action: "update", page }),
    s.tool({ action: "attend", page, key: "due", text: "Confirm Friday" }),
    s.tool({ action: "attend", page, key: "header", text: "Pick the release date" }),
    s.tool({ action: "attend", page, key: "nowhere", text: "Look here" }),
    s.tool({ action: "open", page: "old.html" }),
    s.tool({ action: "attend", page: "old.html", key: "header", text: "Look here" }),
    fauxAssistantMessage(""),
  );
  await s.session.prompt("ask Thomas");
  const [, nested, attended, unknown, , refused] = s.results("atelier");
  assert.equal(nested.isError, true);
  assert.match(s.text(nested), /main\/due/, "a nested Key is named by its address");
  assert.equal(attended.isError, false, s.text(attended));
  assert.match(s.text(attended), /request_attention/);
  const events = await (await fetch(new URL(`/.atelier/events?page=${encodeURIComponent(decodeURIComponent(new URL(url).pathname.slice(1)))}`, url))).json();
  assert.deepEqual(events.entries.filter((e) => e.type === "attend").map((e) => [e.origin, e.key, e.reason]), [["agent", "header", "Pick the release date"]]);
  assert.equal(unknown.isError, true);
  assert.match(s.text(unknown), /nowhere/);
  assert.equal(refused.isError, true);
  assert.match(s.text(refused), /Kernel 3\.0/);
});

test("a run ending with text and no update gets one correction and records a slip; a silent ending records none", async () => {
  const s = await session();
  await s.session.prompt("/mode surface page");
  const { page } = await s.sessionPage();
  const corrections = () => s.sessionManager.getEntries().filter((e) => e.type === "custom_message" && e.customType === "page-mode:slip");
  const slips = () => s.recorded.filter((e) => e.type === "slip").map((e) => [e.sessionId, e.corrected]);
  const id = s.sessionManager.getSessionId();

  s.reply(fauxAssistantMessage("Here is what I found"), s.tool({ action: "update", page, text: "Findings" }), fauxAssistantMessage(""));
  await s.session.prompt("investigate");
  assert.equal(corrections().length, 1);
  assert.deepEqual(slips(), [[id, true]]);
  const corrected = s.requests.at(-2).messages.at(-1);
  assert.match(s.text(corrected), /Update/, "the model sees the correction");

  s.reply(fauxAssistantMessage("More prose"), fauxAssistantMessage("Still prose"));
  await s.session.prompt("go on");
  assert.equal(corrections().length, 2, "one correction per run, no loop");
  assert.deepEqual(slips(), [[id, true], [id, false]]);

  s.reply(s.tool({ action: "revisions", page }), fauxAssistantMessage(""));
  await s.session.prompt("quietly");
  assert.equal(corrections().length, 2);
  assert.equal(slips().length, 2, "a silent ending is no slip");

  const report = buildReport(s.recorded);
  assert.equal(report.slips.total, 2);
  assert.equal(report.slips.corrected, 1);
  assert.deepEqual(report.slips.bySession, { [id]: 2 });
  assert.deepEqual(Object.values(report.slips.byDay), [2]);
});
