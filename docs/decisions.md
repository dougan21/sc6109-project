# Decision log

Significant interface and design decisions, newest last. Each entry records what was
decided, why, and what it affects. Changes to the ABI, signing fields, state enums or
metrics must add an entry here and notify the affected owners (plan §9.7).

| ID | Date | Owner | Area |
| --- | --- | --- | --- |
| D-001 | 2026-09-22 | A | One executor contract |
| D-002 | 2026-09-22 | A | Caller-scoped authorization and epochs |
| D-003 | 2026-09-22 | A | Unordered nonces per authorization version |
| D-004 | 2026-09-22 | A | EIP-712 domain and intent identifier |
| D-005 | 2026-09-22 | A | Atomic batches |
| D-006 | 2026-09-22 | A | EOA agents and standard tokens only |
| D-007 | 2026-09-22 | A | Interface v1 freeze |
| D-008 | 2026-09-28 | A/B | Relayer adopts the contract domain and frozen ABI |
| D-009 | 2026-09-28 | A/B | `GET /agents` reads policies via events |
| D-010 | 2026-09-28 | A/B | Relayer EVM tests use the real executor |

## D-001 One executor contract

`AgentIntentExecutor` combines authorization management, signature checks, replay
protection and batch execution. Tokens move directly owner → recipient through
`transferFrom`; the executor holds no pooled funds. This follows plan §6.1 and keeps
integration to one address and one ABI.

## D-002 Caller-scoped authorization and epochs

Authorizations are keyed by `(owner, agent)`. `configureAgent` and `revokeAgent` take no
owner argument, so a caller can only change its own policy. Every configuration and
every revocation increments `epoch`; configuration also resets `spent` to zero as an
explicit new approval. Old-epoch signatures never become valid again, even under an
identical policy. See `docs/protocol.md`.

## D-003 Unordered nonces per authorization version

Replay state is `consumed[owner][agent][epoch][nonce]`. Nonces may execute in any order,
so one stuck intent does not block later ones. The SDK allocates unique nonces within
an epoch; the relayer additionally reserves each `(owner, agent, epoch, nonce)` in its
inbox, even after terminal failure.

## D-004 EIP-712 domain and intent identifier

Domain `name = AgentIntentExecutor`, `version = 1`, the chain ID, and the executor
address. All nine `TransferIntent` fields are signed, in the order in
`scripts/typed-data.mjs`. `intentId` is the full typed-data digest returned by
`hashIntent` and emitted in `IntentExecuted`; database row IDs are never identifiers.
uint256 values travel as decimal strings in JSON.

## D-005 Atomic batches

Any failing item reverts the whole batch, including earlier transfers, `spent`, nonce
consumption and events. There is no partial-success mode. Callers simulate the complete
batch in order and split by gas budget; the contract rechecks everything at execution.

## D-006 EOA agents and standard tokens only

Agent signatures are recovered with ECDSA; ERC-1271 contract signers are out of scope,
and `configureAgent` rejects agents with code. Only standard non-fee, non-rebasing
ERC-20s are supported; SafeERC20 handles missing and false return values.

## D-007 Interface v1 freeze

The ABI, event topics, function selectors, creation bytecode and signing fixture are
recorded in `interfaces/freeze.json`. `npm run check:interfaces` detects drift. A change
requires a new entry here, updated tests and fixtures, and an explicit regeneration.

## D-008 Relayer adopts the contract domain and frozen ABI

The relayer previously signed for a provisional `AgentIntentBatchExecutor` domain and a
hand-written ABI, gated behind `EVM_ABI_CONFIRMED`. It now uses the contract's
`AgentIntentExecutor` domain (D-004) and loads its ABI from
`interfaces/AgentIntentExecutor.json`. The `EVM_ABI_CONFIRMED` switch is removed; EVM
mode instead requires an explicit, non-placeholder `EXECUTOR_ADDRESS`. A relayer test
checks its signing types and domain against `interfaces/signing-fixture.json` and its
ABI against the frozen export, so future drift fails CI. No contract change: the tuple
order and indexed event fields already matched.

Affects B (service configuration) and C (the SDK must sign for this domain). Existing
relayer databases are bound to the old domain and must be replaced, not reused.

## D-009 `GET /agents` reads policies via events

The frozen contract has no agent enumeration, and adding one would break D-007. The EVM
adapter scans the owner's `AgentConfigured` events from `AGENT_INDEX_FROM_BLOCK`, then
reads each `getAgentPolicy` at one pinned block, returning that `blockNumber` as index
freshness. Revoked and expired policies remain listed. Mock mode still returns 501
rather than inventing policies. Scanning from block 0 is acceptable for the local chain;
a long-lived chain should set the deployment block.

Affects D (authorization view) and B (API shape: `{owner, blockNumber,
indexedFromBlock, agents}`).

## D-010 Relayer EVM tests use the real executor

B's test-only `BExecutorFixture.sol` is removed. The relayer EVM test deploys the Forge
build of `AgentIntentExecutor` and `MockToken`, first checking their bytecode hashes
against `interfaces/freeze.json`. It asserts real token balances, `spent`, consumed
nonces, atomic preflight rejection, and a genuine reverted receipt when the owner
revokes after the transaction is prepared. The fixture's `solc` compiler dependency is
removed. The relayer tests therefore need `npm run build` first; `npm test` already runs
the contract suite, which builds, before the relayer suite.
