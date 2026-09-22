# SC6109 Course Project — Option 1

AI-Powered On-Chain Agent Protocol with Intent Infrastructure.

This branch contains **Member B's relayer/backend implementation**: signed intent intake, a SQLite inbox/outbox, asynchronous batching, transaction recovery, and API metrics. It is ready for local orchestration demonstrations and A/C/D/E interface review.

## Quick start

Use Node **22.23.1** (`nvm use` if available).

```bash
npm ci --ignore-scripts
npm run check
cp .env.example .env
npm run dev
```

In a second terminal, from the repository root:

```bash
npm run demo
```

The default service listens at `http://127.0.0.1:3000`. The demo submits twelve EIP-712-signed requests and waits for their **simulated** receipts. No wallet extension, LLM, RPC account, or real funds are needed. `npm run check` also launches a temporary local Anvil node and deploys a **test-only interface fixture** to verify the real EVM adapter.

## Implementation boundaries

- **Implemented:** strict signatures/schema, durable intake and nonce reservations, size/timeout batching, ordered whole-prefix simulation, gas-based splitting, atomic-revert retries, receipt tracking, restart recovery, per-run metrics, and safe error responses.
- **Mock mode:** persists simulated nonce consumption and receipts. It does **not** transfer tokens, enforce owner delegation/budgets, or measure real gas.
- **EVM mode:** real RPC transport and receipt decoding, tested locally with `BExecutorFixture.sol`. A's production project contract and C's SDK are not yet integrated. Its provisional ABI must be confirmed before enabling this mode.
- **Not implemented here:** owner/agent management UI, a production authorization contract, agent intelligence, full ERC-4337, registry indexing (`GET /agents` returns 501), or E's full comparative benchmark study.
- **Single local operator:** one database, one relayer process, one unresolved transaction. Unknown outcomes halt new sending until reconciliation. This service has no public authentication layer and binds only to loopback.

## Team documentation

- [B service operation, API, configuration, and recovery](services/relayer/README.md)
- [A/C/D/E handoff and integration checklist](docs/b-handoff.md)
- [中文工作说明与验收入口](docs/b-work-summary-zh.md)
- [AI-assisted development record](docs/ai-usage-log.md)

Work branch: `codex/b-relayer`. A pull request will only be created after the project owner approves.
