import { readFile } from "node:fs/promises";

const builtIns = new Set(["comfortable", "compact"]);
const profileIdPattern = /^[a-z][a-z0-9.-]*$/u;
const profileKeys = new Set(["version", "title", "description", "extends", "tokens"]);

const tokens = {
  "--pi-control-min-size": {
    meaning: "minimum interactive-control block size",
    min: 24,
    max: 64,
    comfortable: "32px",
    compact: "26px",
  },
  "--pi-control-padding-block": {
    meaning: "vertical padding inside controls",
    min: 0,
    max: 24,
    comfortable: "6px",
    compact: "3px",
  },
  "--pi-control-padding-inline": {
    meaning: "horizontal padding inside controls",
    min: 0,
    max: 32,
    comfortable: "8px",
    compact: "6px",
  },
  "--pi-list-row-padding-block": {
    meaning: "vertical padding in navigation and list rows",
    min: 0,
    max: 24,
    comfortable: "6px",
    compact: "2px",
  },
  "--pi-list-row-padding-inline": {
    meaning: "horizontal padding in navigation and list rows",
    min: 0,
    max: 32,
    comfortable: "8px",
    compact: "5px",
  },
  "--pi-panel-padding": {
    meaning: "inset around panels and major regions",
    min: 0,
    max: 48,
    comfortable: "10px",
    compact: "6px",
  },
  "--pi-toolbar-gap": {
    meaning: "spacing between toolbar actions",
    min: 0,
    max: 32,
    comfortable: "6px",
    compact: "3px",
  },
  "--pi-message-padding": {
    meaning: "inset within conversation messages",
    min: 0,
    max: 48,
    comfortable: "10px",
    compact: "6px",
  },
  "--pi-message-gap": {
    meaning: "spacing between conversation messages",
    min: 0,
    max: 48,
    comfortable: "10px",
    compact: "6px",
  },
  "--pi-content-max-width": {
    meaning: "maximum conversation content width",
    min: 320,
    max: 2400,
    allowNone: true,
    comfortable: "none",
    compact: "none",
  },
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allowedValue(spec) {
  return `${spec.min}px–${spec.max}px${spec.allowNone === true ? " or none" : ""}`;
}

function describe() {
  const rows = Object.entries(tokens).map(([token, spec]) => ({
    token,
    meaning: spec.meaning,
    allowed: allowedValue(spec),
    comfortable: spec.comfortable,
    compact: spec.compact,
  }));
  console.table(rows);
  console.log("Profiles extend comfortable or compact. Values are finite non-negative px strings; content max width also accepts none.");
}

function validateString(value, field, max) {
  if (typeof value !== "string" || value === "") throw new Error(`${field} must be a non-empty string`);
  if (value.length > max) throw new Error(`${field} must be at most ${max} characters`);
}

function validateToken(token, value) {
  const spec = tokens[token];
  if (spec === undefined) throw new Error(`unknown presentation token ${JSON.stringify(token)}`);
  if (spec.allowNone === true && value === "none") return;
  if (typeof value !== "string") throw new Error(`${token} must be a pixel value${spec.allowNone === true ? " or none" : ""}`);
  const match = /^([0-9]+(?:\.[0-9]+)?)px$/u.exec(value);
  const number = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isFinite(number) || number < spec.min || number > spec.max) {
    throw new Error(`${token} must be ${allowedValue(spec)}`);
  }
}

function validateProfile(id, profile) {
  if (!profileIdPattern.test(id) || builtIns.has(id)) throw new Error(`profile id ${JSON.stringify(id)} is invalid or reserved`);
  if (!isRecord(profile)) throw new Error("profile must be an object");
  const unknownKey = Object.keys(profile).find((key) => !profileKeys.has(key));
  if (unknownKey !== undefined) throw new Error(`unknown profile key ${JSON.stringify(unknownKey)}`);
  if (profile.version !== 1) throw new Error("profile version must be 1");
  validateString(profile.title, "title", 80);
  validateString(profile.description, "description", 240);
  if (!builtIns.has(profile.extends)) throw new Error("extends must be comfortable or compact");
  if (!isRecord(profile.tokens)) throw new Error("tokens must be an object");
  for (const [token, value] of Object.entries(profile.tokens)) validateToken(token, value);
}

async function validate(path, id) {
  let config;
  try {
    config = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(config)) throw new Error("global config must be a JSON object");
  if (!isRecord(config.presentationProfiles)) throw new Error("global config must contain a presentationProfiles object");
  if (!(id in config.presentationProfiles)) throw new Error(`profile ${JSON.stringify(id)} was not found`);
  validateProfile(id, config.presentationProfiles[id]);
  console.log(`Valid PI WEB presentation profile: ${id} (${path})`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "describe" && args.length === 0) describe();
  else if (command === "validate" && args.length === 2) await validate(args[0], args[1]);
  else {
    console.error("Usage:\n  profile-tool.mjs describe\n  profile-tool.mjs validate <global-config.json> <profile-id>");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
