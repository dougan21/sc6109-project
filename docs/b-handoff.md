# Member B integration handoff

Branch: `codex/b-relayer`. Status: implementation for review; no PR until the owner approves.

## A: Contract agreement needed

Confirm the following against the actual contract before setting `EVM_ABI_CONFIRMED=true`:

1. `executeBatch(TransferIntent[] intents, bytes[] signatures)` tuple order: owner, agent, token, recipient, amount, nonce, epoch, validAfter, deadline.
2. EIP-712 name `AgentIntentBatchExecutor`, version `1`, chainId, and verifyingContract. B's intentId is the complete typed-data digest.
3. Event draft: `IntentExecuted(bytes32 indexed intentId, address indexed owner, address indexed agent, address recipient, uint256 amount)`. Confirm **indexed fields**, not just names/types.
4. Atomic revert behavior for invalid signatures, duplicate nonces, expired/revoked epochs, budgets, balances, and allowances.
5. Agent signatures authorize within owner-established policy. The relayer only forwards requests and pays gas.
6. Registry query/agent-enumeration ABI and indexing starting block. B cannot invent this from a single owner query; `/agents` currently returns 501.
7. Deployment manifest: contract address, chainId, ABI/artifact version, starting block, confirmation convention, and test token addresses.

`test/fixtures/BExecutorFixture.sol` exists solely to verify B's provisional ABI transport with real transactions. Its unrestricted fault switch and missing asset/authorization logic are intentional test features, not the contract implementation for A.

Once A's code lands: replace/confirm the ABI, run B's tests, add a real-contract integration test with token balance and budget assertions, then enable EVM mode. A owns fixes to authorization behavior; B owns transaction delivery/state tracking.

## C: Signing and client agreement

- Use the exact EIP-712 field ordering and server domain from `/info`.
- Send `{intent,signature,runId?}`; do not send private keys or a caller-selected domain.
- Serialize amounts and all uint256 fields as decimal strings; token units are base units.
- Nonces must remain unique within `(owner,agent,epoch)`, including after runner restarts. B permanently reserves nonce contents in its inbox; it does not allocate C's nonces.
- Signatures must recover to agent. Owner delegation is enforced separately by A.
- POST 202 means queued; GET intent details until CONFIRMED or an explicit failure/uncertain state. Duplicate valid requests return 200 and the original runId.
- Future validAfter is permitted. Stopping a local schedule does not cancel already queued signatures.

First shared fixture: sign one request in C's SDK; compare digest with B; verify the same digest and signature in A; then execute an actual transfer and assert recipient balance.

## D: Frontend contract

Read `/info`, `/health`, `/intents`, `/intents/:id`, `/batches`, `/batches/:id`, and `/metrics?runId=...`. Lists return `{intents}` or `{batches}`; details return `{intent,events}` or `{batch}`. Limit is 1–100 with an offset.

Display mock mode prominently. Distinguish queued, submitted, confirmed, failed, expired, rejected, and reconciling. RECONCILING is not failure or success and may block later requests. No signature/raw transaction/private key fields are provided to the UI.

Agent management cannot be implemented from B's current 501 registry route alone; coordinate owner interactions and registry reads with A. Keep the development frontend on a local proxy; this backend does not enable arbitrary cross-origin requests or provide Internet-facing authentication.

## E: Experiment contract

- Each intent carries runId, receipt/submit/confirmation timestamps, attempt count, state, error, last batchId, and txHash.
- Intent detail contains state history; the run's batch list retains previous transaction attempts, receipts, gas and fee values.
- Keep mock workflow validation separate from actual-chain performance measurements.
- The service exposes cumulative snapshots. E should implement controlled arrival windows, warm-up/drain handling, seed recording, hardware/chain manifests, balanced initial state, and repeated baseline comparisons.
- Distinct transaction attempts and identical-byte re-broadcast calls differ. API rejection fingerprints differ from valid intent IDs.
- The relayer supports one unresolved transaction at a time. Keep this fixed in both experiment groups and report it.
- Use a new runId after changing configuration. Maintain separate/reset coordinated databases and node snapshots for fair isolated runs; never reset state while transactions are unresolved.
- A successful batch receipt with missing/different intent events halts. Do not count it as success by transaction status alone.

## Joint acceptance gate

- [ ] A/C/B match the domain, tuple, digest, and indexed events.
- [ ] A's actual contract performs authorized token transfers; no test fixture substitutes for it.
- [ ] D distinguishes local simulation, pending, and confirmed states correctly.
- [ ] E reproduces a comparison from raw actual-chain receipts with defined denominators.
- [ ] All members understand atomic failures, durable recovery, and remaining limitations.
- [ ] Owner approves before opening the PR.
