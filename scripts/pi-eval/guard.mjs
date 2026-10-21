// Trial-readable generic guard. No case selectors, source paths or oracle data belong here.
export default function (pi) {
  pi.on('tool_call', event => {
    if (event.toolName !== 'bash') return;
    const t = event.input.timeout;
    if (t !== undefined && (typeof t !== 'number' || !Number.isFinite(t) || t <= 0)) return { block: true, reason: 'Invalid timeout: finite positive seconds required' };
    event.input.timeout = Math.min(t ?? 900, 900);
    // Other stacks may opt into an explicitly enumerated command policy, without a Gradle assumption.
    if (process.env.PI_EVAL_COMMAND_POLICY) {
      const patterns = JSON.parse(process.env.PI_EVAL_COMMAND_POLICY);
      if (!patterns.some(pattern => new RegExp(`^(?:${pattern})$`).test(event.input.command))) return { block: true, reason: 'Command refused by case policy' };
    }
  });
}
