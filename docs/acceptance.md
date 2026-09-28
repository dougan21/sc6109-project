# On-chain implementation acceptance

Completed on 2026-09-22. The full on-chain implementation scope is complete, including
the gas review, frozen interface, and reproduction from a fresh checkout. Executable
source verified: commit `2ca6264` (the subsequent closeout commit adds evidence and
documentation only).

## Completion record

| Deliverable | Evidence |
| --- | --- |
| Standard test ERC-20 | `contracts/src/MockToken.sol`; real transfers reconciled in demo |
| Authorization management | Caller-scoped configure/revoke/query; limits, expiration, fresh epochs and budgets |
| Signed atomic execution | EIP-712, ECDSA, nonce consumption, cumulative budget, SafeERC20, shared reentrancy guard |
| Reproducible deployment and initialization | `scripts/demo.mjs`; `npm run verify:local` owns and stops an isolated Anvil instance |
| Signing definition and fixture | `scripts/typed-data.mjs`, `interfaces/signing-fixture.json`; live ethers/contract digest check |
| Security and randomized checks | 28 passing tests; 32 runs per randomized test, fixed seed `0x6019` |
| Gas/bottleneck review | Equal-workload comparison below and raw receipts in `evidence/gas.json` |
| ABI, events and deployed addresses | `interfaces/*.json`, `interfaces/freeze.json`, `evidence/deployment.json` |
| Interface freeze | `npm run check:interfaces` passed against a fresh compilation |
| Authorization explanation and security demonstration | `docs/protocol.md`, `docs/security-demo.md` |
| Clean-checkout acceptance | Fresh clone, new npm cache, `npm ci`, build, tests, format, freeze check, demo and gas review all passed |

`evidence/deployment.json` archives a verified local deployment and signing fixture.
Its chain was stopped after verification; it is not a live public deployment. Run the
demo again to produce the current `deployments/local.json`. The archived gas review
deploys a separate fresh token/executor; its domain addresses are recorded in its own
JSON so the two deployments cannot be confused.

## Gas review

Every row executes the same 20 signed transfers of 1 TEST, using identical signatures,
owner, recipient, token, executor and nonce order. An EVM snapshot is restored before
each row. Initial owner balance, allowance and budget are 20 TEST, recipient balance
and spent are zero, and epoch is 1. All rows confirm 20 unique matching intent events,
the exact final balances and spending. No execution attempts failed. Setup gas is
recorded separately in the JSON and excluded from this table.

| Batch size | Transactions | Execution gas | Gas per successful intent | Reduction vs singles |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 20 | 2,112,084 | 105,604.2 | 0.00% |
| 2 | 10 | 1,507,184 | 75,359.2 | 28.64% |
| 5 | 4 | 1,144,424 | 57,221.2 | 45.82% |
| 10 | 2 | 1,023,622 | 51,181.1 | 51.53% |
| 20 | 1 | 963,168 | 48,158.4 | 54.40% |

Gas per intent is total receipt gas divided by 20. Reduction is
`100 * (1 - rowGas / singleIntentBaselineGas)`. The summary CSV and full JSON retain
transaction hashes, receipts, gas prices, execution fees, setup receipts, workload,
signatures, source commit and environment. Fees are recorded as gas times effective
gas price in wei, not a real-currency valuation.

Batching amortizes top-level transaction costs and repeated access/state updates for
this shared-owner, shared-token workload. Every intent still requires signature
recovery, a distinct nonce write, budget accounting, a transfer and an event. The
remaining per-intent work limits further savings. There is no claim of parallel EVM
execution. Larger batches also increase the amount of work reverted by a single
invalid item; callers must simulate complete batches and split by their gas budget.

This is a compact deterministic contract gas review, one measurement per size. The
clean-checkout run reproduced all five totals from the initial development run.
It is not a statistical throughput, queueing-latency or failure-rate benchmark; automine
timings do not predict public-chain capacity. The same-recipient workload benefits
from shared storage access and does not establish savings for arbitrary token mixes.

## Reproduction and review

From a fresh checkout:

```sh
npm ci
npm run build
npm test
npm run fmt
npm run check:interfaces
npm run verify:local
```

Verified on macOS arm64 with Node 26.9.0, npm 11.19.1, Foundry 1.7.1,
Solidity 0.8.30, Cancun, optimizer 200 runs, chain 31337, automining and one receipt
confirmation. A fresh npm cache and no copied node_modules/build outputs were used;
the host's existing Solidity compiler cache was available. This verifies clean-checkout
reproduction, not a new operating-system installation. `npm ci` reported zero known
dependency vulnerabilities. `evidence/verification.log` retains the command output.
The initial workspace run used Node 20.20.2 and npm 10.8.2; the fresh checkout
resolved the host's default Node 26.9.0/npm 11.19.1 outside the workspace configuration.
Both runs produced identical gas totals.

Build lint observations were reviewed: timestamp comparisons implement the required
on-chain validity windows and depend on chain timestamps, not exact wall-clock
scheduling. The unchecked transfer is test arrangement against the known MockToken;
production transfers use SafeERC20. The test-only bytes4 conversion intentionally
extracts a callback revert selector. There were no compilation or test failures.

The v1 contract and ABI were unchanged during closeout. Any future interface or
semantic change needs a documented rationale and updated compatibility evidence,
followed by explicit regeneration of the freeze. No production audit, scheduler,
queue service or dashboard is claimed by this on-chain acceptance.
