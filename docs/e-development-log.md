# Member E development record

Date: 2026-10-19. Scope is the controlled performance comparison in `benchmarks/`. The
contracts, relayer, SDK and frontend were used as their owners merged them on `main@ae5a0e9`.
None of their source files changed. Shared files touched: root `package.json` (three scripts),
`tsconfig.json` (typecheck includes `benchmarks/`), root `README.md` (one section) and
`docs/decisions.md` (D-012).

## Readiness check before starting

On `main@ae5a0e9`, `npm ci`, `npm run build`, `npm test` and `npm run typecheck` passed: 28 contract,
27 relayer and 11 SDK tests. `npm run check:interfaces` matched the freeze. D's
`npm run demo:evm` confirmed three intents in one real transaction, and `GET /metrics` returned
measured gas and timings. So the EVM path E measures worked end to end before any E code
existed.

## Instructions given to the coding agent

By member E:

- Clone the repository and check whether the other members' progress lets E begin.
- Start with batch sizes 1, 5, 10 and 20 on real EVM execution, and output raw data plus a summary
  that matches `apps/web/public/integration/benchmark.schema.json`.
- Commit the benchmark code to `feat/e-benchmarks`, then rerun both comparisons on Node 22.23.1 so
  the summary's `commit` field is exact.
- Check the documentation against the plan and the other members' work, then fill E's gaps in English.

Constraints the agent applied from the repository's own documents, not stated by the member:

- Use the definitions in `apps/web/E_EXPERIMENT_HANDOFF.md`. Do not use mock gas or the cumulative
  `/metrics` window as results.
- Do not change the contracts, relayer, SDK or frontend.

## Design choices

The agent made these choices without consulting the member. Member E accepted them after
reviewing the code on 2026-10-20 (see `docs/ai-usage-log.md`).

Accepted:

- A fresh Anvil and a fresh relayer database per run, instead of one chain with snapshots. The
  relayer binds its database to the chain, so a fresh pair is the simplest way to get identical
  initial state.
- Setup with automine, then switch to 1 s interval mining for warm-up and measurement. This keeps
  setup fast and mining consistent across runs (plan §11.3).
- Ten independent owners, each with its own agent and recipient, round-robin. One warm-up intent
  per owner, excluded from all metrics.
- Signing every intent with the SDK before the window opens, so signing cost is not part of the
  arrival schedule.
- `MAX_WAIT_MS=0` for every batch-size variant, so only the batch cap changes from the baseline.
- Recomputing metrics from raw records, using the relayer's nearest-rank percentile.
- An independent chain reconciliation that must pass for a run to count.
- Validating the summary with the frontend's own `parseBenchmark` before writing it.
- Alternating configuration order between repetitions.

Rejected:

- `GET /metrics` as the final numbers: its window keeps growing after the run drains.
- Mock mode: its gas is a formula.
- Driving the measurement through `ScheduledTransferAgent`: its tick loop would add a second
  timing source. The SDK still signs every intent.
- Reusing `evidence/gas.csv`: one owner, automine, no latency or failure data.

## Defects found and fixed during development

| Found | Cause | Fix | Commit |
| --- | --- | --- | --- |
| The third run failed with `Port 18645 is busy` | The Anvil npm wrapper exits slightly before its native child releases the port | Wait up to 15 s for both ports before each run | `ce13b8b` |
| Results from the first comparison would mark the second as dirty | `git status` counted untracked result files | Exclude `benchmarks/results/` from the dirty check | `ce13b8b` |

Neither defect is in another member's module. No failure case needed reporting to A, B or C.

## Checks

| Check | Result |
| --- | --- |
| `npm run test:bench` (Node 26.11.0 and 22.23.1) | 5 passed: nearest-rank percentile, exact decimal ratio, failure and gas denominators including reverted receipts, unfinished-not-failed, zero-success N/A |
| `npm run typecheck` | Passed with `benchmarks/` included |
| `npm run test:relayer`, `npm run test:sdk` on Node 22.23.1 | 27 and 11 passed |
| Pilot: 20 intents, 4 owners, sizes 1 and 10 | Drained; all chain checks passed; summary accepted by `parseBenchmark` |
| Formal: steady 10/s and burst, sizes 1/5/10/20 × 3, 100 intents each, commit `ce13b8b`, Node 22.23.1 | 24 of 24 drained, 0 failed, 0 unfinished, all chain checks passed; results in `0a8946c` |

Node 22.23.1 was the official nodejs.org darwin-arm64 build, checked against the published
SHA-256 list and used only for these runs. An earlier run of both comparisons on Node 26.11.0
with uncommitted code agreed with these results: gas means within 0.3%, throughput and latency means
within 5%, except throughput and latency at burst size 20. There, one repetition split as
1, 20, 20, 20, 20, 19; throughput averaged 19.7 instead of 21.0 intents/s, and p50 was 3.0 s instead of 2.6 s. That run is not
part of the submitted results.

## Review

On 2026-10-20 member E stated that they had reviewed the code and documentation on this
branch, after a walkthrough of `metrics.ts`, `run.ts` and the README's interpretation by the
agent. No changes were requested. Specific findings were not recorded.

## After merge (2026-10-20)

PR #6 merged into `main` as `2ca64d7`. D's PR #7 (`0619528`) then integrated the results:

- D's `npm run check:experiments` (`apps/web/scripts/check-experiments.ts`) recomputes all 24 runs
  from the raw archives without calling E's metric functions: 2,400 intents, 834 receipts, digests,
  nonces, the four metrics, warm-up exclusion and balances. E reran it on `main@0619528` with
  Node 22.23.1, and it printed `PASS`.
- D ran a 20-intent, 4-owner reproduction of `npm run bench` on Node 22.23.1 on its own checkout.
- Both summaries are bundled into the Performance page with a Workload selector. Screenshots
  are in `apps/web/qa/performance-e-*.jpg`.

D's record says this work was AI-assisted (Codex), and it does not claim D or B reviewed all
the code in person. See the 2026-10-20 section of `apps/web/VERIFICATION.md`.

## Not yet done

- B's review of the calculations (plan §9.1). See `docs/e-handoff.md`.
- Studies from plan §9.6 and §11 not run yet: waiting windows at low load (H3), invalid-intent
  mixes (H4), shared-budget owners, restart recovery under load, and 500/1000-intent runs.
- A full reproduction from a fresh clone on another machine. D's 20-intent run covers only part of it.

AI use is recorded in `docs/ai-usage-log.md`.
