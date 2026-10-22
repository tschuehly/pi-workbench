# Crash-matrix evidence summary

Generated 2026-10-22T15:46:48.143Z at commit 060db04; Node v26.7.0, SQLite 3.53.4, pi-durable 1.4.0.
Each row is one fault window and shutdown mode (kill = SIGKILL of the host process, close = graceful Harness close).
Per-iteration evidence is in `evidence/<row>.jsonl`; the sample column is from the first passing iteration.

| Window / mode | Passed | Mean ms | Sample evidence |
| --- | --- | --- | --- |
| child.after-delivery.close | 20/20 | 1378 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-delivery.kill | 20/20 | 1372 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-result.close | 20/20 | 1485 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-result.kill | 20/20 | 1439 | requests 5; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-admission.close | 20/20 | 1476 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-admission.kill | 20/20 | 1284 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-delivery.close | 20/20 | 1420 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-delivery.kill | 20/20 | 1405 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-leaf.close | 20/20 | 1745 | requests 6; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-leaf.kill | 20/20 | 1569 | requests 6; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-parent.close | 20/20 | 1371 | requests 2; integrity ok; reporter 22:aborted; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-parent.kill | 20/20 | 1157 | requests 2; integrity ok; reporter 22:aborted; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-worker.close | 20/20 | 1778 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-worker.kill | 20/20 | 1755 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.worker-leaf.close | 20/20 | 1886 | requests 7; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.worker-leaf.kill | 20/20 | 1820 | requests 7; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| generation.after-partial.close | 20/20 | 1051 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.after-partial.kill | 20/20 | 955 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.before-partial.close | 20/20 | 981 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.before-partial.kill | 20/20 | 879 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.deferred.close | 20/20 | 975 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.deferred.kill | 20/20 | 871 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.competing-owner | 20/20 | - | integrity ok |
| ownership.concurrent-refresh-control | 1/1 | - |  |
| ownership.concurrent-refresh | 20/20 | - |  |
| ownership.crash-loop-parking | 20/20 | - | integrity ok |
| ownership.default-pragmas | 1/1 | - |  |
| ownership.disk-full.close | 20/20 | 8375 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.disk-full.kill | 20/20 | 8379 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.store-files | 1/1 | - |  |
| question.after-commit.close | 20/20 | 1136 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.after-commit.kill | 20/20 | 1195 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.answer-undelivered.close | 20/20 | 1131 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.answer-undelivered.kill | 20/20 | 1013 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.attention-race.close | 20/20 | 1148 | requests 0; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.attention-race.kill | 20/20 | 965 | requests 0; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.before-commit.close | 20/20 | 1097 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.before-commit.kill | 20/20 | 1197 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.delivered-unacked.close | 20/20 | 1409 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.delivered-unacked.kill | 20/20 | 1201 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.after-commit.close | 20/20 | 1178 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.after-commit.kill | 20/20 | 1191 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.changed-payload.close | 20/20 | 990 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.changed-payload.kill | 20/20 | 1089 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-readmitted.close | 20/20 | 1516 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-readmitted.kill | 20/20 | 1390 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-receipt.close | 20/20 | 1573 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-receipt.kill | 20/20 | 2045 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-withdrawn.close | 20/20 | 1472 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-withdrawn.kill | 20/20 | 1537 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.failed-run.close | 20/20 | 1258 | requests 4; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.failed-run.kill | 20/20 | 1043 | requests 4; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.mid-commit.close | 20/20 | 1097 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.mid-commit.kill | 20/20 | 933 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.order.close | 20/20 | 1691 | requests 4; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.order.kill | 20/20 | 1612 | requests 4; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| schema.task-doc-failed.close | 20/20 | 964 | integrity ok |
| schema.task-doc-failed.kill | 20/20 | 1140 | integrity ok |
| schema.task-doc-missing.close | 20/20 | 1188 | integrity ok |
| schema.task-doc-missing.kill | 20/20 | 1187 | integrity ok |
| schema.task-doc-upgrade.close | 20/20 | 1286 | integrity ok |
| schema.task-doc-upgrade.kill | 20/20 | 961 | integrity ok |
| schema.upgrade-rollback | 20/20 | - | integrity ok/ok |
| tools.safe-safe.close | 20/20 | 1100 | requests 2; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-safe.kill | 20/20 | 1116 | requests 2; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-unsafe.close | 20/20 | 1089 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-unsafe.kill | 20/20 | 952 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-effect-reproposed.close | 20/20 | 1171 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-effect-reproposed.kill | 20/20 | 1280 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-safe.close | 20/20 | 1098 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-safe.kill | 20/20 | 1312 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
