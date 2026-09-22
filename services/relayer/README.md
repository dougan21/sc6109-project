# Member B: Intent API and Relayer

## Scope and current status

This service implements B's backend responsibilities from the Option 1 plan. API acceptance means that a signed request was validated and durably queued. **It does not mean the contract authorized or executed the transfer.** Contract simulation and execution are separate steps.

The service has a default mock adapter and a real ethers JSON-RPC adapter. The latter is locally tested with an explicitly limited Solidity fixture. No A-owned authorization/token contract or C-owned SDK has been supplied to this branch. The B-side intent type and executor ABI are therefore integration drafts, not an ERC-4337 implementation or a claim of project-level fund safety.

## Run and verify

From the repository root, using Node 22.23.1:

```bash
npm ci --ignore-scripts
npm run check
cp .env.example .env
npm run dev
```

In another terminal:

```bash
npm run demo
```

The demo creates ephemeral signing keys in memory, submits twelve requests, and reports a runId and metrics. It refuses EVM mode because it does not register agents or grant allowances. Mock results are for workflow verification, not the course performance comparison.

Node 22 prints an experimental warning for `node:sqlite`; this is expected. `npm run check` includes an Anvil integration test and needs permission to spawn a child process and listen on the local loopback interface. The Anvil binary is an npm optional platform dependency; do not omit optional dependencies during installation. No compiler or node binary is downloaded at test runtime.

## Source layout

| File | Responsibility |
|---|---|
| `src/types.ts` | Intent, record, receipt, and adapter types |
| `src/intent.ts` | Local B-side EIP-712 draft, schema validation, digest, signature recovery |
| `src/api.ts` | HTTP routes and redacted responses |
| `src/store.ts` | SQLite inbox, transaction outbox, attempt/state history, metrics |
| `src/coordinator.ts` | One-at-a-time scheduling, batching, retry, and reconciliation |
| `src/adapters/mock.ts` | Persistent orchestration simulator |
| `src/adapters/evm.ts` | JSON-RPC checks, signing, broadcasting, and receipt decoding |
| `src/adapters/executor-abi.ts` | Provisional executeBatch tuple and event indexing |
| `src/config.ts`, `src/lock.ts`, `src/main.ts` | Configuration, exclusive process ownership, startup/shutdown |
| `test/` | API, state/recovery, configuration, and local EVM tests |
| `test/fixtures/BExecutorFixture.sol` | TEST ONLY: signatures, nonce consumption, and event/rollback transport checks |

## Configuration

`npm run dev` loads a local `.env` if present. `.env` and all runtime data are gitignored. Changing configuration does not migrate an existing experiment: use a new runId for a new coordinator configuration.

| Environment variable | Default | Meaning |
|---|---|---|
| `RELAYER_MODE` | `mock` | `mock` or `evm` |
| `HOST` | `127.0.0.1` | Only loopback values are permitted |
| `PORT` | `3000` | HTTP port |
| `DATABASE_PATH` | `data/relayer.sqlite` | Durable inbox/outbox |
| `MOCK_LEDGER_PATH` | `data/mock-chain.json` | Mock-chain receipt and consumed-nonce ledger |
| `CHAIN_ID` | `31337` | Signing domain and RPC chain identity |
| `EXECUTOR_ADDRESS` | `0x1000000000000000000000000000000000000001` | Signing-domain verifying contract |
| `BATCH_SIZE` | `10` | 1–100 intents per batch; 1 is the single-intent baseline |
| `MAX_WAIT_MS` | `1000` | 0–60000 milliseconds before an eligible small batch is flushed |
| `MAX_ATTEMPTS` | `3` | Maximum distinct transaction attempts after definite reverts |
| `REBROADCAST_AFTER_MS` | `5000` | Minimum interval before retrying identical signed bytes |
| `MAX_BROADCASTS` | `3` | Maximum broadcast calls per signed transaction |
| `MAX_GAS_PER_BATCH` | `5000000` | Gas budget; EVM preparation also enforces its safety margin and block limit |
| `POLL_INTERVAL_MS` | `250` | Worker tick interval |
| `CONFIRMATIONS` | `1` | EVM receipt depth; not a guarantee against later reorganizations |
| `RPC_URL` | unset | Required HTTP(S) RPC URL in EVM mode |
| `RELAYER_PRIVATE_KEY` | unset | Dedicated test relayer key, only in process configuration |
| `EVM_ABI_CONFIRMED` | unset | Must be `true` to enable EVM mode after the team verifies the integration draft |

The domain name is `AgentIntentBatchExecutor`, version `1`. Changing it requires an agreed source change and matching A/C changes. Database identity is bound to mode, domain, and relayer address; incompatible reuse fails. Never reuse an old database after resetting the chain underneath it. Keep the mock ledger and database together across restarts.

The EVM account must be dedicated to this relayer. An external pending transaction blocks signing a new transaction. RPC requests have a ten-second transport timeout. There is no automatic fee replacement, nonce cancellation, cross-process failover, or relayer reimbursement mechanism.

## Request contract

`POST /intents` accepts exactly `intent`, `signature`, and optional `runId`. `runId` defaults to `default`, uses 1–64 letters/digits/underscores/dots/hyphens, and is an experiment label, not authorization.

```json
{
  "runId": "batch-10-trial-1",
  "intent": {
    "owner": "0x5000000000000000000000000000000000000005",
    "agent": "0x6000000000000000000000000000000000000006",
    "token": "0x3000000000000000000000000000000000000003",
    "recipient": "0x4000000000000000000000000000000000000004",
    "amount": "1000000",
    "nonce": "0",
    "epoch": "1",
    "validAfter": "0",
    "deadline": "1800003600"
  },
  "signature": "<real EIP-712 signature by the agent>"
}
```

The example is illustrative and cannot be submitted with the placeholder signature. `scripts/demo.ts` produces valid signed examples. Amounts are token base units. All five uint256 fields must be canonical decimal **strings**, never JavaScript numbers, negative numbers, leading-zero values, or scientific notation. Addresses must be nonzero valid Ethereum addresses. The server supplies the signing domain; callers cannot override it in the request.

The exact TransferIntent EIP-712 field order is defined in `src/intent.ts`: owner, agent, token, recipient, amount, nonce, epoch, validAfter, deadline. The signer must match `agent`. The digest is the intentId. Owner authorization is deferred to the real executor; a recovered signature alone is not delegated authority.

New expired requests return 400. Future requests can queue until validAfter. An existing validly signed intent remains idempotently queryable after expiration. The same digest with a different run label still returns the original record; it does not create a second experiment observation.

## HTTP API

All routes are under the root path. There is no permissive CORS or public access-control layer. Use a local proxy for a local frontend, or agree a narrowly scoped integration before exposing the service elsewhere.

| Method and route | Result |
|---|---|
| `GET /health` | 200 for normal worker status; 503 when the last tick recorded a failure or reconciliation blocker |
| `GET /info` | Mode, EIP-712 domain, sender address, nonsecret configuration |
| `POST /intents` | 202 `{intent,created:true}` after durable insertion; 200 `{intent,created:false}` for an existing digest |
| `GET /intents?runId=...&limit=50&offset=0` | `{intents:[...]}`; optional filter; limit 1–100 |
| `GET /intents/:intentId` | `{intent,events}` with chronological state history |
| `GET /batches?runId=...&limit=50&offset=0` | `{batches:[...]}` |
| `GET /batches/:batchId` | `{batch}` with transaction attempts and receipt evidence |
| `GET /metrics?runId=...` | Per-run cumulative counts, timings, gas, and denominator information |
| `GET /agents?owner=...` | Currently 501: registry query/indexing needs A's actual interface |

Intent responses exclude signatures. Batch responses exclude signed raw transaction bytes. Rejected payloads and private keys are never returned or persisted as rejection evidence. Request bodies are limited to 64 KiB. Lists expose pagination rather than silently truncating an experiment.

Error shape:

```json
{"error":{"code":"NONCE_CONFLICT","message":"This owner, agent, epoch, and nonce are already reserved by another intent."}}
```

Important errors: 400 `INVALID_SCHEMA`, `INVALID_INTEGER`, `INVALID_SIGNATURE`, `INTENT_EXPIRED`; 409 `NONCE_CONFLICT` or `RUN_CONFIG_CHANGED`; 413 `BODY_TOO_LARGE`; 503 `QUEUE_FULL` at 10000 outstanding intents; 501 `UNSUPPORTED` for registry lookup. Unknown internal errors use a generic message and never expose provider exceptions or request contents.

## Queue and batch semantics

Durable intake records `RECEIVED → VALIDATED → QUEUED` in one SQLite transaction. The worker advances eligible work through `BATCHED → SUBMITTED → CONFIRMED`. Other states are `REJECTED`, `EXPIRED`, `FAILED`, and `RECONCILING`. Each transition records a timestamp and batch reference.

SQLite stores intents, batches, state events, rejection fingerprints, run configurations, and environment identity. Each batch represents one signed transaction attempt; all distinct attempts remain available through its batch records and per-intent history. Re-broadcasting identical bytes increments broadcastCount, not intent attemptCount.

The `(owner,agent,epoch,nonce)` tuple stays reserved in the inbox **even after terminal failure**. This is deliberately stricter than reserving only pending requests: off-chain failure cannot revoke a still-valid signature. Submit a fresh nonce or owner-authorized epoch rather than changing the contents of a reserved nonce.

The worker selects eligible intents in durable arrival order and does not mix run IDs in a batch. It tests a growing prefix in execution order. If adding an item makes that prefix fail, the valid prefix is sent first; the remaining item is reconsidered against the new state. An invalid or individually oversized first item is rejected. This permits bounded splitting without assuming that individually affordable transfers are collectively affordable.

Atomic semantics: the entire batch either succeeds or reverts. A definite revert requeues eligible intents, up to MAX_ATTEMPTS. A preflight rejection after an earlier attempt is terminal FAILED; before any attempt it is REJECTED. Funds, permissions, and budget constraints must be enforced by A's contract, including when state changes after simulation.

## Crash recovery and unknown outcomes

1. Prepare and sign without broadcasting.
2. Atomically persist the complete raw transaction, txHash, sender nonce, and batch membership.
3. Persist the broadcast intention and timestamps before the network call.
4. Broadcast; a timeout becomes uncertain rather than failed.
5. Look up the receipt before sending anything else. A successful receipt must prove **every exact intentId** from the configured executor; consumed nonce alone is insufficient.
6. If no receipt exists, re-broadcast only the stored bytes, within the configured limit. This may continue after intent expiry because the original transaction outcome remains unknown.
7. At the limit, keep RECONCILING and block new sending. Continue checking for a later receipt; do not create a new nonce or silently mark success.

There is one process per database, enforced by a local `.lock.pid` file. Graceful SIGINT/SIGTERM releases it. After an abnormal process death, confirm the PID recorded in the file is no longer running before removing **only that stale lock** and restarting. The database and chain ledger must remain intact. Automatic stale-lock stealing is intentionally absent to avoid multiple live senders.

If a receipt contains incomplete/mismatched events, inspect A's deployed ABI and event indexing before taking further action. If a signed transaction was externally replaced, the current version does not search replacement transactions or offer an automatic reset endpoint. Reconcile with the chain manually; never delete the inbox just to unblock a sender that may still pay someone.

`FAILED` stops automatic retries. It does not cancel authorization or the signature. Owner revocation/expiration is an on-chain concern. Acknowledgement before a network call is conservatively counted as an attempt even if the process dies before transmission, because delivery cannot safely be inferred afterward.

## Metrics for E

Metrics are cumulative snapshots from first acceptance to query time. They are instrumentation for E's experiments, not a completed baseline study.

- Throughput: confirmed unique intents / cumulative observation seconds; report the window and unfinished count. Waiting after completion changes this cumulative rate, so E should collect controlled-window raw data for final comparisons.
- End-to-end p50/p95: first durable receipt to confirmation observation, successful intents only.
- Queue p50/p95: first durable receipt to first broadcast intention, all attempted intents.
- After-first-broadcast p50/p95: includes retries and recovery, not just block time.
- Execution failure rate: terminal failed/expired/rejected intents that were attempted / attempted intents. Pending and reconciling requests are reported separately.
- Transaction failure rate: reverted receipts / all acquired receipts. Unknown receipts are separate.
- Gas and fees: all acquired execution receipts, including reverts; registration and allowance costs are excluded.
- Gas per success uses an exact `{numerator,denominator}` pair, avoiding unsafe floating-point conversion. Fees and gas totals are decimal strings.
- Rejected API payloads are deduplicated by a canonical request fingerprint; these are not unique valid intent IDs. No misleading combined rejection percentage is inferred.

Use a new runId when changing batch settings. The store rejects reuse of an experiment label under different metadata. For fair baseline comparison set BATCH_SIZE=1 and MAX_WAIT_MS=0, keep the same node/sender restrictions, and restore equivalent initial state. Mock gas is a synthetic formula (`21000 + 50000 × batch size`); it must never be submitted as measured optimization evidence.

## Known limits and next handoffs

- A's registry, owner policy, token balances, authorization revocation, allowances, and full events require integration; `/agents` remains explicit 501.
- C's shared SDK is not yet available. B's local schema helpers must converge with it using shared fixtures.
- The test executor validates signing/event transport but does not transfer ERC-20 tokens or implement budgets. It must not be deployed as the project executor.
- Single relayer; no distributed queue lease, process failover, gas-price replacement, or automatic recovery of external nonce replacements.
- Confirmation depth is configurable, but there is no rollback of already-confirmed records after a later chain reorganization.
- SQLite history has no retention/archival scheme; metrics read a run's records into memory. This is suitable for the bounded course prototype.
- No real LLM, ERC-4337 claim, public authentication, public-chain benchmark, or production security review.

See `docs/b-handoff.md` for the exact A/C/D/E integration checklist.
