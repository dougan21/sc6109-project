# Member E integration handoff

The controlled comparison requested in `apps/web/E_EXPERIMENT_HANDOFF.md` is in `benchmarks/`
on branch `feat/e-benchmarks`. Code commit `ce13b8b`; results commit `0a8946c`. Protocol and
metric definitions: decision D-012 and `benchmarks/README.md`.

## D: Performance page

Import one of these files with the Performance page's file input or paste:

- `benchmarks/results/bs-steady10-n100-20261019/summary.json`: steady arrivals at 10 intents/s
- `benchmarks/results/bs-burst-n100-20261019/summary.json`: 100 intents submitted at once

Each file has 12 measured EVM runs: batch sizes 1, 5, 10 and 20, three repetitions each, all
with `maxWaitMs=0`. `batchSize=1` is the baseline. The two files have different `workload`
strings, so they are separate comparisons, as the schema requires. Both passed your
`parseBenchmark` before they were written. I have not yet imported them in the running page.

Captions the page or slides should keep:

- Throughput is for this configured system: one pending relayer transaction, 1 s blocks, local
  Anvil. It is not chain capacity.
- The baseline is overloaded under both workloads, so its latency is mostly queueing. These
  runs do not test waiting-window latency at low load.
- The failure rate is 0 because the workload has only valid intents. It is not evidence about
  invalid-intent impact.
- Gas savings depend on shared state. The 54% in `evidence/gas.csv` is a single-owner contract
  review; these runs use ten independent owners.

Plan §9.1 names D as E's primary reviewer. Please check that the charts and captions match
`aggregate.md`, and that every chart traces to a `runId` and `rawResults` path.

## B: calculation review and relayer notes

Plan §9.1 also asks B to review E's calculations. The definitions are in `benchmarks/metrics.ts`
and its tests. Please confirm that these choices match your state semantics:

- `submittedAt` is read as the first broadcast intention and `confirmedAt` as the
  confirmation observation.
- A terminal time for a non-confirmed intent is taken from its last matching state event.
- Gas per success sums every batch receipt in the run, reverted ones included.

The runner starts the relayer as `node --import tsx services/relayer/src/main.ts`, with an
explicit environment and a fresh database. No relayer change was needed. Two lines in
`services/relayer/README.md` are now out of date; the decision to edit them is yours:

- "a runnable relayer-over-chain demo is still to do": D's `demo:evm` and `npm run bench` both
  run the relayer over a real chain.
- "not a completed baseline study": `GET /metrics` remains instrumentation, but a controlled
  comparison now exists in `benchmarks/`.

## A: gas results versus the archived review

In these runs, batching saves 21–25% at sizes 5–10 and 41% at size 20 under burst. The archived
review shows 54% at size 20. E's working explanation, not yet measured, is that ten independent
owners share less warm storage per batch than one owner does. A single-owner run
(`npm run bench -- --owners 1`) would test it. Please flag any contract-side reason that would
contradict this explanation.

## C: SDK use

The runner signs every intent with `signIntent` and `intentDomain` from `sdk/src/index.ts` before
the measurement window. It does not use `ScheduledTransferAgent` or the journal, because the
experiment needs one controlled arrival schedule. No SDK change.

## Team items found while checking documentation

These are outside E's module. Each needs an owner:

- `docs/ai-usage-log.md` now exists with E's entries. A and B have no AI-use record yet; C and D
  have one in their own files, linked from the log.
- The repository has no architecture diagram. Plan §6 has one in the planning document, and
  §14.2 recommends one in the submission.
- There are no contribution records (plan §9.7, §14.2).
- The root README says `npm test` "runs both" suites; it now runs three (contracts, relayer, SDK).
- D's documents are in Chinese and all others are in English. If graders read only one
  language, consider an English summary of `apps/web/README.md` and `VERIFICATION.md`.
