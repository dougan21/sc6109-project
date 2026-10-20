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
The agent wrote the code, ran the experiments and drafted these documents. Each entry's
**Decided by** field says who made the decision at the time: member E, or the agent without
consulting the member.

**Member review, 2026-10-20.** Member E stated that they had reviewed the code and
documentation on `feat/e-benchmarks`, including `benchmarks/metrics.ts`, `benchmarks/run.ts`
and the README's interpretation. The agent had walked them through each part first. They asked
for no changes. Specific findings were not recorded. Every agent decision below was therefore
accepted by the member after review, not when it was made.

### E-1 Readiness of upstream work — 2026-10-19

- **Problem:** Could E start, given A–D's state against the plan?
- **Instruction (member):** Clone the repository, compare progress with the plan, decide whether E can begin.
- **AI suggestion:** Run every suite and D's real-chain demo rather than trusting the documents.
- **Decided by:** Agent.
- **Verification:** 66 tests passed. `demo:evm` confirmed three intents in one transaction with
  measured gas and timings.
- **Result:** E was unblocked; it was also behind the plan's W4 schedule. Commit: none (no file change).

### E-2 Experiment protocol — 2026-10-19

- **Problem:** Make baseline and batch runs comparable (plan §11.2).
- **Instruction (member):** Start with batch sizes 1/5/10/20 on EVM; output raw data and a
  schema-valid summary.
- **AI suggestion:** A fresh chain and fresh relayer database per run; automine setup, then 1 s
  interval mining; SDK pre-signing; ten independent owners; one warm-up intent per owner; steady
  10/s and burst arrivals; `MAX_WAIT_MS=0` for every variant; alternating order.
- **Decided by:** Agent. The member was not consulted on these parameters; they accepted them in
  the 2026-10-20 review. Recorded as D-012.
- **Rationale:** The relayer binds its database to one chain, so snapshots could not be reused.
  Holding the wait at 0 leaves the batch cap as the only variable.
- **Known consequence:** 10/s is ten times baseline capacity, so baseline latency is mostly
  queueing, and ten owners limit the gas saving (see E-7).
- **Verification:** Every run checks on-chain balances, `spent`, consumed nonces and exact event IDs.
- **Result:** 24 of 24 formal runs reconciled. Commit `ce13b8b`.

### E-3 Metric source — 2026-10-19

- **Problem:** The relayer already exposes `GET /metrics`.
- **Instruction:** None specific. The constraint came from `apps/web/E_EXPERIMENT_HANDOFF.md` and
  the relayer README.
- **AI suggestion:** Recompute metrics from raw intent and batch records over a workload-drain
  window. Keep the `/metrics` snapshot only as reference.
- **Decided by:** Agent.
- **Rationale:** The `/metrics` window keeps growing after the drain.
- **Verification:** Unit tests check each denominator, reverted gas, unfinished work and the
  zero-success case.
- **Result:** `benchmarks/metrics.ts`, commit `ce13b8b`.

### E-4 Port race found during the first formal run — 2026-10-19

- **Problem:** The third run aborted: `Port 18645 is busy`.
- **Instruction:** None; found while the agent was running the comparison.
- **AI suggestion:** Check for orphaned processes first (none were found), then wait up to 15 s for
  the port to be released.
- **Decided by:** Agent. It also discarded the partial results and reran the whole comparison.
- **Verification:** All 24 later runs started cleanly.
- **Result:** Commit `ce13b8b`.

### E-5 Exact commit and runtime — 2026-10-19

- **Problem:** The first full results carried `ae5a0e9-dirty` and Node 26.11.0, but the repository
  pins 22.23.1.
- **AI suggestion:** Commit first, then rerun on Node 22.23.1. Exclude `benchmarks/results/` from
  the dirty check. Use the official Node 22.23.1 build after checking its SHA-256.
- **Instruction (member):** Commit to `feat/e-benchmarks`, then rerun both comparisons on Node 22.23.1.
- **Decided by:** Member E chose to commit and rerun. The agent decided the dirty-check change
  and the source of Node 22.23.1.
- **Verification:** Every run records commit `ce13b8b`, `dirty: false` and Node v22.23.1.
  Relayer, SDK and benchmark tests passed on that Node.
- **Result:** Results commit `0a8946c`.

### E-6 Explaining the variance — 2026-10-19 (agent self-check, not a human review)

- **Problem:** Burst size 20 varied more than the other configurations in the Node 26 run.
- **Instruction:** None.
- **AI suggestion:** The README first stated a cause ("the first batch was claimed before the burst
  arrived") before checking the data.
- **Decided by:** Agent. It then read `batches.json`, confirmed one repetition split as
  1, 20, 20, 20, 20, 19, and replaced the claim with that evidence. In the Node 22 rerun all three
  repetitions formed 5 × 20, so the README presents the split as an observation from an earlier
  run only. A later agent check also corrected a spread of "≤0.9%" to the measured 1.7%.
- **Rationale:** Plan §9.6 requires observations to be kept apart from explanations.
- **Result:** Commits `0a8946c` and `9ee950f`.

### E-7 Explaining the gas difference from A's review — 2026-10-19 (open)

- **Problem:** Batching saves 21–41% here but 54% in `evidence/gas.csv`.
- **Instruction:** None.
- **AI suggestion:** A's review shares one owner, agent and recipient; here ten independent owners
  share less storage per batch.
- **Decided by:** Agent, stated as a hypothesis in `benchmarks/README.md`, not as a measured cause.
- **Verification:** Not done yet. A single-owner run (`npm run bench -- --owners 1`) would test it.
- **Result:** Commit `9ee950f`.
