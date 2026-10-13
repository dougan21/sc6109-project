# E → D: measured performance results

The frontend and scheduled-agent demo are implemented. The remaining input needed for the complete performance comparison is **measured EVM baseline/batch evidence and its JSON summary**. No new backend endpoint or UI work is required from E.

## Deliverables

1. A summary JSON under 2 MB matching [`public/integration/benchmark.schema.json`](public/integration/benchmark.schema.json). Include both a baseline (`batchSize=1`, `maxWaitMs=0`) and the tested batch configuration(s). Give each measured run a unique `runId` and its `repetition` number. Use the same source commit, chain, workload/initial-state recipe and measurement-window kind across a comparison.
2. Inspectable raw results and the commands/configuration needed to reproduce them. Each summary row's `rawResults` points to those repository files or source references. Existing intent/batch API records, transaction receipts, timestamps and environment/configuration records can provide the evidence; a new results API is unnecessary.

Use the existing Performance page's file input or JSON paste to import the summary. An absent summary remains explicitly marked “No comparison data”.

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
