# Verify a claimed improvement

**Pick when:** the human must check whether an implemented change actually works, not merely whether it exists.

**Hierarchy:** Before/Now claim → reachable target and setup → numbered exercise with Expected result →
observed outcome → Confirm/Redo. An inaccessible scenario stays explicitly unverified and has no Verdict
control. If the human spots something else, a locator becomes a typed Request to make a new claim.

**Compose:** [claim-card](../components/claim-card/README.md) is sufficient for text or an external app link;
[observation-stamp](../components/observation-stamp/README.md) identifies the exercised build;
[review-bridge](../components/review-bridge/README.md) optionally adds in-app marking and width trials.
A bridge adds location evidence, never behavioral proof.

**Why:** Before/Now → how to verify → Expected → Confirm/Redo was the strongest earlier tested composition.
Yet six claims were confirmed against a 404, and a selector match was treated as a scenario. Confirm/Redo
was enough; Reset was rejected ([LAU via WC T2/§3](../SOURCES.md)). This does not validate WC's later four-app trial.

**Does not fit:** unimplemented proposals or a locked-down third-party app that cannot host a dev bridge.
Use a Decision for adopting a proposal. In-app Comment scope must be agreed; a run-level Comment may suffice.
