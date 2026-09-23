#!/usr/bin/env node
// Serve the owned client through PI WEB's existing fixture application and routes.
// This process is only launched by the isolated acceptance runner.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const clientDist = process.env.PI_WEB_OWNED_CLIENT_DIST;
if (!clientDist || !clientDist.startsWith("/")) throw new Error("PI_WEB_OWNED_CLIENT_DIST must be an absolute path");
const moduleUrl = pathToFileURL(resolve(process.cwd(), "src/server/fixtureServer.ts")).href;
const { buildControlledFixtureServer, controlledFixtureServerOptionsFromEnvironment } = await import(moduleUrl);
const options = controlledFixtureServerOptionsFromEnvironment();
const { app, fixture } = await buildControlledFixtureServer({ ...options, clientDist: resolve(clientDist) });
for (const blocker of fixture.blockers) process.stdout.write(`${JSON.stringify({ type: "FIXTURE_BLOCKER", ...blocker })}\n`);
await app.listen({ port: Number(process.env.PI_WEB_PORT), host: "127.0.0.1" });
