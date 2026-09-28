# Security demonstration

Run `npm ci`, `npm run build`, then `npm run verify:local`. This starts an isolated
local chain, performs the demonstration below, writes a deployment manifest and gas
evidence, and shuts the chain down. To inspect a live deployment instead, start
`npm run chain` in one terminal and run `npm run demo` in another.

1. Explain the asset boundary: 20 TEST are minted to the owner; a bounded ERC-20
   allowance lets the executor move tokens only when the independent policy and
   agent signature checks pass. The executor has no token pool.
2. Show the two-intent receipt and its two `IntentExecuted` events. The demo checks
   each event's full digest against the ethers-signed payload, a 2 TEST recipient
   balance, an 18 TEST owner balance, spent of 2 TEST, and both consumed nonces.
3. Forward the first signed intent again. The demo simulates that request and asserts
   `NonceConsumed`; it cannot debit the owner twice. This rejection uses `eth_call`
   and does not claim a mined failed transaction.
4. Sign a pending request, revoke authority with an actual transaction, and simulate
   the pending request. It must fail with `InactiveAuthorization`.
5. Authorize again, producing epoch 3 and a fresh explicit budget. The old pending
   request must fail with `WrongEpoch`. Sign its replacement at epoch 3 and execute
   it successfully; the recipient now has 3 TEST total and the current budget has
   spent 1 TEST.
6. Explain atomic failure: `npm test` includes an earlier valid transfer followed by
   a failing item, and verifies that balances, spending and nonce consumption roll
   back. A relayer must simulate the whole batch, then handle a mined revert as a
   failure of every item. A successful simulation is not permission to bypass the
   execution-time checks.

The local scheduler is not part of this demonstration. The contract does not enforce
transfer frequency; an authorized signer can spend its remaining budget sooner than
intended. Revocation prevents future old-epoch execution once mined, and cannot undo
past transfers. Stopping an off-chain process alone does not invalidate signatures.
