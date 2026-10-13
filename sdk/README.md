# Member C: Agent SDK and scheduled transfers

This package signs transfer intents for the frozen `AgentIntentExecutor` domain and submits them to Member B's relayer. It does not deploy contracts, hold the owner's tokens, or replace the relayer.

## What it enforces

- The EIP-712 type and domain live in `src/typed-data.ts`. The relayer imports `TRANSFER_TYPES` from here. `interfaces/signing-fixture.json` is the shared vector.
- uint256 fields are canonical decimal strings. The signer address must equal `intent.agent`. The private key is never sent to the relayer.
- Nonces are allocated per `(owner, agent, epoch)` in a local SQLite journal. The nonce is committed in the same transaction as the signature.
- Each schedule occurrence is signed at most once. The signature is stored before the HTTP call. A crash or restart submits that same signature again.
- A 4xx rejection is terminal for that occurrence. The agent does not sign a replacement. A second valid signature could still be executed by anyone who obtained it.
- Before signing, the agent checks the policy: active, epoch, token, recipient, per-intent limit, remaining budget, and time window. The deadline cannot extend past `validUntil`. Signatures already stored stay reserved against the budget until the policy's `spent` value catches up.
- The contract checks the same conditions again at execution. The client check is not a substitute.

## Policy sources

| Source | Use |
| --- | --- |
| `contractPolicySource` | `getAgentPolicy` on a deployed executor |
| `relayerPolicySource` | `GET /agents` in EVM mode |
| `staticPolicySource` | Tests and the mock demo only. It is not on-chain authorization, and its `spent` field does not move unless the caller replaces it |

Mock mode returns 501 for `/agents`. Do not treat the static demo policy as a grant of authority.

## Run

From the repository root, with Node 22:

```bash
npm test
npm run dev
npm run demo:agent
```

`demo:agent` refuses EVM mode. It creates an ephemeral agent key in memory, signs four due occurrences, and waits for mock confirmation. The journal is `data/agent-<timestamp>.sqlite`, which is gitignored. The command prints addresses and intent ids. It does not print the key or the signatures.

A schedule is a JSON object with `id`, `owner`, `token`, `recipient`, `amount` (base units), `intervalSec`, `startAt` (unix seconds), `count`, and `windowSec`. Occurrence `i` may be signed only while `startAt + i * intervalSec <= now <=` that time plus `windowSec`. A missed window is recorded as `SKIPPED` and is not signed late.

## Limits

- One process should own a journal file. The schedule does not cancel a signature that has already left the process. Revoke the on-chain agent to stop old-epoch execution.
- Frequency is not enforced by the contract. The journal enforces it only for occurrences this process signs.
- Failed, rejected, and expired signatures remain reserved in the local budget so later occurrences cannot exceed the policy. A new owner configuration starts a new epoch and a fresh budget.
- There is no LLM planner, MCP server, or production key store. The agent executes a registered schedule inside the owner's policy.
