#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [preflight, ...args] = process.argv.slice(2);
if (!preflight) throw new Error("usage: preflight.mjs <atelier-preflight.mjs> <preflight arguments>");
const urlAt = args.indexOf("--url"), surface = new URL(args[urlAt + 1]);
if (urlAt < 0 || surface.hostname !== "127.0.0.1") throw new Error("authorized preflight requires the exact loopback Surface URL");
if (!process.env.ACCESS_TOKEN_FILE) throw new Error("ACCESS_TOKEN_FILE is required");
const token = readFileSync(process.env.ACCESS_TOKEN_FILE, "utf8").trim();
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("invalid access token");
const delegate = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== surface.origin) return delegate(input, init);
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("Authorization", `Bearer ${token}`);
  return delegate(input, { ...init, headers });
};
process.argv = [process.argv[0], resolve(preflight), ...args];
await import(pathToFileURL(resolve(preflight)).href);
