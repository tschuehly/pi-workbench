# Crash-matrix evidence summary

Generated 2026-10-22T12:37:26.001Z at commit b9eaa2b; Node v26.7.0, SQLite 3.53.4, pi-durable 1.4.0.
Each row is one fault window and shutdown mode (kill = SIGKILL of the host process, close = graceful Harness close).
Per-iteration evidence is in `evidence/<row>.jsonl`; the sample column is from the first passing iteration.

| Window / mode | Passed | Mean ms | Sample evidence |
| --- | --- | --- | --- |
| child.after-delivery.close | 20/20 | 462 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.after-delivery.kill | 20/20 | 464 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.after-result.close | 20/20 | 519 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.after-result.kill | 20/20 | 497 | requests 5; integrity ok; reporter 22:completed; owner epoch 2 |
| child.before-admission.close | 20/20 | 486 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.before-admission.kill | 20/20 | 515 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.before-delivery.close | 20/20 | 481 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.before-delivery.kill | 20/20 | 469 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.cancel-leaf.close | 20/20 | 473 | requests 6; integrity ok; reporter 22:completed; owner epoch 2 |
| child.cancel-leaf.kill | 20/20 | 486 | requests 6; integrity ok; reporter 22:completed; owner epoch 2 |
| child.cancel-parent.close | 20/20 | 455 | requests 2; integrity ok; reporter 22:aborted; owner epoch 2 |
| child.cancel-parent.kill | 20/20 | 455 | requests 2; integrity ok; reporter 22:aborted; owner epoch 2 |
| child.cancel-worker.close | 20/20 | 470 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.cancel-worker.kill | 20/20 | 465 | requests 4; integrity ok; reporter 22:completed; owner epoch 2 |
| child.worker-leaf.close | 20/20 | 482 | requests 7; integrity ok; reporter 22:completed; owner epoch 2 |
| child.worker-leaf.kill | 20/20 | 481 | requests 7; integrity ok; reporter 22:completed; owner epoch 2 |
| generation.after-partial.close | 20/20 | 548 | requests 2; integrity ok; owner epoch 2 |
| generation.after-partial.kill | 20/20 | 554 | requests 2; integrity ok; owner epoch 2 |
| generation.before-partial.close | 20/20 | 451 | requests 2; integrity ok; owner epoch 2 |
| generation.before-partial.kill | 20/20 | 465 | requests 2; integrity ok; owner epoch 2 |
| generation.deferred.close | 20/20 | 439 | requests 2; integrity ok; owner epoch 2 |
| generation.deferred.kill | 20/20 | 435 | requests 2; integrity ok; owner epoch 2 |
| ownership.competing-owner | 20/20 | - | integrity ok |
| ownership.crash-loop-parking | 20/20 | - | integrity ok |
| ownership.disk-full.close | 20/20 | 5032 | requests 3; integrity ok; owner epoch 2 |
| ownership.disk-full.kill | 20/20 | 4912 | requests 3; integrity ok; owner epoch 2 |
| question.after-commit.close | 20/20 | 467 | requests 3; integrity ok; owner epoch 2 |
| question.after-commit.kill | 20/20 | 452 | requests 3; integrity ok; owner epoch 2 |
| question.answer-undelivered.close | 20/20 | 470 | requests 3; integrity ok; owner epoch 2 |
| question.answer-undelivered.kill | 20/20 | 451 | requests 3; integrity ok; owner epoch 2 |
| question.attention-race.close | 20/20 | 459 | requests 0; integrity ok; owner epoch 2 |
| question.attention-race.kill | 20/20 | 433 | requests 0; integrity ok; owner epoch 2 |
| question.before-commit.close | 20/20 | 457 | requests 3; integrity ok; owner epoch 2 |
| question.before-commit.kill | 20/20 | 491 | requests 3; integrity ok; owner epoch 2 |
| question.delivered-unacked.close | 20/20 | 453 | requests 3; integrity ok; owner epoch 2 |
| question.delivered-unacked.kill | 20/20 | 448 | requests 3; integrity ok; owner epoch 2 |
| queue.after-commit.close | 20/20 | 431 | requests 1; integrity ok; owner epoch 2 |
| queue.after-commit.kill | 20/20 | 439 | requests 1; integrity ok; owner epoch 2 |
| queue.changed-payload.close | 20/20 | 438 | requests 1; integrity ok; owner epoch 2 |
| queue.changed-payload.kill | 20/20 | 431 | requests 1; integrity ok; owner epoch 2 |
| queue.failed-run.close | 20/20 | 453 | requests 4; integrity ok; owner epoch 2 |
| queue.failed-run.kill | 20/20 | 470 | requests 4; integrity ok; owner epoch 2 |
| queue.mid-commit.close | 20/20 | 431 | requests 1; integrity ok; owner epoch 2 |
| queue.mid-commit.kill | 20/20 | 459 | requests 1; integrity ok; owner epoch 2 |
| queue.order.close | 20/20 | 586 | requests 4; effects 2; integrity ok; owner epoch 2 |
| queue.order.kill | 20/20 | 572 | requests 4; effects 2; integrity ok; owner epoch 2 |
| schema.task-doc-failed.close | 20/20 | 638 | integrity ok |
| schema.task-doc-failed.kill | 20/20 | 684 | integrity ok |
| schema.task-doc-missing.close | 20/20 | 609 | integrity ok |
| schema.task-doc-missing.kill | 20/20 | 649 | integrity ok |
| schema.task-doc-upgrade.close | 20/20 | 550 | integrity ok |
| schema.task-doc-upgrade.kill | 20/20 | 430 | integrity ok |
| schema.upgrade-rollback | 20/20 | - | integrity ok/ok |
| tools.safe-safe.close | 20/20 | 671 | requests 2; effects 2; integrity ok; owner epoch 2 |
| tools.safe-safe.kill | 20/20 | 656 | requests 2; effects 2; integrity ok; owner epoch 2 |
| tools.safe-unsafe.close | 20/20 | 551 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
| tools.safe-unsafe.kill | 20/20 | 598 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
| tools.unsafe-effect-reproposed.close | 20/20 | 612 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
| tools.unsafe-effect-reproposed.kill | 20/20 | 559 | requests 3; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
| tools.unsafe-safe.close | 20/20 | 609 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
| tools.unsafe-safe.kill | 20/20 | 550 | requests 2; effects 1; integrity ok; uncertain task 13; owner epoch 2 |
