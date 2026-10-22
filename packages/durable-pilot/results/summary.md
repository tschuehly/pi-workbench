# Crash-matrix evidence summary

Generated 2026-10-22T13:33:54.768Z at commit 55bb26a; Node v26.7.0, SQLite 3.53.4, pi-durable 1.4.0.
Each row is one fault window and shutdown mode (kill = SIGKILL of the host process, close = graceful Harness close).
Per-iteration evidence is in `evidence/<row>.jsonl`; the sample column is from the first passing iteration.

| Window / mode | Passed | Mean ms | Sample evidence |
| --- | --- | --- | --- |
| child.after-delivery.close | 20/20 | 1222 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-delivery.kill | 20/20 | 1302 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-result.close | 20/20 | 1288 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-result.kill | 20/20 | 1179 | requests 5; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-admission.close | 20/20 | 1116 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-admission.kill | 20/20 | 1065 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-delivery.close | 20/20 | 1232 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-delivery.kill | 20/20 | 1166 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-leaf.close | 20/20 | 1486 | requests 6; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-leaf.kill | 20/20 | 1376 | requests 6; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-parent.close | 20/20 | 1392 | requests 2; integrity ok; reporter 22:aborted; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-parent.kill | 20/20 | 1069 | requests 2; integrity ok; reporter 22:aborted; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-worker.close | 20/20 | 1409 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-worker.kill | 20/20 | 1441 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.worker-leaf.close | 20/20 | 1617 | requests 7; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.worker-leaf.kill | 20/20 | 1520 | requests 7; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| generation.after-partial.close | 20/20 | 1055 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.after-partial.kill | 20/20 | 1015 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.before-partial.close | 20/20 | 860 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.before-partial.kill | 20/20 | 623 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.deferred.close | 20/20 | 996 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.deferred.kill | 20/20 | 1011 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.competing-owner | 20/20 | - | integrity ok |
| ownership.concurrent-refresh-control | 1/1 | - |  |
| ownership.concurrent-refresh | 20/20 | - |  |
| ownership.crash-loop-parking | 20/20 | - | integrity ok |
| ownership.default-pragmas | 1/1 | - |  |
| ownership.disk-full.close | 20/20 | 8404 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.disk-full.kill | 20/20 | 7453 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.store-files | 1/1 | - |  |
| question.after-commit.close | 20/20 | 1241 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.after-commit.kill | 20/20 | 1156 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.answer-undelivered.close | 20/20 | 1073 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.answer-undelivered.kill | 20/20 | 1067 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.attention-race.close | 20/20 | 894 | requests 0; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.attention-race.kill | 20/20 | 896 | requests 0; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.before-commit.close | 20/20 | 1214 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.before-commit.kill | 20/20 | 1109 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.delivered-unacked.close | 20/20 | 1291 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.delivered-unacked.kill | 20/20 | 1156 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.after-commit.close | 20/20 | 962 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.after-commit.kill | 20/20 | 1021 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.changed-payload.close | 20/20 | 1011 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.changed-payload.kill | 20/20 | 901 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-readmitted.close | 20/20 | 1535 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-readmitted.kill | 20/20 | 1480 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-receipt.close | 20/20 | 1691 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-receipt.kill | 20/20 | 1409 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-withdrawn.close | 20/20 | 1395 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-withdrawn.kill | 20/20 | 1375 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.failed-run.close | 20/20 | 1071 | requests 4; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.failed-run.kill | 20/20 | 993 | requests 4; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.mid-commit.close | 20/20 | 941 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.mid-commit.kill | 20/20 | 845 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.order.close | 20/20 | 1427 | requests 4; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.order.kill | 20/20 | 1352 | requests 4; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| schema.task-doc-failed.close | 20/20 | 1060 | integrity ok |
| schema.task-doc-failed.kill | 20/20 | 965 | integrity ok |
| schema.task-doc-missing.close | 20/20 | 850 | integrity ok |
| schema.task-doc-missing.kill | 20/20 | 840 | integrity ok |
| schema.task-doc-upgrade.close | 20/20 | 1078 | integrity ok |
| schema.task-doc-upgrade.kill | 20/20 | 782 | integrity ok |
| schema.upgrade-rollback | 20/20 | - | integrity ok/ok |
| tools.safe-safe.close | 20/20 | 1220 | requests 2; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-safe.kill | 20/20 | 1229 | requests 2; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-unsafe.close | 20/20 | 1298 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-unsafe.kill | 20/20 | 1057 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-effect-reproposed.close | 20/20 | 1164 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-effect-reproposed.kill | 20/20 | 1549 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-safe.close | 20/20 | 1123 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-safe.kill | 20/20 | 1157 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
