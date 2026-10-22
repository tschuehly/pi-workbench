// The remaining Workbench extensions in a Durable Chat (Phase B slice 5 group A), each a new binding around the
// extension's existing core: the runtime identity environment tools see (PI_SESSION_ID, PI_TMP, model; Pi's bash
// tool and background-bash set the same), pi-tmp's path guard, bash warning and sweeper, storage-guard's lead-only
// low-disk notice, and the /quota-check host command. activity is projected in chat-session.ts from the committed tool
// events. Not ported (owner scope, 2026-10-22): autonomous-grill, lead-fallback, agent-audit.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import { AgentDoc, type Conversation, type ConversationId, defineDoc, defineExtension, type DocumentReader, hook, type ToolRegistration, ToolTask } from "@earendil-works/pi-durable";
import { blockTmpWrite, piTmpDir, sweep, warnTmpBash } from "../../../extensions/pi-tmp/pitmp.mjs";
import { checkClaudeQuota, isRepairableQuotaStatus, noticeForQuotaCheck, repairClaudeQuota } from "../../../extensions/quota-startup/check.mjs";
import { CUSTOM_TYPE as STORAGE_CUSTOM_TYPE, freeGb, lowDiskNotice } from "../../../extensions/storage-guard/guard.mjs";
import { context } from "./host.ts";

export const STORAGE_ENTRY = "workbench.storage-guard";
/** Passive Workbench entry kinds → the legacy custom message type the browser shows. */
export const NOTICE_TYPES: Record<string, string> = { [STORAGE_ENTRY]: STORAGE_CUSTOM_TYPE };

const userMessage = (text: string): Message => ({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });

// ─── Runtime identity environment (P034) and pi-tmp (P085) ──────────────────

/** Identity variables a stale parent process may carry; every Durable tool call gets its own instead. */
const IDENTITY = ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL", "PI_TMP"] as const;

/** Drop inherited identity from the host process, so a tool never sees another session's; call once at open. */
export function clearInheritedIdentity(env: NodeJS.ProcessEnv = process.env): void {
	for (const name of IDENTITY) delete env[name];
}

/**
 * The environment one conversation's shell commands run with, as Pi's bash tool and background-bash set it: the Chat's
 * ID (a child conversation gets its own), its PI_TMP folder, its model and effort, and the agent's `bin` first on PATH.
 * No PI_SESSION_FILE: a Durable Chat has no coding-agent session file. Never TMPDIR (Unix socket path limit).
 */
export function toolEnv(identity: { chatId: string; conversationId: ConversationId; rootId: ConversationId | undefined; cwd: string; model?: { provider: string; modelId: string }; thinkingLevel?: string }): NodeJS.ProcessEnv {
	const sessionId = identity.rootId === undefined || identity.conversationId === identity.rootId ? identity.chatId : `${identity.chatId}:${String(identity.conversationId)}`;
	const bin = join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "bin");
	const path = (process.env.PATH ?? "").split(delimiter).filter((entry) => entry !== "" && entry !== bin);
	return {
		PI_SESSION_ID: sessionId,
		PI_TMP: piTmpDir(identity.cwd, sessionId),
		PATH: [bin, ...path].join(delimiter),
		...(identity.model === undefined ? {} : { PI_PROVIDER: identity.model.provider, PI_MODEL: identity.model.modelId }),
		...(identity.thinkingLevel === undefined ? {} : { PI_REASONING_LEVEL: identity.thinkingLevel }),
	};
}

/** The stored agent of a conversation, read by the execution environment factory. */
export async function storedAgent(read: DocumentReader, conversationId: ConversationId, c: Context = context) {
	return read.snapshot(AgentDoc, conversationId, c);
}

/** pi-tmp's sweeper: best effort, at host open (a legacy session's start). */
export function sweepPiTmp(): void {
	try {
		sweep();
	} catch {
		// Cleanup is best effort.
	}
}

/** pi-tmp's result warning on bash: appended to what the model reads (the retained output when the tool returns none). */
export function warningTool<T extends ToolRegistration>(tool: T): T {
	if (tool.name !== "bash") return tool;
	const execute: ToolRegistration["execute"] = async (args, api, c) => {
		const result = await tool.execute(args as never, api, c);
		const warning = warnTmpBash((args as { command?: unknown }).command) as string | undefined;
		if (warning === undefined) return result;
		const output = result.output ?? [{ type: "text" as const, text: api.retainedOutput().text }];
		return { ...result, output: [...output, { type: "text" as const, text: warning }] };
	};
	return { ...tool, execute } as T;
}

/** Durable binding of pi-tmp's path guard, before intent. */
export function workbenchExtensions(defaultCwd: string) {
	return defineExtension({
		name: "workbench.extensions",
		hooks: [
			hook(ToolTask, {
				// Tool hooks match by name, as the legacy `tool_call` handler does; a throw blocks too.
				beforeTool: async (call, api, c) => {
					if (call.name !== "write" && call.name !== "edit") return undefined;
					const cwd = (await api.snapshot(AgentDoc, api.conversationId, c))?.cwd ?? defaultCwd;
					const reason = blockTmpWrite((call.arguments as { path?: unknown }).path, cwd) as string | undefined;
					return reason === undefined ? undefined : { block: reason };
				},
			}),
		],
	});
}

// ─── storage-guard (P088) ────────────────────────────────────────────────────

/** The free space at the last notice, so a restart does not repeat it; a fork starts fresh, as a new session does. */
export const StorageGuardDoc = defineDoc<{ notedAt: number | null }>({
	kind: "workbench.storage-guard",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ notedAt: null }),
	checkpointWhen: () => false,
});

/**
 * Host input preflight before a lead run starts: the existing low-disk notice as a model-visible entry, committed with
 * the threshold it was given at. No forced cleanup turn.
 */
export async function storagePreflight(conversation: Conversation): Promise<boolean> {
	const gb = freeGb() as number;
	return conversation.commit(async (tx) => {
		const doc = await tx.doc(StorageGuardDoc, conversation.id);
		const text = lowDiskNotice(gb, doc.notedAt ?? undefined) as string | undefined;
		if (text === undefined) return false;
		doc.notedAt = gb;
		await tx.appendEntry(conversation.id, { kind: STORAGE_ENTRY, model: [userMessage(text)], data: { freeGb: Math.round(gb) } });
		return true;
	}, context);
}

// ─── Host command: /quota-check (P086) ──────────────────────────────────────

export type CommandResult = { type: "done"; message?: string };

const QUOTA_DESCRIPTION = "Check Claude quota telemetry; /quota-check repair starts Claude sign-in or Keychain repair";

export const COMMANDS = [{ name: "quota-check", description: QUOTA_DESCRIPTION }] as const;

/** Run one host command. None sends model input yet; the operation ID is for those that will. */
export async function runCommand(name: string, args: string): Promise<CommandResult> {
	if (name === "quota-check") return { type: "done", message: await quotaCheck(args, exec) };
	throw new Error(`Unknown command /${name}`);
}

type Run = (command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

/** pi.exec's contract: resolves with the exit code; rejects only when the command cannot start. */
const exec: Run = (command, args) =>
	new Promise((resolve, reject) => {
		execFile(command, args, { timeout: command === "claude" ? 180_000 : 30_000, encoding: "utf8" }, (error, stdout, stderr) => {
			if (error !== null && typeof error.code !== "number" && error.killed !== true) reject(error);
			else resolve({ code: error === null ? 0 : typeof error.code === "number" ? error.code : 1, stdout, stderr });
		});
	});

/**
 * `/quota-check`: the legacy check and notices. Repair (Claude sign-in, a macOS Keychain prompt) needs the owner's
 * attended confirmation, so it runs only on an explicit `/quota-check repair`, never at open or recovery.
 */
export async function quotaCheck(args: string, run: Run): Promise<string> {
	const mode = args.trim();
	if (mode !== "" && mode !== "repair") return "Usage: /quota-check [repair]";
	type Check = { status: string; diagnostic?: string };
	const check = (await checkClaudeQuota(run)) as Check;
	const notice = noticeForQuotaCheck(check, true) as { message: string } | undefined;
	if (notice !== undefined) return notice.message;
	if (!isRepairableQuotaStatus(check.status)) return `Claude quota status: ${check.status}`;
	const signIn = check.status === "sign-in-required";
	if (mode !== "repair")
		return signIn
			? "Claude quota sign-in required. Run /quota-check repair to open Claude sign-in now, then request persistent macOS Keychain access."
			: "Claude quota needs macOS Keychain access. Run /quota-check repair to request persistent Keychain access now; choose “Always Allow” in the system prompt.";
	const repaired = (await repairClaudeQuota(run, check.status)) as Check;
	return repaired.status === "fresh"
		? "Claude quota telemetry is fresh and future startup checks will be non-interactive."
		: `Claude quota repair did not complete: ${repaired.diagnostic ?? "unknown error"}\nRun claude auth login, then /quota-check.`;
}
