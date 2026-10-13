# Member C development record

Date: 2026-10-13. Scope is the agent SDK and scheduled transfer agent. Contracts, the relayer, the frontend, and the performance study were left to their owners.

## Instructions given to the coding agent

- Implement only section C against the repository at `dougan21/sc6109-project`.
- Sign the frozen `TransferIntent` type and `AgentIntentExecutor` version 1 domain. Do not change the contract or the ABI freeze.
- Allocate unique nonces per owner, agent, and epoch, including across restarts.
- Submit `{intent, signature, runId}` to the existing relayer. Do not send a private key or a caller-selected domain.
- Sign each schedule occurrence at most once, and store the signature before submitting it.
- Check the owner policy before signing. Keep the contract as the final check.
- Keep the mock demo explicit about the fact that it does not move tokens.

## Design choices

Accepted:

- One `TRANSFER_TYPES` object in `sdk/src/typed-data.ts`, imported by the relayer, compared with `interfaces/signing-fixture.json`.
- A SQLite journal that commits the nonce and the signature in one transaction.
- Deadline capped at `policy.validUntil`.
- Stored signatures remain reserved against the local budget after failure, so a later occurrence cannot exceed the policy.
- Static policy only for mock mode, because `GET /agents` returns 501 there.

Rejected:

- Signing a replacement after a 4xx response. A second signature can still be valid.
- Treating mock gas or mock latency as a performance result.
- Adding an LLM planner or an MCP server. The agreed agent is a scheduled signer inside an owner policy.

## Checks

On Node 22.18.0, `npm run test:sdk` passed 11 tests:

- The SDK digest and signature equal `interfaces/signing-fixture.json`, and the relayer uses the same type object.
- Policy boundaries and rejections, including an exact remaining budget and a deadline equal to `validUntil`.
- A restart resubmits one stored signature. A missed window is skipped. An inactive policy and a second over-budget occurrence do not sign. A nonce conflict is not signed again.
- Two scheduled intents are accepted by the relayer API and reach `CONFIRMED` under its coordinator.
- On a local Anvil node, one SDK-signed transfer moved 1000 base units, `spent` became 1000, a replay was rejected, and an over-limit intent was rejected both by the guardrail and by the executor.

`npx tsc --noEmit` passed. `npm run test:relayer` passed 27 tests after the relayer started importing `TRANSFER_TYPES` from the SDK. `npm run demo:agent` against `npm run dev` confirmed four mock intents in one batch. That gas figure is simulated. The contract suite was not re-run because no contract file changed.

## Limits to explain

Stopping the agent does not revoke a signature. The contract does not enforce the schedule frequency. The mock demo is not an authorization or a gas measurement. See `docs/c-handoff.md` and `docs/decisions.md` D-011.
