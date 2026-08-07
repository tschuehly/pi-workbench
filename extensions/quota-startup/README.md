# Quota startup check

Checks Claude quota telemetry once when an interactive Pi process starts. Healthy telemetry is silent. If Claude sign-in or one-time macOS Keychain approval is required, Pi asks before opening the browser or requesting Keychain access; it never stores credentials. Non-interactive Pi modes do not prompt.

Use `/quota-check` to rerun the check and repair flow manually. Declining or failing repair does not block Pi or attended child launches; model orchestration reports degraded quota telemetry until a later successful check.
