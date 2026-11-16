import { existsSync } from "node:fs";

// process.execPath is the resolved, versioned binary (e.g. Homebrew's Cellar/node@24/<version>); an
// upgrade deletes it under a long-running PI WEB daemon, so fall back to whatever `node` PATH finds.
export const nodeBin = () => (existsSync(process.execPath) ? process.execPath : "node");
