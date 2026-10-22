// The non-Claude providers of a legacy Chat on Durable: the ChatGPT subscription (`openai-codex`) and GitHub Copilot,
// pi-ai 1.4.0's own providers. Their logins come from Pi's auth.json through PiAuthStore (Pi's lock, Pi's format), so
// a provider without a stored login is simply unavailable; nothing here logs in. Plus pi-openai-fast-mode 0.5.0
// (`/fast`, the `service_tier` payload hook), ported from its source because the package binds to Pi's extension API.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { wrapProvider } from "./redact.ts";

/** Credential paths other than Pi's auth.json that these providers would read: removed, as ANTHROPIC_* for Claude. */
export const ENV_CREDENTIALS = ["COPILOT_GITHUB_TOKEN"];

/**
 * Both providers behind the redacting wrapper; Codex at models.json's baseUrl when set (Copilot's endpoint comes from
 * its login's proxy-ep, which pi-ai applies over any model baseUrl), and its requests carry Fast Mode's service tier.
 */
export function subscriptionProviders(fast: FastMode): Provider[] {
	const codex = withBaseUrl(withStoredModels(openaiCodexProvider()), modelsJsonBaseUrl("openai-codex"));
	return [wrapProvider(codex, { onPayload: fast.payload }), wrapProvider(withStoredModels(githubCopilotProvider()))];
}

export const agentDir = () => process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

/**
 * `providers.<id>.baseUrl` from Pi's models.json in the agent dir, which legacy Pi applies to that provider's built-in
 * models (a proxy, or the e2e mock in pi-web `e2e/mockModels/`). Unreadable or absent: the provider's own endpoint.
 * ponytail: only baseUrl is honored; headers, models and modelOverrides stay legacy-only until a Durable Chat needs them.
 */
export function modelsJsonBaseUrl(providerId: string, dir = agentDir()): string | undefined {
	try {
		const config = JSON.parse(readFileSync(join(dir, "models.json"), "utf8")) as { providers?: Record<string, { baseUrl?: unknown }> };
		const baseUrl = config.providers?.[providerId]?.baseUrl;
		return typeof baseUrl === "string" && baseUrl !== "" ? baseUrl : undefined;
	} catch {
		return undefined;
	}
}

/** The provider with every model served from `baseUrl`; unchanged when it is undefined. */
export function withBaseUrl<P extends Provider>(provider: P, baseUrl: string | undefined): P {
	if (baseUrl === undefined) return provider;
	return {
		...provider,
		baseUrl,
		getModels: () => provider.getModels().map((model) => ({ ...model, baseUrl })),
		...(provider.getAllModels === undefined ? {} : { getAllModels: () => provider.getAllModels!().map((model) => ({ ...model, baseUrl })) }),
	};
}


/**
 * The provider's models as Pi's model runtime has them: the built-in list, with the models Pi last fetched for it
 * (`models-store.json`) replacing same-ID entries and appended otherwise (pi-ai `createProvider` merge). Read-only: Pi
 * stays the only writer of that file. A provider's `filterModels` (Copilot's login) still applies.
 */
// ponytail: snapshot at host open without Pi's lock; an unreadable file falls back to the built-in list until the next open.
export function withStoredModels(provider: Provider): Provider {
	let stored: Model<Api>[] = [];
	try {
		const entry = (JSON.parse(readFileSync(join(agentDir(), "models-store.json"), "utf8")) as Record<string, { models?: unknown }>)[provider.id];
		if (Array.isArray(entry?.models))
			stored = (entry.models as (Model<Api> & { type?: string })[]).filter((m) => m.provider === provider.id && (m.type ?? "chat") === "chat");
	} catch {
		return provider;
	}
	if (stored.length === 0) return provider;
	const merged = [...provider.getModels()];
	for (const model of stored) {
		const at = merged.findIndex((m) => m.id === model.id);
		if (at >= 0) merged[at] = model;
		else merged.push(model);
	}
	return { ...provider, getModels: () => merged };
}

// ─── pi-openai-fast-mode 0.5.0 ───────────────────────────────────────────────

/** The package's DEFAULT_CONFIG targets (src/config.ts); it replaces a file's targets with these on every load. */
const TARGETS = ["openai", "openai-codex"].flatMap((provider) =>
	["gpt-5.4", "gpt-5.5", "gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra"].map((model) => ({ provider, model, serviceTier: "priority" })),
);
export const FAST_STATUS = "pi-openai-fast-mode";
const USAGE = "Usage: /fast [on|off|toggle]";
/** The package's command, listed with the Chat's other commands. */
export const FAST_COMMAND = { name: "fast", description: "Toggle Fast Mode. Usage: /fast [on|off|toggle]" } as const;

export type FastMode = {
	/** pi-ai `onPayload`: `service_tier` for a target model while Fast Mode is on. */
	readonly payload: (payload: unknown, model: { provider: string; id: string }) => unknown;
	/** Whether a request to this model would go out fast (the package's status text). */
	readonly active: (model: { provider: string; id: string } | undefined) => boolean;
	/** `/fast [on|off|toggle]`: writes the package's own config file. */
	readonly command: (args: string) => { type: "done"; message: string } | { type: "unsupported"; message: string };
};

/**
 * Fast Mode for one Chat's workspace, read from the same file the legacy package uses (`<cwd>/.pi/pi-openai-fast-mode/
 * config.json` when it exists, else `<agent dir>/extensions/pi-openai-fast-mode/config.json`). The file is read per
 * request, so a toggle in a legacy Chat applies to the next Durable request too.
 */
// ponytail: applies whenever the config says enabled, even if the package were uninstalled; read settings.json packages if that matters.
export function fastMode(cwd: string): FastMode {
	const path = () => {
		const project = join(resolve(cwd), ".pi", "pi-openai-fast-mode", "config.json");
		return existsSync(project) ? project : join(agentDir(), "extensions", "pi-openai-fast-mode", "config.json");
	};
	const enabled = () => {
		try {
			const raw = JSON.parse(readFileSync(path(), "utf8")) as { enabled?: unknown };
			return raw.enabled === true;
		} catch {
			return false;
		}
	};
	const target = (model: { provider: string; id: string } | undefined) =>
		model === undefined ? undefined : TARGETS.find((t) => t.provider === model.provider && t.model === model.id);
	return {
		payload: (payload, model) => {
			const hit = target(model);
			if (hit === undefined || !enabled() || typeof payload !== "object" || payload === null || Array.isArray(payload)) return payload;
			return { ...payload, service_tier: hit.serviceTier };
		},
		active: (model) => target(model) !== undefined && enabled(),
		command: (args) => {
			const word = args.trim().toLowerCase();
			let next: boolean;
			if (word === "" || word === "toggle") next = !enabled();
			else if (word === "on" || word === "off") next = word === "on";
			else return { type: "unsupported", message: USAGE };
			const file = path();
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, `${JSON.stringify({ enabled: next, targets: TARGETS }, null, 2)}\n`, "utf8");
			return { type: "done", message: `Fast Mode ${next ? "on" : "off"}` };
		},
	};
}
