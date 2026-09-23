// Copied only into the owned, offline acceptance agent directory. Never loaded by a live daemon.
// Exercise the real Pi RPC extension UI bridge without a model or a test-only backend route.
export default function (pi: { on: (event: string, handler: (event: unknown, context: any) => void) => void }) {
  let opened = false;
  pi.on("session_start", (_event, context) => {
    if (opened || context.sessionManager.getSessionId() !== "019c8f10-1000-7000-8000-000000000001") return;
    opened = true;
    // Do not await: session startup must finish so the browser can answer the parked dialog.
    void context.ui.confirm("Controlled extension confirmation", "Approve controlled dialog?");
    void context.ui.select("Controlled extension choice", ["First", "Second"]);
    void context.ui.input("Controlled extension input", "Enter fixture text");
  });
}
