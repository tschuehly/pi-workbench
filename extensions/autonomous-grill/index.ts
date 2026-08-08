import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAutonomousGrillCommand } from "./command.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillPath = path.resolve(here, "../../skills/autonomous-grill/SKILL.md");

export default function autonomousGrillExtension(pi: ExtensionAPI) {
  registerAutonomousGrillCommand(pi, skillPath);
}
