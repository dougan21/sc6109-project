# Agent Intent Batch Executor

Local EVM prototype for bounded, agent-signed ERC-20 transfers. Includes the executor,
test token, pinned build tools, contract tests, signing format, and a runnable deployment
and security demonstration. The repository also includes a durable intent API and
relayer with a default mock mode. A scheduler and dashboard are not included.

## Run

Use Node.js 22.23.1 (`nvm use` reads `.nvmrc`) and npm. The relayer needs Node 22's
built-in SQLite support. Dependencies and native Foundry binaries are pinned
in `package-lock.json`. The first build downloads Solidity 0.8.30.

```sh
npm ci
cp .env.example .env
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

## Relayer workflow

After the same installation and environment setup, run `npm run dev` to start the
local API. In another terminal run `npm run demo:relayer` to submit twelve signed
requests and wait for simulated confirmations. `npm run demo` remains the real
contract demo; `npm run demo:contracts` is its explicit alias. The relayer's mock
mode performs no token transfers and reports synthetic gas, not measured chain gas.

`npm run test:contracts` runs the contract suite; `npm run test:relayer` runs the
backend suite, including its EVM transport fixture. `npm test` runs both, and
`npm run check` adds TypeScript, formatting and interface checks. The relayer tests
launch their own temporary Anvil instance. Node's SQLite experimental warning is
expected on this runtime.

The relayer currently signs for `AgentIntentBatchExecutor`, while the deployed
contract domain is `AgentIntentExecutor`. Its EVM adapter was tested against a
transport fixture, not this authorization contract. Keep `RELAYER_MODE=mock` and
`EVM_ABI_CONFIRMED=false` until domain/ABI integration is implemented and verified;
changing the executor address alone is insufficient. See
[relayer operation and API](services/relayer/README.md) for its configuration and
recovery behavior. `/agents` remains unsupported by that service.

## Local configuration

The tracked `.env.example` contains safe defaults. Copy it once to `.env`; the scripts
load `.env` automatically using Node's built-in environment-file loader. A missing
`.env` uses the same defaults, and existing shell variables override file values.
Only `.env` is loaded automatically; `.env.local` and `.env.production` are not loaded.
Private environment files are ignored, while sanitized `.env.example` templates can
be committed. No private key, API token or account registration is required.

| Variable | Default | Purpose |
| --- | --- | --- |
| `RPC_URL` | `http://127.0.0.1:8545` | Bind address for `npm run chain` and connection for `demo`/`gas` |
| `VERIFY_PORT` | `18545` | Independent local chain owned by `verify:local` |

The template also includes the relayer HTTP port (`PORT`, default 3000), demo URL
(`RELAYER_URL`), durable database/ledger paths, batching/retry limits and confirmation
depth. If you change `PORT`, update `RELAYER_URL` to match. Keep the database and mock
ledger together across restarts. Use a new database when changing chain identity or
resetting the chain; do not delete pending transaction state to bypass recovery.

Use a loopback HTTP URL with an explicit port from 1025 to 65535; paths, credentials,
query strings and public endpoints are rejected. The scripts also require chain ID
31337. To use another port, set `RPC_URL=http://127.0.0.1:9545` in `.env` and both the
chain and client commands will agree. Use a distinct, free `VERIFY_PORT` for the
self-contained check; that command overrides `RPC_URL` for its child workflows.

The demo deliberately uses public Anvil development accounts, not configurable
production keys. Never put real funds in those accounts. Do not paste secrets into
the template, README, logs, or generated evidence. If a secret is accidentally
committed, revoke it; adding an ignore rule does not remove existing history.

For a new checkout, run `npm ci`, copy the template, run `npm run build`, and run
`npm run verify:local`. This installs pinned dependencies, creates fresh contracts,
checks real transfers and generates current local deployment information without
requiring any ignored documentation or previous build artifacts. If a port is busy,
choose another free port; do not reset an unrelated running chain. For interactive
inspection, keep `npm run chain` running and execute `npm run demo` separately.
Workspace automatic Git fetching is disabled to avoid reintroducing pre-rewrite
remote history. Fetch manually only when ready to reconcile that history.

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

The exact signed field order is in `scripts/typed-data.mjs`, with a deterministic
example in `interfaces/signing-fixture.json`. All fields and the domain are signed.
Policies restrict token, recipient, per-intent amount, total budget and expiration.
Every configuration or revocation advances the epoch, invalidating old signatures.
Nonces are consumed per owner/agent/epoch and may execute out of order. Anyone can
forward a valid signature, but cannot alter it. One failing item rolls back the entire
batch, including transfers, spent, nonce consumption and events. Simulate the complete
batch in order before sending; balances, approval and authority can change afterward.
Only standard non-fee, non-rebasing tokens are supported. Scheduling frequency is not
enforced on-chain, so a compromised signer can spend its remaining budget sooner than
intended. Revocation cannot undo previously completed transfers.

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
compact gas review, not a throughput/latency experiment. `evidence/verification.log`
retains the clean-checkout verification. Archived addresses refer to that stopped
local chain; rerun the demo for current addresses. `docs/` is local-only and is not
needed to build, configure, run, or understand the contract interface.

The v1 ABI, event topics, signing fixture and creation bytecode are frozen in
`interfaces/freeze.json`. `npm run check:interfaces` detects drift after building.
Change the interface only with a documented reason, updated fixtures/docs and verified
compatibility, then explicitly regenerate the freeze. This is a prototype, not an
audited production protocol or an ERC-4337 implementation.
