import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Known values: env names that suggest a credential. AUTH(?!OR) keeps GIT_AUTHOR_NAME/EMAIL out.
const SECRET_ENV_NAME = /TOKEN|SECRET|KEY|PASSWORD|PASSWD|AUTH(?!OR)|CREDENTIAL|COOKIE/i;
const MIN_ENV = 12;
const MIN_AUTH = 12;

// High-precision prefixes for secrets Pi never held. No generic length/entropy rule: git SHAs must survive.
const PATTERNS = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ["github-token", /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ["github-token", /\bgh[opsur]_[A-Za-z0-9]{20,}/g],
  ["anthropic-key", /(?<![\w-])sk-ant-[A-Za-z0-9_-]{20,}/g],
  ["api-key", /(?<![\w-])sk-[A-Za-z0-9_-]{20,}/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ["copilot-token", /\btid=[^\s;"'`]+;exp=[^\s"'`]+/g],
];

function nonSecret(value) {
  return /\s/.test(value) // names, sentences
    || /^[~./]/.test(value) // paths
    || /^(true|false|yes|no|on|off|null|undefined|\d+)$/i.test(value)
    || /^[a-z][a-z0-9+.-]*:\/\/[^@\s]*$/i.test(value) // URLs without userinfo
    || /^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(value); // e-mail addresses
}

export function authPath() {
  const dir = process.env.PI_CODING_AGENT_DIR?.replace(/^~(?=$|\/)/, homedir()) ?? join(homedir(), ".pi", "agent");
  return join(dir, "auth.json");
}

// String leaves of each credential entry. Arrays (e.g. availableModelIds) are metadata, not credentials.
function authValues(node, out = []) {
  if (typeof node === "string") { if (node.length >= MIN_AUTH && !/\s/.test(node)) out.push(node); }
  else if (node && typeof node === "object" && !Array.isArray(node)) for (const value of Object.values(node)) authValues(value, out);
  return out;
}

let auth = { key: "", values: [] };
function readAuth() {
  const path = authPath();
  let key;
  try { const stat = statSync(path); key = `${path}:${stat.mtimeMs}:${stat.size}`; } catch { return []; }
  if (key !== auth.key) { // OAuth access tokens rotate: re-read on change
    let values = [];
    try { values = authValues(JSON.parse(readFileSync(path, "utf8"))); } catch { /* unreadable or mid-write: retry next call */ key = ""; }
    auth = { key, values };
  }
  return auth.values;
}

let known = { key: undefined, regex: undefined, sources: new Map() };
function knownRegex() {
  const sources = new Map();
  for (const value of readAuth()) sources.set(value, "auth.json");
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= MIN_ENV && SECRET_ENV_NAME.test(name) && !nonSecret(value) && !sources.has(value)) sources.set(value, `env:${name}`);
  }
  const values = [...sources.keys()].sort((a, b) => b.length - a.length);
  const key = values.join("\0") + "\0" + [...sources.values()].join("\0");
  if (key !== known.key) {
    const escaped = values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    known = { key, regex: escaped.length ? new RegExp(escaped.join("|"), "g") : undefined, sources };
  }
  return known;
}

/** Replace known credential values and well-known secret shapes with `[REDACTED:<source>]`. */
export function redact(text) {
  if (typeof text !== "string" || text === "") return text;
  const { regex, sources } = knownRegex();
  let out = regex ? text.replace(regex, (match) => `[REDACTED:${sources.get(match)}]`) : text;
  for (const [name, pattern] of PATTERNS) out = out.replace(pattern, `[REDACTED:${name}]`);
  return out;
}

const SKIP_BLOCKS = new Set(["image", "thinking", "redacted_thinking"]); // binary data and provider-signed reasoning

/** Redact every string in a JSON-like value. Returns the same reference when nothing changed. */
export function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (!value || typeof value !== "object" || SKIP_BLOCKS.has(value.type)) return value;
  let changed = false;
  const copy = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    const next = redactDeep(item);
    if (next !== item) changed = true;
    copy[key] = next;
  }
  return changed ? copy : value;
}
