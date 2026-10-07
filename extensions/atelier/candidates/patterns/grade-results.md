# Grade results without conflating judgments

**Pick when:** answers or artifacts need evaluation on independent dimensions and human correction of a judge.

**Hierarchy:** headline finding → result and expected behavior → judge grades by axis → human Verdict or
Comment alongside each axis → supporting calls/log/raw evidence. A challenge to the test itself becomes a
Kernel Decision on the test, not an unexplained score change. History can follow the per-result view.

**Compose:** [grade-axes](../components/grade-axes/README.md) for independent judgments;
[claim-card](../components/claim-card/README.md) for reproducible expectations;
[run-matrix](../components/run-matrix/README.md) if comparison is the question.
Add [review-filter](../components/review-filter/README.md) for a queue only after defining which axes mean done.

**Why:** “differentiate between correct and taste” led to Correct / Complete / Taste; human corrections
otherwise lived only in chat. The existing report used Headline → False claims and cause → Other findings
([ME T4/T6/T7, O L2827, RESULT-stack-final2](../SOURCES.md)). No eval studio had yet been built.

**Does not fit:** a single subjective media score. Kernel Verdicts lack a required note/prefill workflow;
separate Comments are not atomic overrides. Required-note grading needs Kernel support, not a fake local form.
