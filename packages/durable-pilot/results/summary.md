# Crash-matrix evidence summary

Generated 2026-10-22T12:44:59.602Z at commit 364ed65; Node v26.7.0, SQLite 3.53.4, pi-durable 1.4.0.
Each row is one fault window and shutdown mode (kill = SIGKILL of the host process, close = graceful Harness close).
Per-iteration evidence is in `evidence/<row>.jsonl`; the sample column is from the first passing iteration.

| Window / mode | Passed | Mean ms | Sample evidence |
| --- | --- | --- | --- |
| child.after-delivery.close | 20/20 | 908 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.after-delivery.kill | 20/20 | 957 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.after-result.close | 20/20 | 1103 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.after-result.kill | 20/20 | 950 | requests 5; integrity ok; reporter 22:completed; owner epoch 2 |
| child.before-admission.close | 20/20 | 1011 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.before-admission.kill | 20/20 | 814 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.before-delivery.close | 20/20 | 1016 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.before-delivery.kill | 20/20 | 1064 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.cancel-leaf.close | 20/20 | 961 | requests 6; integrity ok; reporter 22:completed; owner epoch 2 |
| child.cancel-leaf.kill | 20/20 | 951 | requests 6; integrity ok; reporter 22:completed; owner epoch 2 |
| child.cancel-parent.close | 20/20 | 894 | requests 2; integrity ok; reporter 22:aborted; owner epoch 2 |
| child.cancel-parent.kill | 20/20 | 875 | requests 2; integrity ok; reporter 22:aborted; owner epoch 2 |
| child.cancel-worker.close | 20/20 | 937 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.cancel-worker.kill | 20/20 | 943 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.worker-leaf.close | 20/20 | 1012 | requests 7; integrity ok; reporter 22:completed; owner epoch 2 |
| child.worker-leaf.kill | 20/20 | 901 | requests 7; integrity ok; reporter 22:completed; owner epoch 2 |
| generation.after-partial.close | 20/20 | 959 | requests 2; integrity ok; owner epoch 2 |
| generation.after-partial.kill | 20/20 | 989 | requests 2; integrity ok; owner epoch 2 |
| generation.before-partial.close | 20/20 | 1019 | requests 2; integrity ok; owner epoch 2 |
| generation.before-partial.kill | 20/20 | 1023 | requests 2; integrity ok; owner epoch 2 |
| generation.deferred.close | 20/20 | 848 | requests 2; integrity ok; owner epoch 2 |
| generation.deferred.kill | 20/20 | 880 | requests 2; integrity ok; owner epoch 2 |
| ownership.competing-owner | 20/20 | - | integrity ok |
| ownership.crash-loop-parking | 20/20 | - | integrity ok |
| ownership.disk-full.close | 20/20 | 6596 | requests 3; integrity ok; owner epoch 2 |
| ownership.disk-full.kill | 20/20 | 6617 | requests 3; integrity ok; owner epoch 2 |
| question.after-commit.close | 20/20 | 931 | requests 3; integrity ok; owner epoch 2 |
| question.after-commit.kill | 20/20 | 963 | requests 3; integrity ok; owner epoch 2 |
| question.answer-undelivered.close | 20/20 | 940 | requests 3; integrity ok; owner epoch 2 |
| question.answer-undelivered.kill | 20/20 | 941 | requests 3; integrity ok; owner epoch 2 |
| question.attention-race.close | 20/20 | 1122 | requests 0; integrity ok; owner epoch 2 |
| question.attention-race.kill | 20/20 | 1025 | requests 0; integrity ok; owner epoch 2 |
| question.before-commit.close | 20/20 | 919 | requests 3; integrity ok; owner epoch 2 |
| question.before-commit.kill | 20/20 | 884 | requests 3; integrity ok; owner epoch 2 |
| question.delivered-unacked.close | 20/20 | 958 | requests 3; integrity ok; owner epoch 2 |
| question.delivered-unacked.kill | 20/20 | 1074 | requests 3; integrity ok; owner epoch 2 |
| queue.after-commit.close | 20/20 | 862 | requests 1; integrity ok; owner epoch 2 |
| queue.after-commit.kill | 20/20 | 847 | requests 1; integrity ok; owner epoch 2 |
| queue.changed-payload.close | 20/20 | 872 | requests 1; integrity ok; owner epoch 2 |
| queue.changed-payload.kill | 20/20 | 880 | requests 1; integrity ok; owner epoch 2 |
| queue.failed-run.close | 20/20 | 912 | requests 4; integrity ok; owner epoch 2 |
| queue.failed-run.kill | 20/20 | 910 | requests 4; integrity ok; owner epoch 2 |
| queue.mid-commit.close | 20/20 | 897 | requests 1; integrity ok; owner epoch 2 |
| queue.mid-commit.kill | 20/20 | 920 | requests 1; integrity ok; owner epoch 2 |
| queue.order.close | 20/20 | 1017 | requests 4; effects 2; integrity ok; owner epoch 2 |
| queue.order.kill | 20/20 | 1015 | requests 4; effects 2; integrity ok; owner epoch 2 |
| schema.task-doc-failed.close | 20/20 | 768 | integrity ok |
| schema.task-doc-failed.kill | 20/20 | 815 | integrity ok |
| schema.task-doc-missing.close | 20/20 | 812 | integrity ok |
| schema.task-doc-missing.kill | 20/20 | 784 | integrity ok |
| schema.task-doc-upgrade.close | 20/20 | 749 | integrity ok |
| schema.task-doc-upgrade.kill | 20/20 | 485 | integrity ok |
| schema.upgrade-rollback | 20/20 | - | integrity ok/ok |
| tools.safe-safe.close | 20/20 | 979 | requests 2; effects 2; integrity ok; owner epoch 2 |
| tools.safe-safe.kill | 20/20 | 1057 | requests 2; effects 2; integrity ok; owner epoch 2 |
| tools.safe-unsafe.close | 20/20 | 1028 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
| tools.safe-unsafe.kill | 20/20 | 1164 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
| tools.unsafe-effect-reproposed.close | 20/20 | 954 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
| tools.unsafe-effect-reproposed.kill | 20/20 | 1027 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
| tools.unsafe-safe.close | 20/20 | 1069 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
| tools.unsafe-safe.kill | 20/20 | 1202 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
