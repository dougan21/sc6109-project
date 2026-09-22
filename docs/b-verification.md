# B backend verification — 2026-09-22

## Environment

- Node.js: 22.23.1
- npm: 10.9.8
- OS/architecture: macOS arm64
- SQLite: built-in `node:sqlite` (Node 22 reports its experimental warning)
- Anvil: npm platform dependency 1.7.1
- Solidity compiler: solc-js 0.8.37, fixture compiled for Cancun with optimizer enabled (200 runs)
- Package versions and integrity hashes: `package-lock.json`

## Executed checks

| Check | Observed result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run check` | Passed: 25 tests, 0 failures, 0 skipped; includes four nested Anvil integration cases |
| Dependency install/audit after tmp override | 0 known vulnerabilities reported |
| Actual service startup and HTTP `npm run demo` | 12 signed intents confirmed in 2 mock batches; 0 unfinished |
| Graceful process stop | Database lock released |
| Restart using the same database and mock ledger | `/health` healthy; original 12 confirmed intents and 2 transactions preserved |

The HTTP smoke run used local port 31009 and a temporary data directory so it did not populate the project's normal `data/` directory. The temporary service was stopped after verification.

## Evidence boundaries

- Anvil checks use a test-only fixture to verify typed signatures, complete event-ID matching, raw transaction broadcasting, recovery after reopening the database, preflight errors, and actual transaction reverts.
- The fixture does not implement A's token transfer, delegated owner permissions, cumulative budgets, registry, or full project security properties.
- Mock counts prove orchestration and persistence. The mock gas formula is synthetic, and its throughput/latency is not evidence of blockchain scaling performance.
- No public testnet, real funds, A's actual contract, C's actual SDK, full ERC-4337, or LLM was exercised.
- Human review and cross-member integration approval remain pending. This file is a verification record, not an audit or a completed course benchmark report.

Re-run `npm run check` after modifying source or dependency versions. E should add controlled, repeated actual-contract performance experiments after A/B/C integration.
