# Crash-matrix evidence summary

Generated 2026-10-22T13:15:18.178Z at commit b1773c1; Node v26.7.0, SQLite 3.53.4, pi-durable 1.4.0.
Each row is one fault window and shutdown mode (kill = SIGKILL of the host process, close = graceful Harness close).
Per-iteration evidence is in `evidence/<row>.jsonl`; the sample column is from the first passing iteration.

| Window / mode | Passed | Mean ms | Sample evidence |
| --- | --- | --- | --- |
| child.after-delivery.close | 20/20 | 1789 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-delivery.kill | 20/20 | 1452 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-result.close | 20/20 | 2011 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-result.kill | 20/20 | 1566 | requests 5; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-admission.close | 20/20 | 1621 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-admission.kill | 20/20 | 1625 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-delivery.close | 20/20 | 1870 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-delivery.kill | 20/20 | 1710 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-leaf.close | 20/20 | 1781 | requests 6; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-leaf.kill | 20/20 | 1925 | requests 6; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-parent.close | 20/20 | 1565 | requests 2; integrity ok; reporter 22:aborted; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-parent.kill | 20/20 | 1761 | requests 2; integrity ok; reporter 22:aborted; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-worker.close | 20/20 | 1810 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-worker.kill | 20/20 | 1606 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.worker-leaf.close | 20/20 | 1724 | requests 7; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.worker-leaf.kill | 20/20 | 1764 | requests 7; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| generation.after-partial.close | 20/20 | 1149 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.after-partial.kill | 20/20 | 1172 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.before-partial.close | 20/20 | 1165 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.before-partial.kill | 20/20 | 1071 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.deferred.close | 20/20 | 1167 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.deferred.kill | 20/20 | 1173 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.competing-owner | 20/20 | - | integrity ok |
| ownership.crash-loop-parking | 20/20 | - | integrity ok |
| ownership.default-pragmas | 1/1 | - |  |
| ownership.disk-full.close | 20/20 | 9409 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.disk-full.kill | 20/20 | 7544 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.store-files | 1/1 | - |  |
| question.after-commit.close | 20/20 | 1206 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.after-commit.kill | 20/20 | 1145 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.answer-undelivered.close | 20/20 | 1181 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.answer-undelivered.kill | 20/20 | 1247 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.attention-race.close | 20/20 | 1130 | requests 0; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.attention-race.kill | 20/20 | 957 | requests 0; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.before-commit.close | 20/20 | 1225 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.before-commit.kill | 20/20 | 1237 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.delivered-unacked.close | 20/20 | 1404 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.delivered-unacked.kill | 20/20 | 1160 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.after-commit.close | 20/20 | 1097 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.after-commit.kill | 20/20 | 1044 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.changed-payload.close | 20/20 | 1005 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.changed-payload.kill | 20/20 | 1287 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.failed-run.close | 20/20 | 1113 | requests 4; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.failed-run.kill | 20/20 | 1033 | requests 4; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.mid-commit.close | 20/20 | 1091 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.mid-commit.kill | 20/20 | 1062 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.order.close | 20/20 | 1647 | requests 4; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.order.kill | 20/20 | 1434 | requests 4; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| schema.task-doc-failed.close | 20/20 | 978 | integrity ok |
| schema.task-doc-failed.kill | 20/20 | 1081 | integrity ok |
| schema.task-doc-missing.close | 20/20 | 1403 | integrity ok |
| schema.task-doc-missing.kill | 20/20 | 1374 | integrity ok |
| schema.task-doc-upgrade.close | 20/20 | 1035 | integrity ok |
| schema.task-doc-upgrade.kill | 20/20 | 1041 | integrity ok |
| schema.upgrade-rollback | 20/20 | - | integrity ok/ok |
| tools.safe-safe.close | 20/20 | 1104 | requests 2; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-safe.kill | 20/20 | 1256 | requests 2; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-unsafe.close | 20/20 | 1157 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-unsafe.kill | 20/20 | 1263 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-effect-reproposed.close | 20/20 | 1259 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-effect-reproposed.kill | 20/20 | 1405 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-safe.close | 20/20 | 1219 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-safe.kill | 20/20 | 1194 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
