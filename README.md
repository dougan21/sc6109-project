# Agent Intent Batch Executor

Local EVM prototype for bounded, agent-signed ERC-20 transfers. Includes the executor,
test token, pinned build tools, contract tests, signing format, and a runnable deployment
and security demonstration. This repository implements the on-chain scope; it does not
include a queue service, scheduler, or dashboard.

## Run

Use Node.js 20.20.2 or newer and npm. Dependencies and native Foundry binaries are pinned
in `package-lock.json`. The first build downloads Solidity 0.8.30.

```sh
npm ci
npm run build
npm test
npm run chain
```

In another terminal, from this directory:

```sh
npm run demo
npm run export
```

For a self-contained demo and contract gas comparison, run `npm run verify:local`
after the build. It starts a separate local chain on port 18545, runs both workflows,
and stops that chain automatically. Set `VERIFY_PORT` if that port is already in use.
`npm run gas` runs only the gas comparison against an existing local chain.

The chain binds to localhost with chain ID 31337 and the Cancun hardfork. The demo
deploys fresh contracts, mints 20 TEST, approves a bounded allowance, authorizes the
agent, and sends two signed transfers in one transaction through a separate relayer.
It reconciles balances, spent, nonces, and event digests, checks replay and revocation
rejection, then executes a fresh intent after reauthorization. Each run deploys fresh
contracts, so rerunning needs no chain reset.

`deployments/local.json` contains the live addresses, ABI, transaction hash, event IDs,
gas used, and an ethers-signed fixture verified against the deployed contract. It is
generated and ignored because addresses describe only that local chain session. The
final policy is active at epoch 3, with 1 TEST spent in its new 20 TEST budget; the
recipient has received 3 TEST overall. The static ABI and encoding fixture are in
[`interfaces/`](interfaces/). Regenerate them after contract changes.

The demo uses public Anvil accounts and requires a loopback RPC with chain ID 31337.
Never fund these accounts on a public chain. `MockToken.mint` is deliberately unrestricted.
Stop the local chain with Ctrl-C when finished.

## Contract behavior

- `configureAgent(agent, policy)` creates or replaces the caller's own policy, advances
  its epoch, and resets spending under explicit new approval.
- `revokeAgent(agent)` disables the caller's policy and advances its epoch.
- `getAgentPolicy(owner, agent)` returns the full authorization record.
- `hashIntent(intent)` returns the complete EIP-712 digest used as `intentId`.
- `consumed(owner, agent, epoch, nonce)` exposes replay state.
- `executeBatch(intents, signatures)` atomically executes one or more transfers.

See [protocol and security boundaries](docs/protocol.md) for exact fields and behavior.

## Verification

```sh
npm test
npm run fmt
npm run check:interfaces
```

Tests cover signature/domain failures, caller isolation, epoch changes, timing and
budget boundaries, duplicate nonces, insufficient balance/allowance, atomic rollback,
token return handling, reentrancy, and batch/single equivalence. Randomized tests use
32 runs and a fixed seed to keep feedback short. Solidity is pinned to 0.8.30 with
optimizer enabled at 200 runs and Cancun EVM semantics. Build artifacts are ignored.

The contract gas comparison restores identical starting state for 20 transfers at
batch sizes 1, 2, 5, 10, and 20. Raw receipts, setup costs, environment and calculation
inputs are saved in `evidence/gas.json`; the summary is `evidence/gas.csv`. This is a
compact gas review, not a throughput/latency experiment. See [acceptance evidence](docs/acceptance.md)
and the [security demo guide](docs/security-demo.md).

The v1 ABI, event topics, signing fixture and creation bytecode are frozen in
`interfaces/freeze.json`. `npm run check:interfaces` detects drift after building.
Change the interface only with a documented reason, updated fixtures/docs and verified
compatibility, then explicitly regenerate the freeze. This is a prototype, not an
audited production protocol or an ERC-4337 implementation.
sc6109-project
