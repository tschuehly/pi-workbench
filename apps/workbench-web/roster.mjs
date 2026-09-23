// PI WEB SessionStatus.extensionStatuses carries the Workbench activity extension's
// reported Worker/Subagent rows. Missing status is unknown, not completed work.
const terminal = new Set(['success', 'preflight failed', 'launch failed', 'execution failed', 'cancelled', 'outcome unknown', 'finished', 'timed out']);
const optional = (value, max) => value === undefined || typeof value === 'string' && value.length <= max;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\s\p{Cc}\p{Cf}]/u.test(value);
export function delegates(status) {
  const raw = status?.extensionStatuses?.['pi-workbench:activity'];
  if (typeof raw !== 'string') return { available: false, items: [] };
  if (raw.length > 65_536) return { available: false, items: [] };
  let payload;
  try { payload = JSON.parse(raw); } catch { return { available: false, items: [] }; }
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload.items) || payload.items.length > 64) return { available: false, items: [] };
  const ids = new Set();
  for (const item of payload.items) {
    if (!item || !id(item.id) || ids.has(item.id) || !['worker', 'subagent'].includes(item.kind)
      || !optional(item.name, 48) || !optional(item.role, 32) || !optional(item.model, 96)
      || !optional(item.effort, 16) || !optional(item.objective, 240)
      || !optional(item.activity, 120) || !optional(item.reportedStatus, 120)) return { available: false, items: [] };
    ids.add(item.id);
  }
  return { available: true, items: payload.items.map(item => ({ ...item, terminal: terminal.has(item.activity?.toLowerCase().replaceAll('_', ' ') ?? '') })) };
}
