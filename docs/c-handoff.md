# Member C integration handoff

The SDK is in `sdk/`. Decision D-011 records the signing and scheduling rules. `npm run test:sdk` is the executable check.

## D: What the demo can show

`npm run demo:agent` talks to a relayer started with `npm run dev`. It is mock mode. The page should say that the policy is static and that no tokens move. Occurrence states are `SIGNED` (stored, not yet accepted), then the relayer states `QUEUED`, `BATCHED`, `SUBMITTED`, `RECONCILING`, `CONFIRMED`, `REJECTED`, `EXPIRED`, and `FAILED`, plus local `SKIPPED` when the window passed with no signature. `BLOCKED` is not stored. The next tick tries again until the window ends.

Do not expect the SDK response to contain a private key or a signature. The journal file does contain signatures, because a restart must resubmit the same one. Keep that file local.

For an EVM demo, read the policy with `contractPolicySource` or `GET /agents` after the owner has configured the agent and approved the token. The mock demo does not do those steps.

## E: What is and is not a measurement

The SDK demo and `sdk/test/relayer-flow.test.ts` use the mock adapter. Their gas and latency are not chain measurements. `sdk/test/chain.test.ts` executes one SDK-signed transfer on a local Anvil node and checks the recipient balance, spent budget, replay rejection, and an over-limit intent. It is a correctness check, not the batch comparison. Use the relayer's `runId` metrics and raw receipts for the performance runs, with the SDK as the signer.

Use a new journal and a new `runId` when the schedule or the executor changes. Nonces from an old epoch are not reused. The relayer still reserves a nonce after a terminal failure, and the SDK will not sign a second payload for an occurrence it has already signed.
