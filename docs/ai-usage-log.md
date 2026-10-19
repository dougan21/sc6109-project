# AI usage log

The course permits AI-assisted development. Members stay responsible for architecture, review,
testing and explanation (plan §13). Record each significant use with these fields: date, member,
tool, problem, key instruction, AI suggestion, decision (accepted / modified / rejected),
rationale, commit, verification and result. Do not paste whole conversations or any secret. Each
member adds their own entries under their own heading.

Records kept elsewhere so far:

- C: instructions, accepted and rejected suggestions, and checks in
  [`c-development-log.md`](c-development-log.md).
- D: "AI 辅助与设计记录" in [`apps/web/VERIFICATION.md`](../apps/web/VERIFICATION.md) (Codex).
- A and B: no record in the repository yet.

## Member E

Tool: Claude Code with Claude Opus 5.5, run on the member's machine against this repository.
Member E chose the scope, instructions and commits. The agent wrote the code, ran the experiments
and drafted these documents. This log does **not** claim that member E has reviewed every line
by hand. Complete that review before submission and note it here.

### E-1 Readiness of upstream work — 2026-10-19

- **Problem:** Could E start, given A–D's state against the plan?
- **Instruction:** Clone the repository, compare progress with the plan, decide whether E can begin.
- **AI suggestion:** Run every suite and D's real-chain demo rather than trusting the documents.
- **Decision:** Accepted.
- **Verification:** 66 tests passed. `demo:evm` confirmed three intents in one transaction with
  measured gas and timings.
- **Result:** E was unblocked; it was also behind the plan's W4 schedule. Commit: none (no change).

### E-2 Experiment protocol — 2026-10-19

- **Problem:** Make baseline and batch runs comparable (plan §11.2).
- **Instruction:** Batch sizes 1/5/10/20 on EVM first; raw data plus a schema-valid summary.
- **AI suggestion:** A fresh chain and fresh relayer database per run; automine setup, then 1 s
  interval mining; SDK pre-signing; one warm-up intent per owner; `MAX_WAIT_MS=0` for every
  variant; alternating order.
- **Decision:** Accepted. Recorded as D-012.
- **Rationale:** The relayer binds its database to one chain, so snapshots could not be reused.
  Holding the wait at 0 leaves the batch cap as the only variable.
- **Verification:** Every run checks on-chain balances, `spent`, consumed nonces and exact event IDs.
- **Result:** 24 of 24 formal runs reconciled. Commit `ce13b8b`.

### E-3 Metric source — 2026-10-19

- **Problem:** The relayer already exposes `GET /metrics`.
- **AI suggestion:** Recompute metrics from raw intent and batch records over a workload-drain
  window. Keep the `/metrics` snapshot only as reference.
- **Decision:** Accepted.
- **Rationale:** The `/metrics` window keeps growing after the drain (relayer README; D's handoff).
- **Verification:** Unit tests check each denominator, reverted gas, unfinished work and the
  zero-success case.
- **Result:** `benchmarks/metrics.ts`, commit `ce13b8b`.

### E-4 Port race found during the first formal run — 2026-10-19

- **Problem:** The third run aborted: `Port 18645 is busy`.
- **AI suggestion:** Check for orphaned processes first (none were found), then wait up to 15 s for
  the port to be released.
- **Decision:** Accepted. The partial results were discarded and the whole comparison rerun.
- **Verification:** All 24 later runs started cleanly.
- **Result:** Commit `ce13b8b`.

### E-5 Exact commit and runtime — 2026-10-19

- **Problem:** The first full results carried `ae5a0e9-dirty` and Node 26.11.0, but the repository
  pins 22.23.1.
- **Instruction:** Commit to `feat/e-benchmarks`, then rerun both comparisons on Node 22.23.1.
- **AI suggestion:** Exclude `benchmarks/results/` from the dirty check. Use the official
  Node 22.23.1 build after checking its SHA-256.
- **Decision:** Accepted.
- **Verification:** Every run records commit `ce13b8b`, `dirty: false` and Node v22.23.1.
  Relayer, SDK and benchmark tests passed on that Node.
- **Result:** Results commit `0a8946c`.

### E-6 Explaining the variance — 2026-10-19 (reviewed AI claim)

- **Problem:** Burst size 20 varied more than the other configurations in the Node 26 run.
- **AI suggestion:** The README first gave a cause ("the first batch was claimed before the burst
  arrived") before checking the data.
- **Decision:** Modified. The agent then read `batches.json`, confirmed one repetition split as
  1, 20, 20, 20, 20, 19, and put that evidence in the text. In the Node 22 rerun all three repetitions
  formed 5 × 20, so the README now presents it as an observation from an earlier run only.
- **Rationale:** Plan §9.6 requires observations to be kept apart from explanations.
- **Result:** Commits `0a8946c` and the documentation commit that adds this log.

### E-7 Explaining the gas difference from A's review — 2026-10-19 (open)

- **Problem:** Batching saves 21–41% here but 54% in `evidence/gas.csv`.
- **AI suggestion:** A's review shares one owner, agent and recipient; here ten independent owners
  share less storage per batch.
- **Decision:** Modified. Stated as a hypothesis in `benchmarks/README.md`, not as a measured cause.
- **Verification:** Not done yet. A single-owner run (`npm run bench -- --owners 1`) would test it.
