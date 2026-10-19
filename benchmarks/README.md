# Member E: controlled baseline/batch experiments

Measured EVM comparison of single-intent submission (baseline) against batching, covering the
four RQ5 metric categories: throughput, latency, failure rate and gas. Results are raw relayer
records plus independent chain reconciliation, summarized into the JSON that D's Performance
page imports ([`benchmark.schema.json`](../apps/web/public/integration/benchmark.schema.json)).

## Run

After the root setup (`npm ci`, `npm run build`):

```sh
npm run test:bench                      # metric-calculation unit tests
npm run bench                           # batch sizes 1,5,10,20 × 3 repetitions, steady 10/s, 100 intents
npm run bench -- --arrival burst        # same, all 100 intents submitted at once
npm run bench:summarize -- benchmarks/results/<comparisonId>   # recompute summaries from raw files
```

Options: `--sizes 1,5,10,20 --reps 3 --intents 100 --owners 10 --arrival steady|burst --rate 10
--block-time 1 --max-wait 0 --poll-ms 250 --comparison <id> --out benchmarks/results
--rpc-port 18645 --api-port 13145`. The runner refuses busy ports and never touches an existing
chain or relayer. A full steady comparison takes about 13 minutes, mostly the baseline.

Import `benchmarks/results/<comparisonId>/summary.json` on the Performance page (file input or
paste). The summarizer validates it with D's own `parseBenchmark` before writing it.

## What each run does

1. Starts a **fresh Anvil** (chain 31337, Cancun, public test mnemonic) and deploys a fresh
   executor and token. Addresses and initial state are therefore identical in every run.
2. Setup with automine (excluded from all metrics): for each of N owners, mint
   `1 + ceil(intents/N)` TEST, approve exactly that allowance, and `configureAgent` with a
   dedicated agent, a dedicated recipient, 1 TEST per intent, that budget, and a 2-hour expiry.
3. Pre-signs every intent with C's SDK (`signIntent`) **before** measurement: intent *k* belongs to
   owner `k mod N` with nonce `1 + floor(k/N)`; a shared validity window of one hour.
4. Switches the chain to **fixed-interval mining** (`--block-time`, default 1 s).
5. Starts B's relayer in EVM mode with a fresh SQLite database and an explicit environment.
   Only `BATCH_SIZE` (and `MAX_WAIT_MS` if given) differs between runs; all retry, gas and
   polling limits are the relayer defaults and are recorded.
6. Warm-up: one intent per owner (nonce 0) under the separate run label `<runId>-w`, waited to
   confirmation. This touches every owner/recipient once so cold-storage costs do not land in
   only the first measured batch. Warm-up gas and timing are recorded but excluded.
7. Measurement: submits the intents through `POST /intents` on a monotonic schedule
   (`steady`: one every `1000/rate` ms; `burst`: all at once) and waits until every accepted
   intent is terminal, or a timeout (`60 s + 3 s × intents`).
8. Collects every intent with its state history, every batch with its receipt, and the relayer's
   own `/metrics` snapshot; then reconciles independently against the chain (see below).
9. Stops the relayer and chain. Repetitions alternate configuration order (1→20, then 20→1, …).

### Chain reconciliation (per run, must all pass)

- every relayer receipt matches the chain receipt (status and `gasUsed`);
- the set of `IntentExecuted` IDs in successful receipts equals the set of `CONFIRMED` intents;
- per owner, owner + recipient balances equal the initial mint, and the recipient received
  exactly one TEST per confirmed intent (including warm-up);
- on-chain `spent` equals the confirmed amount;
- `consumed(owner, agent, epoch, nonce)` is true exactly for confirmed intents.

A run that fails any check is written to disk and then aborts the experiment.

## Metric definitions

Implemented in [`metrics.ts`](metrics.ts) and unit-tested in [`test/metrics.test.ts`](test/metrics.test.ts).
All timestamps are the relayer's own durable records (one host clock, Unix ms).

| Metric | Definition |
| --- | --- |
| Window (`workload-drain`) | First durable receipt (`receivedAt`) of a measured intent → last terminal state of one. If the drain times out, it ends at the observation time and `unfinished > 0`. |
| Throughput | Unique `CONFIRMED` intents / window seconds. |
| End-to-end latency | `confirmedAt − receivedAt`, successful intents only; p50/p95 by nearest rank (`ceil(p·n)−1`), the relayer's method. |
| Queue latency | `submittedAt − receivedAt` (first broadcast intention), all attempted intents. In `metrics.json`. |
| Failure rate | Terminal `FAILED`/`EXPIRED`/`REJECTED` with `attemptCount > 0` / intents with `attemptCount > 0`. API rejections and preflight rejections before any attempt are counted separately; unfinished is never a failure. |
| Gas per successful intent | Sum of `gasUsed` over **all** execution receipts of the run, reverted ones included / unique confirmed intents. Exact decimal (4 places, half-up). Setup and warm-up excluded. `null` when nothing succeeded. |
| Execution fees | Σ `gasUsed × effectiveGasPrice` in wei; test-chain value, not a currency cost. |
| Aggregation ratio | Confirmed intents / distinct broadcast transactions. |

## Output layout

```text
benchmarks/results/<comparisonId>/
  summary.json      D-importable comparison (schema v1)
  summary.csv       one row per run, with numerators/denominators
  aggregate.md      mean ± sample standard deviation per configuration
  <runId>/
    run.json        configuration, workload, environment, accounts, setup and warm-up receipts,
                    every client submission (send/response time, status), chain checks
    intents.json    relayer intent records + full state history (no signatures)
    batches.json    relayer batch/transaction records + receipts (no raw signed bytes)
    chain.json      independent chain receipts, block timestamps, event IDs, final balances
    relayer-metrics.json   relayer /metrics snapshot (cumulative; reference only)
    metrics.json    the derived metrics above
```

Relayer logs and SQLite databases stay in the ignored `data/bench/<runId>/`.

## Results: batch size 1/5/10/20 (2026-10-19)

Two comparisons, each 4 configurations × 3 repetitions × 100 measured intents, 10 independent
owners, 1 s blocks, `MAX_WAIT_MS=0`. All 24 runs drained with 0 unfinished, 0 failures, and passed
every chain reconciliation check. Full per-run values: each directory's `summary.csv`;
mean ± sample standard deviation: `aggregate.md`. Machine: Apple M3, macOS (Darwin 27.0.0),
Node 22.23.1, Anvil 1.7.1. Benchmark code commit `ce13b8b`, clean working tree.

**Steady arrivals, 10 intents/s** — [`results/bs-steady10-n100-20261019`](results/bs-steady10-n100-20261019/aggregate.md)

| Batch size | Throughput (intents/s) | E2E p50 (ms) | E2E p95 (ms) | Gas / successful intent | vs baseline | Transactions |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.004 ± 0.000 | 44,792 ± 26 | 85,215 ± 26 | 103,412.1 | — | 100 |
| 5 | 4.826 ± 0.032 | 5,669 ± 13 | 10,121 ± 136 | 81,862.4 | −20.8% | 21 |
| 10 | 9.232 ± 0.033 | 1,261 ± 13 | 1,732 ± 30 | 79,142.0 | −23.5% | 11 |
| 20 | 9.267 ± 0.003 | 1,256 ± 0 | 1,709 ± 32 | 78,809.2 | −23.8% | 11 |

**Burst, all 100 submitted at once** — [`results/bs-burst-n100-20261019`](results/bs-burst-n100-20261019/aggregate.md)

| Batch size | Throughput (intents/s) | E2E p50 (ms) | E2E p95 (ms) | Gas / successful intent | vs baseline | Transactions |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.004 ± 0.000 | 49,605 ± 57 | 94,496 ± 176 | 103,408.6 | — | 100 |
| 5 | 5.072 ± 0.062 | 9,647 ± 208 | 18,530 ± 236 | 81,147.1 | −21.5% | 20 |
| 10 | 10.187 ± 0.088 | 4,702 ± 87 | 9,626 ± 72 | 77,541.3 | −25.0% | 10 |
| 20 | 21.032 ± 0.064 | 2,638 ± 10 | 4,589 ± 15 | 60,906.3 | −41.1% | 5 |

### Interpretation (observations, with the mechanism we believe explains them)

- **H1 gas — supported, but smaller than the contract-only review.** Savings are 21–25% at batch
  sizes 5–10, and 41% only at 20 under burst. A's `evidence/gas.csv` shows 54% at size 20 because
  all 20 transfers there share one owner, agent and recipient. Here intents are round-robin over
  10 independent owners/recipients: a batch of 10 has one intent per owner, so only the
  transaction base cost and executor/token access are shared; each owner's balance, allowance,
  policy and recipient slots are still touched cold. A burst batch of 20 holds two intents per owner,
  which is where the extra saving comes from. Savings depend on how much state intents share.
- **H2 throughput — supported, bounded by two limits.** The relayer keeps one transaction pending
  and waits for its receipt, so baseline is capped at about one intent per 1 s block (1.00/s in every
  run). Batching raises the cap to roughly batch size per block. Under steady 10/s arrivals,
  sizes 10 and 20 are indistinguishable: about ten intents queue per block, so a cap of 20 never fills.
  This measures the configured system, not chain capacity.
- **Latency.** Both workloads exceed baseline capacity (10/s offered vs 1/s served), so baseline
  latency is queueing in the backlog: p50 ≈ 45–50 s. Batching removes the backlog; with steady
  arrivals at size ≥10, p50 is about 1.26 s (≈ one block plus polling). This is **not** a test of H3:
  the low-load cost of waiting for a fuller batch needs the `--max-wait` study at an arrival rate
  below baseline capacity.
- **Variance.** Repetitions agree closely; the largest spread is gas per intent at burst sizes
  5–10 (≤0.9%). Concurrent burst submissions arrive in a slightly different order each run, so
  the owner mix inside each batch, and therefore how much storage is shared, likely varies. With `MAX_WAIT_MS=0` a
  coordinator tick can also claim the first intents of a burst before the rest arrive: an earlier,
  uncommitted development run observed batches of 1, 20, 20, 20, 20, 19 at size 20. All three
  repetitions here formed 5 × 20. This sensitivity is a reason to study `--max-wait` explicitly.
- **H4 failure impact — not tested here.** The workload has 0% invalid intents; failure rate
  is 0 / 100 attempted in every run.

## Fairness and limits to state with the results

- Baseline and batch use the same contract entry point (`executeBatch`), signatures, policies,
  initial state, workload, relayer limits and block interval. Baseline is `BATCH_SIZE=1,
  MAX_WAIT_MS=0`. In the batch-size comparison `MAX_WAIT_MS=0` too, so a batch contains whatever
  is queued (up to the cap) when the previous transaction confirms; waiting-window effects are a
  separate study (`--max-wait`).
- The relayer allows **one pending transaction at a time** and waits for its receipt. Throughput
  therefore describes this configured end-to-end system under a 1 s block interval, not the
  chain's capacity. Baseline throughput is bounded near one intent per block.
- Local Anvil, one confirmation, one machine; no public-chain finality, congestion or fee market.
- The workload is valid transfers only (0% fault proportion). Independent owners and recipients;
  shared-budget and invalid-mix workloads are not part of this comparison.
- `commit` in the summary is `git describe --always --dirty`. A `-dirty` suffix means the
  benchmark code was not yet committed; `run.json` also records a SHA-256 of `benchmarks/*.ts`.
  Commit first and rerun for final submission evidence.
