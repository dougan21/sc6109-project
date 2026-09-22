# AI-assisted development record

## 2026-09-22 — Member B backend implementation

**Human instruction:** Work in `dougan21/sc6109-project`, create a branch dedicated to B, implement B's responsibilities, and do not create a pull request before the owner approves.

**Starting evidence:** Remote repository contained only its initial README. The local bilingual Option 1 plan defined B's queue, API, coordinator, recovery, and instrumentation responsibilities. A's contract and C's SDK were unavailable.

**AI-assisted work:** TypeScript service scaffolding; API and EIP-712 validation; SQLite storage; batch worker; mock and EVM adapters; tests; local demo; operating and team-handoff documentation.

**Decisions adopted during implementation:**

- Scope the work to B and keep signing helpers inside B until C supplies a shared SDK.
- Persist a signed transaction before broadcasting. An RPC timeout cannot prove execution failure.
- Require exact intent events for confirmation; a consumed nonce is not enough.
- Use atomic batches, ordered-prefix simulation, and bounded retries after definite reverts.
- Keep a permanent database nonce reservation because service-level failure does not revoke signatures.
- Make mock behavior explicit and require an ABI-confirmation flag before using the provisional EVM adapter.
- Leave registry queries as explicit 501 rather than inventing A's missing ABI or policy state.
- Use a test-only executor for real local RPC validation; do not claim token or authorization coverage from that fixture.
- Enforce one local process with a fail-closed lock; a stale lock needs verified operator removal.

**Issues found and addressed:**

- Mock validation initially received internal record metadata along with the signed payload; strip internal fields before strict schema checks.
- Provider calls need a bounded transport timeout and uncached nonce reads for local sequential execution.
- Startup adapter initialization can fail; the process lock must still be released.
- An initial `solc` development dependency pulled vulnerable `tmp@0.2.6`; override it to patched `0.2.7` and update the lockfile. Installation audit then reported zero known vulnerabilities.
- The sandbox disallowed localhost listening; the full test command was run with the required local-network permission rather than skipping EVM tests.

**Verification evidence:** Run `npm run check` for the version under review. Tests include real Anvil receipt/rollback checks and simulated broadcast-timeout/restart scenarios. `npm run demo` is the local HTTP demonstration. Final commit identifies the reviewed source snapshot; raw generated runtime files remain untracked.

**Human review status:** Pending. This record documents AI-assisted implementation and executed checks, not approval by Members A–E. The owner should inspect design choices and test evidence before authorizing a PR. No team member's understanding or contribution is inferred from generated code volume.
