# Authorization and transfer protocol

## Asset flow and authority

Tokens move directly from the owner to the permitted recipient through ERC-20
`transferFrom`. The executor holds no pooled deposits. ERC-20 allowance and an active
agent policy are both required. Only the caller's `(owner, agent)` namespace can be
configured or revoked: neither method accepts an owner argument. A caller may configure
its own policy, but cannot change another address's record.

The policy input is `(token, recipient, maxAmountPerIntent, totalBudget, validUntil)`.
Addresses must be nonzero, the token must have code, the agent must have no deployed
code at configuration, limits must be positive, budget must cover the per-intent
limit, and expiration must be in the future. Signatures use ECDSA EOA recovery;
ERC-1271 contract signatures are not implemented.

Each configuration creates a fresh epoch and zero spending. Every revocation also
advances the epoch, including repeated revocations. Fresh authorization is explicit
owner approval for a fresh budget; it never happens automatically. Old signatures
remain invalid even if the new policy has identical fields. Nonces are independently
consumed by `(owner, agent, epoch, nonce)` and may execute out of numerical order.

## Signing and execution

Domain: `name = AgentIntentExecutor`, `version = 1`, the actual chain ID, and the
executor address as `verifyingContract`. The exact signed type is:

```text
TransferIntent(address owner,address agent,address token,address recipient,uint256 amount,uint256 nonce,uint256 epoch,uint256 validAfter,uint256 deadline)
```

All fields are signed. `hashIntent` is the complete typed-data digest, including domain,
and is the intent identifier. Use decimal strings for JSON uint256 fields; amounts are
token base units (TEST has 18 decimals). `scripts/typed-data.mjs` exports the canonical
ethers type definition. `interfaces/signing-fixture.json` is a deterministic offline
fixture; `deployments/local.json` contains a live fixture checked on-chain by the demo.

At execution, the contract checks active/unexpired authorization, current epoch,
`validAfter <= block.timestamp <= deadline`, permitted token and recipient, a positive
amount within the per-intent limit, available cumulative budget, unused nonce, and
agent signature. Expiration is inclusive at the exact boundary. A deadline beyond the
policy expiration does not extend authority. The relayer may be any address and cannot
alter the signed payload. It pays transaction gas and can choose timing within the
allowed window. No relayer fees are charged by this contract.

Spending and nonce consumption are recorded before the token call. All state-changing
entry points share the reentrancy guard. SafeERC20 handles false and missing return
values; token reverts bubble up. Only standard, non-fee, non-rebasing token behavior is
supported. The executor cannot establish that an arbitrary malicious token actually
honors its balance ledger merely because a call succeeds.

## Atomicity and indexing

The entire batch reverts on any failure. Earlier transfers, allowance changes, spent
increments, nonce use, and events all roll back. Simulate the complete batch in order;
separate per-item simulations cannot establish cumulative budget or allowance validity.
Simulation can become stale before mining, so execution always rechecks the policy.

`AgentConfigured(owner indexed, agent indexed, epoch, policy)` records the new policy.
`AgentRevoked(owner indexed, agent indexed, epoch)` records revocation.
`IntentExecuted(intentId indexed, owner indexed, agent indexed, recipient, amount)`
records each successful intent. The exported ABI is authoritative for tuple layouts,
custom errors, event topics, and OpenZeppelin error types. An indexer should fetch
`getAgentPolicy` for current state and reconcile complete intent IDs from successful
receipts. A consumed nonce alone cannot prove which payload executed.

There is no fixed batch-size cap. Gas limits bound transaction size; callers should
simulate and split oversized batches. A single intent uses the identical entry point
as a multi-intent batch. Empty and mismatched arrays revert.

## Limits

A compromised agent can spend its remaining budget faster than an intended schedule.
The contract enforces signed time windows and budget, not a recurring cadence. Stopping
an off-chain process does not invalidate already signed requests. Revoke authorization
and wait for confirmation to stop old-epoch execution; past transfers are irreversible.
There is no nonce cancellation API, partial-success batch mode, solver marketplace,
smart-account support, or production audit.

Implementation uses the pinned OpenZeppelin 5.4.0 EIP712/ECDSA, SafeERC20, ERC20, and
ReentrancyGuard. References: [cryptography](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography),
[token helpers](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20), and
[Foundry](https://getfoundry.sh/). EIP-712 domain separation does not itself prevent
replay; the consumed mapping provides that protection.

## Version 1 freeze

The current ABI and signing field order are frozen. `interfaces/freeze.json` records
ABI SHA-256 hashes, creation-bytecode hashes, function selectors, event topics and
the static signing fixture hash. Build and run `npm run check:interfaces` to compare
the compiled artifacts against that record without overwriting it. Live deployment
addresses and a contract-verified signing fixture are generated in
`deployments/local.json`; archived acceptance addresses describe a stopped local chain,
not a persistent public deployment.

Future changes to the ABI, domain, authorization semantics or event interpretation
must document their compatibility impact and rationale, update the relevant tests
and fixtures, and explicitly regenerate the freeze. No contract changes were needed
for the final gas review.
