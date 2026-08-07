const QUOTA_ARGS = ["--provider", "claude", "--json"];
const KEYCHAIN_ARGS = ["--allow-keychain-prompt", ...QUOTA_ARGS];

export async function checkClaudeQuota(run) {
  return runAndClassify(run, "quota-axi", QUOTA_ARGS);
}

export function noticeForQuotaCheck(check, manual) {
  if (check.status === "fresh") {
    return manual ? { level: "info", message: "Claude quota telemetry is fresh." } : undefined;
  }
  if (check.status === "rate-limited") {
    return manual
      ? { level: "warning", message: "Claude quota endpoint is rate limited. Child launches can proceed with degraded telemetry; retry /quota-check later." }
      : undefined;
  }
  if (check.status === "unavailable") {
    return {
      level: "warning",
      message: `Claude quota startup check could not inspect telemetry: ${check.diagnostic ?? "unknown error"}\nRun /quota-check to retry.`,
    };
  }
  return undefined;
}

export function isRepairableQuotaStatus(status) {
  return status === "keychain-required" || status === "sign-in-required";
}

export async function repairClaudeQuota(run, status) {
  if (status === "sign-in-required") {
    const login = await safeRun(run, "claude", ["auth", "login"]);
    if (login.error || login.result?.code !== 0) {
      return unavailable(diagnosticFor(login, "Claude login did not complete."));
    }
  }

  if (status !== "keychain-required" && status !== "sign-in-required") {
    return unavailable(`No automatic repair is available for quota status '${status}'.`);
  }

  return runAndClassify(run, "quota-axi", KEYCHAIN_ARGS);
}

async function runAndClassify(run, command, args) {
  const execution = await safeRun(run, command, args);
  if (execution.error || execution.result?.code !== 0) {
    return unavailable(diagnosticFor(execution, `${command} failed.`));
  }

  try {
    return classify(JSON.parse(execution.result.stdout));
  } catch (error) {
    return unavailable(`quota-axi returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function classify(report) {
  const provider = Array.isArray(report?.providers)
    ? report.providers.find((candidate) => candidate?.provider === "claude")
    : undefined;
  if (!provider) return unavailable("Claude quota telemetry is absent.");

  const state = provider.state ?? {};
  if (state.status === "fresh" && state.stale !== true) {
    return { status: "fresh", diagnostic: undefined };
  }
  if (state.reason === "keychain_access_required" || String(state.remedyCommand ?? "").includes("--allow-keychain-prompt")) {
    return { status: "keychain-required", diagnostic: state.error ?? "Claude quota access needs macOS Keychain approval." };
  }
  if (state.status === "auth_required" || /sign[ -]?in required/i.test(String(state.error ?? ""))) {
    return { status: "sign-in-required", diagnostic: state.error ?? "Claude sign-in is required." };
  }
  if (state.status === "rate_limited" || /rate limit/i.test(String(state.error ?? ""))) {
    return { status: "rate-limited", diagnostic: state.error ?? "Claude quota endpoint rate limited" };
  }
  return unavailable(state.error ?? `Claude quota telemetry is ${String(state.status ?? "unavailable")}.`);
}

async function safeRun(run, command, args) {
  try {
    return { result: await run(command, args) };
  } catch (error) {
    return { error };
  }
}

function diagnosticFor(execution, fallback) {
  if (execution.error) return execution.error instanceof Error ? execution.error.message : String(execution.error);
  return String(execution.result?.stderr || execution.result?.stdout || fallback).trim();
}

function unavailable(diagnostic) {
  return { status: "unavailable", diagnostic };
}
