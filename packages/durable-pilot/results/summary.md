# Crash-matrix evidence summary

Generated 2026-11-18T02:19:24.999Z at commit 9179ad4; Node v26.13.1, SQLite 3.54.1, pi-durable 1.5.2.
Each row is one fault window and shutdown mode (kill = SIGKILL of the host process, close = graceful Harness close;
upgrade.* = PI WEB's Upgrade now against the Chat host: ordered close with reason upgrade, new host resumed at once).
Per-iteration evidence is in `evidence/<row>.jsonl`; the sample column is from the first passing iteration.

| Window / mode | Passed | Mean ms | Sample evidence |
| --- | --- | --- | --- |
| child.after-delivery.close | 20/20 | 1359 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-delivery.kill | 20/20 | 1251 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-result.close | 20/20 | 1117 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.after-result.kill | 20/20 | 2978 | requests 5; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-admission.close | 20/20 | 1145 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-admission.kill | 20/20 | 1004 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-delivery.close | 20/20 | 1433 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.before-delivery.kill | 20/20 | 1235 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-leaf.close | 20/20 | 1354 | requests 6; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-leaf.kill | 20/20 | 1328 | requests 6; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-parent.close | 20/20 | 1156 | requests 3; integrity ok; reporter 22:aborted; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-parent.kill | 20/20 | 1145 | requests 3; integrity ok; reporter 22:aborted; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-worker.close | 20/20 | 1206 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.cancel-worker.kill | 20/20 | 1175 | requests 4; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.worker-leaf.close | 20/20 | 1308 | requests 7; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| child.worker-leaf.kill | 20/20 | 3349 | requests 7; integrity ok; reporter 22:completed; owner epoch 2; sync 2 fullfsync 1 |
| generation.after-partial.close | 20/20 | 980 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.after-partial.kill | 20/20 | 3012 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.before-partial.close | 20/20 | 860 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.before-partial.kill | 20/20 | 2799 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.deferred.close | 20/20 | 932 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| generation.deferred.kill | 20/20 | 907 | requests 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.competing-owner | 20/20 | - | integrity ok |
| ownership.concurrent-refresh-control | 1/1 | - |  |
| ownership.concurrent-refresh | 20/20 | - |  |
| ownership.crash-loop-parking | 20/20 | - | integrity ok |
| ownership.default-pragmas | 1/1 | - |  |
| ownership.disk-full.close | 20/20 | 8797 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.disk-full.kill | 20/20 | 8267 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| ownership.store-files | 1/1 | - |  |
| question.after-commit.close | 20/20 | 1252 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.after-commit.kill | 20/20 | 1129 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.answer-undelivered.close | 20/20 | 1153 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.answer-undelivered.kill | 20/20 | 1103 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.attention-race.close | 20/20 | 907 | requests 0; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.attention-race.kill | 20/20 | 888 | requests 0; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.before-commit.close | 20/20 | 1306 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.before-commit.kill | 20/20 | 1252 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.delivered-unacked.close | 20/20 | 1186 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| question.delivered-unacked.kill | 20/20 | 1136 | requests 3; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.after-commit.close | 20/20 | 679 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.after-commit.kill | 20/20 | 705 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.changed-payload.close | 20/20 | 827 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.changed-payload.kill | 20/20 | 731 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-readmitted.close | 20/20 | 1520 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-readmitted.kill | 20/20 | 1599 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-receipt.close | 20/20 | 1357 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-receipt.kill | 20/20 | 1339 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-withdrawn.close | 20/20 | 1391 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.edit-withdrawn.kill | 20/20 | 1223 | requests 5; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.failed-run.close | 20/20 | 1127 | requests 4; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.failed-run.kill | 20/20 | 2957 | requests 4; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.mid-commit.close | 20/20 | 750 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.mid-commit.kill | 20/20 | 653 | requests 1; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.order.close | 20/20 | 1436 | requests 4; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| queue.order.kill | 20/20 | 1225 | requests 4; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| schema.task-doc-failed.close | 20/20 | 718 | integrity ok |
| schema.task-doc-failed.kill | 20/20 | 660 | integrity ok |
| schema.task-doc-missing.close | 20/20 | 719 | integrity ok |
| schema.task-doc-missing.kill | 20/20 | 684 | integrity ok |
| schema.task-doc-upgrade.close | 20/20 | 697 | integrity ok |
| schema.task-doc-upgrade.kill | 20/20 | 592 | integrity ok |
| schema.upgrade-rollback | 20/20 | - | integrity ok/ok |
| tools.safe-safe.close | 20/20 | 1104 | requests 2; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-safe.kill | 20/20 | 1142 | requests 2; effects 2; integrity ok; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-unsafe.close | 20/20 | 1129 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.safe-unsafe.kill | 20/20 | 938 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-effect-reproposed.close | 20/20 | 1099 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-effect-reproposed.kill | 20/20 | 1143 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-safe.close | 20/20 | 1032 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| tools.unsafe-safe.kill | 20/20 | 1133 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2; sync 2 fullfsync 1 |
| upgrade.ask-user | 20/20 | 4515 | integrity ok |
| upgrade.atelier | 20/20 | 13725 | integrity ok |
| upgrade.background-bash | 20/20 | 5294 | integrity ok |
| upgrade.children | 20/20 | 10332 | integrity ok |
| upgrade.generation | 20/20 | 4066 | requests 2; integrity ok |
| upgrade.queue | 20/20 | 4803 | integrity ok |
| upgrade.safe-tool | 20/20 | 4329 | integrity ok |
| upgrade.unsafe-tool | 20/20 | 4002 | integrity ok |
