# E → D: measured performance results

**Status: delivered and accepted for D's current integration scope on 2026-10-20.** E supplied the measured EVM baseline/batch evidence in [PR #6](https://github.com/dougan21/sc6109-project/pull/6), head `25a2410`, produced by benchmark code `ce13b8b`. D independently checked both comparisons (24 runs, 2,400 intents, 834 archived execution receipts) and added them to the Performance page. No additional E data or backend endpoint is required for this integration.

The recorded comparisons are `benchmarks/results/bs-steady10-n100-20261019/summary.json` and `benchmarks/results/bs-burst-n100-20261019/summary.json`. D's reproducible acceptance check is `npm run check:experiments`; scope and limits are in [VERIFICATION.md](VERIFICATION.md). The following contract remains available for future measured comparisons.

## Deliverables

1. A summary JSON under 2 MB matching [`public/integration/benchmark.schema.json`](public/integration/benchmark.schema.json). Include both a baseline (`batchSize=1`, `maxWaitMs=0`) and the tested batch configuration(s). Give each measured run a unique `runId` and its `repetition` number. Use the same source commit, chain, workload/initial-state recipe and measurement-window kind across a comparison.
2. Inspectable raw results and the commands/configuration needed to reproduce them. Each summary row's `rawResults` points to those repository files or source references. Existing intent/batch API records, transaction receipts, timestamps and environment/configuration records can provide the evidence; a new results API is unnecessary.

Both delivered comparisons are bundled into the Performance page and selected with its Workload control. Additional summaries can still use the file input or JSON paste. Imported files are labeled as author-declared and do not inherit D's independent review of the bundled sources.

## Fields and metric definitions

Each run includes `runId`, `mode: "evm"`, `variant`, `repetition`, `commit`, `chainId`, `batchSize`, `maxWaitMs`, `workload`, `sampleCount`, `unfinished`, `window`, the metrics below, and `rawResults`.

| Field                            | Required meaning                                                                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `window.startMs`, `window.endMs` | Recorded start/end in Unix milliseconds, with end greater than start.                                                                                                                                                                     |
| `window.kind`                    | `fixed-window` or `workload-drain`; use the same kind in one comparison.                                                                                                                                                                  |
| `throughput`                     | Unique confirmed intents / recorded measurement seconds, in intents/second.                                                                                                                                                               |
| `latencyP50Ms`, `latencyP95Ms`   | End-to-end `confirmedAt - receivedAt` for unique successful intents, in milliseconds. Retain raw timestamps and the percentile method.                                                                                                    |
| `failureRate`                    | Terminal `FAILED`/`EXPIRED`/`REJECTED` intents with `attemptCount > 0` / intents with `attemptCount > 0`, between 0 and 1. Retain numerator and denominator; do not count API rejection or pending/unknown outcomes as execution failure. |
| `gasPerSuccessfulIntent`         | All execution receipt gas, including reverted receipts, / unique successful intents, as a decimal string. Exclude deployment, approval and authorization setup.                                                                           |
| `sampleCount`                    | Number of unique successful latency samples.                                                                                                                                                                                              |
| `unfinished`                     | Accepted intents with a nonterminal or unknown outcome at the recorded end; retain separately from failures.                                                                                                                              |

Raw evidence must make the success, attempted, failed and unfinished counts, receipt gas, time window and run configuration inspectable. When there are no successes, use throughput `0`, `sampleCount=0`, and `null` for both latency fields and gas per success. The UI retains this outcome as N/A rather than inventing a zero success cost.

The 12-intent D demonstration is functional evidence. Live `/metrics` snapshots have a growing cumulative observation window. Existing `evidence/gas.csv` covers only the archived contract gas comparison. None of these alone supplies the four-metric controlled comparison requested above.
