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
  // Strong generation: an atomic rename changes ino, and any write or utimes changes ctime, so a
  // same-size rotation with a restored mtime is still seen. mtime and size alone are not enough.
  try { const s = statSync(path, { bigint: true }); key = `${path}:${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; }
  catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") { auth = { key: "", values: [] }; return []; } // removed
    return auth.values; // other stat failure: keep redacting the last known values
  }
  if (key !== auth.key) { // OAuth access tokens rotate: re-read on change
    try { auth = { key, values: authValues(JSON.parse(readFileSync(path, "utf8"))) }; }
    catch { auth = { key: "", values: auth.values }; } // unreadable or mid-write: keep last known values, retry next call
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

function redactWith({ regex, sources }, text) {
  let out = regex ? text.replace(regex, (match) => `[REDACTED:${sources.get(match)}]`) : text;
  for (const [name, pattern] of PATTERNS) out = out.replace(pattern, `[REDACTED:${name}]`);
  return out;
}

/** The known credential values (auth.json and secret-named env), for callers that must also catch their fragments. */
export function knownValues() {
  return [...knownRegex().sources.keys()];
}

/** Replace known credential values and well-known secret shapes with `[REDACTED:<source>]`. */
export function redact(text) {
  if (typeof text !== "string" || text === "") return text;
  return redactWith(knownRegex(), text);
}

const UNTERMINATED_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----(?![\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/;
// A PEM opening header still being written: it contains spaces, so the trailing-token rule alone would release it.
const PARTIAL_HEADER = /-----BEGIN[A-Z ]*-{0,4}$/;

/**
 * The part of a growing text that can be redacted now. Secrets never contain whitespace, so a trailing non-whitespace
 * run may still be the start of one; an unterminated private-key block, or an opening header that may become one, may
 * still grow.
 * @param {string} text
 * @returns {string}
 */
export function completePrefix(text) {
  const key = UNTERMINATED_KEY.exec(text) ?? PARTIAL_HEADER.exec(text);
  const head = key === null ? text : text.slice(0, key.index);
  const tail = /\S+$/.exec(head);
  return tail === null ? head : head.slice(0, tail.index);
}

const SECRET_START = /^(?:sk-|gh[opsur]_|github_pat_|eyJ|tid=|-----BEGIN)/;
/** Shortest leading fragment of a known credential value that is masked; shorter ones are too common to tell apart. */
const MIN_FRAGMENT = 6;

/**
 * Mask the end of `text` when it is the leading fragment of a known credential value (auth.json or a secret-named env
 * variable): such a value has no recognisable shape, so only the known-value list can tell.
 * @param {string} text
 * @param {readonly string[]} [values]
 * @returns {string}
 */
export function maskKnownFragment(text, values = knownValues()) {
  let longest = 0;
  for (const value of values)
    for (let k = Math.min(value.length - 1, text.length); k >= MIN_FRAGMENT && k > longest; k--)
      if (text.endsWith(value.slice(0, k))) { longest = k; break; }
  return longest === 0 ? text : `${text.slice(0, text.length - longest)}[REDACTED:partial]`;
}

/**
 * Redact a snapshot of text that may still grow (a running job's log, a value a tool replaces while it streams):
 * redact the complete part and mask a trailing fragment that starts like a secret or like a known credential value,
 * since no pattern can recognise half a secret. Redacting a later, longer snapshot cannot retract a published prefix.
 * @param {string} text
 * @param {(text: string) => string} [sanitize]
 * @returns {string}
 */
export function redactGrowing(text, sanitize = redact) {
  const complete = completePrefix(text);
  // A trailing token that is already a whole secret is masked as such; one that still starts like a secret is masked.
  const rest = sanitize(text.slice(complete.length));
  return sanitize(complete) + (SECRET_START.test(rest.trimStart()) || rest.includes("-----BEGIN") ? "[REDACTED:partial]" : maskKnownFragment(rest));
}

const SKIP_BLOCKS = new Set(["image", "thinking", "redacted_thinking"]); // binary data and provider-signed reasoning

/**
 * Redact every string in a JSON-like value. Returns the same reference when nothing changed.
 * Takes one auth.json/env snapshot per call, at the first non-empty string; batch several values in one array to share it.
 */
export function redactDeep(value) {
  let snapshot;
  const walk = (value) => {
    if (typeof value === "string") return value === "" ? value : redactWith(snapshot ??= knownRegex(), value);
    if (!value || typeof value !== "object" || SKIP_BLOCKS.has(value.type)) return value;
    let changed = false;
    const copy = Array.isArray(value) ? [] : {};
    for (const [key, item] of Object.entries(value)) {
      const next = walk(item);
      if (next !== item) changed = true;
      copy[key] = next;
    }
    return changed ? copy : value;
  };
  return walk(value);
}
