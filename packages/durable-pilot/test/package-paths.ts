import { homedir } from "node:os";
import { join } from "node:path";

const installed = process.env.PILOT_PI_PACKAGES ?? join(homedir(), ".pi", "agent", "npm", "node_modules");
export const packagePaths = [join(installed, "pi-web-access"), join(installed, "ping-a-human-pi"),
	process.env.PILOT_MONITOR_FORK ?? join(homedir(), "IdeaProjects", "pi-process-monitor")];
