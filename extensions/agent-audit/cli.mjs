#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { chmodSync, constants, copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUDIT_FORMAT, AUDIT_SCHEMA_VERSION, assertSafeAuditRoot, listCaptures, listPreviewSets,
  readCaptureSet, readPreviewSet, removeCapture, removePreviewSet,
} from "./audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const root = join(repo, ".review", "agent-audit");
const [command = "list", argument, ...extra] = process.argv.slice(2);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const EXPORT_ID = /^(?:preview-)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
if (extra.length) fail("too many arguments");

try {
  if (command === "list") output({
    schemaVersion: AUDIT_SCHEMA_VERSION,
    format: `${AUDIT_FORMAT}.list`,
    captures: listCaptures(root),
    previewSets: listPreviewSets(root).map((item) => item.status === "readable" ? { id: item.id, status: item.status, timestamp: item.timestamp, previewCount: item.previews.length } : item),
  });
  else if (command === "inspect") output(readCaptureSet(root, required(argument)));
  else if (command === "export") output(exportBundle(required(argument)));
  else if (command === "previews") output(readPreviewSet(root, argument ?? latestPreviewId()));
  else if (command === "atelier") prepareAtelier("capture", required(argument));
  else if (command === "atelier-preview") prepareAtelier("preview", required(argument));
  else if (command === "cleanup") { removeCapture(root, required(argument)); output({ ok: true, removed: argument }); }
  else if (command === "cleanup-preview") { removePreviewSet(root, required(argument)); output({ ok: true, removedPreview: argument }); }
  else if (command === "cleanup-export") { removeExport(required(argument)); output({ ok: true, removedExport: argument }); }
  else fail("usage: cli.mjs list | inspect ID | export ID | previews [PREVIEW_ID] | atelier CAPTURE_ID | atelier-preview PREVIEW_ID | cleanup ID|all | cleanup-preview PREVIEW_ID | cleanup-export ID|preview-ID");
} catch (error) { fail(error instanceof Error ? error.message : String(error)); }

function exportBundle(id) {
  const primary = readCaptureSet(root, id, { materializeOutputs: true });
  const requests = listCaptures(root)
    .filter((item) => item.status === "readable" && item.sessionId === primary.capture.session.sessionId)
    .map((item) => readCaptureSet(root, item.id, { materializeOutputs: true }));
  const previewIds = [...new Set(requests.map((item) => item.capture.previewSetId).filter(Boolean))];
  return { ...primary, requests, previewSets: previewIds.map((previewId) => readPreviewSet(root, previewId)) };
}

function previewBundle(id) {
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    format: `${AUDIT_FORMAT}.atelier`,
    evidenceKind: "saved-preview-set",
    notice: "No actual provider requests are included in this preview-only export.",
    requests: [],
    previewSets: [readPreviewSet(root, id)],
  };
}

function latestPreviewId() {
  const values = listPreviewSets(root).filter((item) => item.status === "readable").sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (!values.length) throw new Error("no saved preview sets");
  return values.at(-1).id;
}

function prepareAtelier(kind, id) {
  if (!UUID.test(id)) throw new Error(`${kind} id must be a UUID`);
  const base = assertSafeAuditRoot(root), exportsRoot = safeDirectory(join(base, "exports"));
  const accessRoot = safeDirectory(join(exportsRoot, ".access"), true);
  const identity = kind === "preview" ? `preview-${id}` : id;
  const target = join(exportsRoot, identity);
  const paths = { root: target, ui: join(target, "index.html"), audit: join(target, "audit.json"), css: join(target, "surface.css"), token: join(accessRoot, `${identity}.token`) };
  let reused = false, repaired = [];
  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe Atelier export: ${target}`);
    reused = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    assertSafeAuditRoot(base); mkdirSync(target, { mode: 0o700 });
  }

  let frozen;
  try { frozen = JSON.parse(readFileSync(safeFile(paths.audit), "utf8")); }
  catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`invalid frozen export; run cleanup-export ${identity} to discard it: ${error.message}`);
    frozen = kind === "preview" ? previewBundle(id) : exportBundle(id);
    assertSafeAuditRoot(base); writeFileSync(paths.audit, `${JSON.stringify(frozen, null, 2)}\n`, { mode: 0o600, flag: "wx" }); repaired.push("audit.json");
  }
  const matches = kind === "preview" ? frozen.previewSets?.[0]?.id === id && frozen.requests?.length === 0 : frozen.capture?.id === id;
  if (!matches) throw new Error(`frozen Atelier export identity mismatch; run cleanup-export ${identity} to discard it`);
  for (const [source, destination] of [["surface.html", paths.ui], ["surface.css", paths.css]]) {
    try { safeFile(destination); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      assertSafeAuditRoot(base); copyFileSync(join(repo, "tools", "agent-audit", source), destination, constants.COPYFILE_EXCL); assertSafeAuditRoot(base); chmodSync(destination, 0o600); repaired.push(source);
    }
  }
  const token = accessToken(paths.token, base);
  atelierResult(paths, reused, repaired, token);
}

function atelierResult(paths, reused, repaired, token) {
  const baseUrl = "http://127.0.0.1:4747", humanUrl = `${baseUrl}/?token=${encodeURIComponent(token)}`;
  output({ ok: true, reused, repaired, root: paths.root, ui: paths.ui, audit: paths.audit,
    command: `env PORT=4747 ROOT=${JSON.stringify(paths.root)} UI=${JSON.stringify(paths.ui)} ACCESS_TOKEN_FILE=${JSON.stringify(paths.token)} node tools/agent-audit/server.mjs`,
    baseUrl, humanUrl,
    pollerCommand: `env ACCESS_TOKEN_FILE=${JSON.stringify(paths.token)} BASE_URL=${baseUrl} bash ${JSON.stringify(join(repo, "tools", "agent-audit", "poll.sh"))} --stream`,
    preflightCommand: `env ACCESS_TOKEN_FILE=${JSON.stringify(paths.token)} node tools/agent-audit/preflight.mjs ${JSON.stringify(atelierPreflight())} --url ${JSON.stringify(humanUrl)} --poller-identity ${JSON.stringify(join(repo, "tools", "agent-audit", "poll.sh"))} --evidence-dir .review/preflight/agent-audit`,
  });
}

function atelierPreflight() {
  for (const candidate of [process.env.ATELIER_PREFLIGHT, join(homedir(), ".agents", "skills", "atelier", "scripts", "preflight.mjs")].filter(Boolean)) {
    try { return realpathSync(candidate); } catch {}
  }
  return "<atelier-preflight.mjs>";
}

function accessToken(path, base) {
  try {
    const token = readFileSync(safeFile(path), "utf8").trim();
    if (!TOKEN.test(token)) throw new Error("invalid access token");
    return token;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const token = randomBytes(32).toString("base64url");
    assertSafeAuditRoot(base); writeFileSync(path, `${token}\n`, { mode: 0o600, flag: "wx" }); return token;
  }
}

function removeExport(identity) {
  if (!EXPORT_ID.test(identity)) throw new Error("export identity must be a UUID or preview-UUID");
  const base = assertSafeAuditRoot(root), exportsRoot = safeDirectory(join(base, "exports"));
  const target = join(exportsRoot, identity); let token = null;
  try { const stat = lstatSync(target); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe Atelier export: ${target}`); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  try { token = join(safeDirectory(join(exportsRoot, ".access")), `${identity}.token`); safeFile(token); }
  catch (error) { if (error?.code !== "ENOENT") throw error; token = null; }
  assertSafeAuditRoot(base); rmSync(target, { recursive: true, force: true }); if (token) rmSync(token, { force: true });
}

function safeDirectory(path, create = false) {
  try { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe directory: ${path}`); }
  catch (error) {
    if (error?.code !== "ENOENT" || !create) throw error;
    assertSafeAuditRoot(dirname(path)); mkdirSync(path, { mode: 0o700 });
    const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe directory: ${path}`);
  }
  return path;
}
function safeFile(path) { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`unsafe file: ${path}`); return path; }
function required(value) { if (!value) throw new Error("missing identity"); return value; }
function output(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function fail(message) { process.stderr.write(`${message}\n`); process.exit(1); }
