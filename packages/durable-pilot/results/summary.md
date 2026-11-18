# Crash-matrix evidence summary

Generated 2026-11-18T03:44:44.864Z at commit 47b553f; Node v26.13.1, SQLite 3.54.1, pi-durable 1.5.2.
Each row is one fault window and shutdown mode (kill = SIGKILL of the host process, close = graceful Harness close;
upgrade.* = PI WEB's Upgrade now against the Chat host: ordered close with reason upgrade, new host resumed at once).
Per-iteration evidence is in `evidence/<row>.jsonl`; the sample column is from the first passing iteration.

| Window / mode | Passed | Mean ms | Sample evidence |
| --- | --- | --- | --- |
| child.after-delivery.close | 20/20 | 1305 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-delivery.kill | 20/20 | 1505 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-result.close | 20/20 | 1653 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-result.kill | 20/20 | 3071 | requests 5; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-admission.close | 20/20 | 1415 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-admission.kill | 20/20 | 1448 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-delivery.close | 20/20 | 1618 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-delivery.kill | 20/20 | 1666 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-leaf.close | 20/20 | 1691 | requests 6; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-leaf.kill | 20/20 | 1497 | requests 6; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-parent.close | 20/20 | 1218 | requests 3; integrity ok; reporter 22:aborted; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-parent.kill | 20/20 | 1287 | requests 3; integrity ok; reporter 22:aborted; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-worker.close | 20/20 | 1475 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-worker.kill | 20/20 | 1412 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.worker-leaf.close | 20/20 | 1626 | requests 7; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.worker-leaf.kill | 20/20 | 3260 | requests 7; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| generation.after-partial.close | 20/20 | 1172 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.after-partial.kill | 20/20 | 3239 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.before-partial.close | 20/20 | 1103 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.before-partial.kill | 20/20 | 3004 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.deferred.close | 20/20 | 1023 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.deferred.kill | 20/20 | 1054 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.competing-owner | 20/20 | - | integrity ok |
| ownership.concurrent-refresh-control | 1/1 | - |  |
| ownership.concurrent-refresh | 20/20 | - |  |
| ownership.crash-loop-parking | 20/20 | - | integrity ok |
| ownership.default-pragmas | 1/1 | - |  |
| ownership.disk-full.close | 20/20 | 9582 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.disk-full.kill | 20/20 | 10204 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.store-files | 1/1 | - |  |
| question.after-commit.close | 20/20 | 1408 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.after-commit.kill | 20/20 | 1178 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.answer-undelivered.close | 20/20 | 1501 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.answer-undelivered.kill | 20/20 | 1293 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.attention-race.close | 20/20 | 998 | requests 0; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.attention-race.kill | 20/20 | 949 | requests 0; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.before-commit.close | 20/20 | 1172 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.before-commit.kill | 20/20 | 1188 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.delivered-unacked.close | 20/20 | 1350 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.delivered-unacked.kill | 20/20 | 1276 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.after-commit.close | 20/20 | 885 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.after-commit.kill | 20/20 | 835 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.changed-payload.close | 20/20 | 890 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.changed-payload.kill | 20/20 | 873 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-readmitted.close | 20/20 | 1840 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-readmitted.kill | 20/20 | 1486 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-receipt.close | 20/20 | 1541 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-receipt.kill | 20/20 | 1523 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-withdrawn.close | 20/20 | 1617 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-withdrawn.kill | 20/20 | 1554 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.failed-run.close | 20/20 | 1194 | requests 4; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.failed-run.kill | 20/20 | 3104 | requests 4; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.mid-commit.close | 20/20 | 843 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.mid-commit.kill | 20/20 | 830 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.order.close | 20/20 | 1770 | requests 4; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.order.kill | 20/20 | 1400 | requests 4; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| schema.task-doc-failed.close | 20/20 | 739 | integrity ok |
| schema.task-doc-failed.kill | 20/20 | 765 | integrity ok |
| schema.task-doc-missing.close | 20/20 | 714 | integrity ok |
| schema.task-doc-missing.kill | 20/20 | 679 | integrity ok |
| schema.task-doc-upgrade.close | 20/20 | 753 | integrity ok |
| schema.task-doc-upgrade.kill | 20/20 | 638 | integrity ok |
| schema.upgrade-rollback | 20/20 | - | integrity ok/ok |
| tools.safe-safe.close | 20/20 | 1248 | requests 2; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-safe.kill | 20/20 | 1328 | requests 2; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-unsafe.close | 20/20 | 1210 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-unsafe.kill | 20/20 | 1177 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-effect-reproposed.close | 20/20 | 1370 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-effect-reproposed.kill | 20/20 | 1365 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-safe.close | 20/20 | 1170 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-safe.kill | 20/20 | 1212 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| upgrade.ask-user | 20/20 | 3703 | integrity ok |
| upgrade.atelier | 20/20 | 13894 | integrity ok |
| upgrade.background-bash | 20/20 | 4716 | integrity ok |
| upgrade.children | 20/20 | 9122 | integrity ok |
| upgrade.generation | 20/20 | 4274 | requests 2; integrity ok |
| upgrade.queue | 20/20 | 4151 | integrity ok |
| upgrade.safe-tool | 20/20 | 4525 | integrity ok |
| upgrade.unsafe-tool | 20/20 | 4085 | integrity ok |
