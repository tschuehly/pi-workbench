import { checkCommand } from "cc-safety-net/api";

/**
 * Throws before launch when cc-safety-net denies `command` (e.g. `rm -rf $UNSET/*`). Its level (strict on Thomas's Mac)
 * comes from ~/.cc-safety-net/policy.json, the file its Pi extension reads too.
 */
export function refuseUnsafe(command, cwd) {
  const verdict = checkCommand({ command, cwd });
  if (verdict.kind === "deny") throw new Error(`Blocked by cc-safety-net (${verdict.ruleId}): ${verdict.reason}`);
}
