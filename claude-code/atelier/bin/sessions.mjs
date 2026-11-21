// Where daemons record how their CLI reaches them: one file per Claude Code session, readable only by the user.
import { homedir } from "node:os";
import path from "node:path";

export const sessionsDir = () => path.join(process.env.ATELIER_HOME || path.join(homedir(), ".claude", "atelier"), "sessions");
// Session ids come from Claude Code or the daemon's ready line; keep them to a file-name-safe shape.
export const sessionFile = (id) => {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error(`Bad session id ${id}`);
  return path.join(sessionsDir(), `${id}.json`);
};
export const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code === "EPERM"; } };
