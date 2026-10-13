import test from 'node:test';
import assert from 'node:assert/strict';
import { assertIntentAllowed } from '../src/policy.js';
import { IntentRejected } from '../src/typed-data.js';
import type { PolicySnapshot, TransferIntent } from '../src/types.js';

const policy: PolicySnapshot = {
  owner: '0x0000000000000000000000000000000000000020',
  agent: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  token: '0x0000000000000000000000000000000000000030',
  recipient: '0x0000000000000000000000000000000000000040',
  maxAmountPerIntent: '5',
  totalBudget: '10',
  spent: '4',
  validUntil: '100',
  active: true,
  epoch: '2',
};

function intent(overrides: Partial<TransferIntent> = {}): TransferIntent {
  return {
    owner: policy.owner,
    agent: policy.agent,
    token: policy.token,
    recipient: policy.recipient,
    amount: '5',
    nonce: '0',
    epoch: '2',
    validAfter: '10',
    deadline: '100',
    ...overrides,
  };
}

test('a boundary intent that spends the remaining per-intent limit is allowed', () => {
  assert.doesNotThrow(() => assertIntentAllowed(intent({ amount: '5' }), policy, 100n, 0n));
  assert.doesNotThrow(() => assertIntentAllowed(intent({ amount: '1' }), policy, 100n, 5n));
});

test('policy guardrails reject inactive, expired, mismatched, and over-budget intents', () => {
  const cases: Array<[string, TransferIntent, PolicySnapshot, bigint, bigint]> = [
    ['INACTIVE', intent(), { ...policy, active: false }, 50n, 0n],
    ['POLICY_EXPIRED', intent(), policy, 101n, 0n],
    ['WRONG_EPOCH', intent({ epoch: '1' }), policy, 50n, 0n],
    ['WRONG_RECIPIENT', intent({ recipient: '0x0000000000000000000000000000000000000099' }), policy, 50n, 0n],
    ['AMOUNT_EXCEEDS_LIMIT', intent({ amount: '6' }), policy, 50n, 0n],
    ['BUDGET_EXCEEDED', intent({ amount: '5' }), policy, 50n, 2n],
    ['DEADLINE_AFTER_POLICY', intent({ deadline: '101' }), policy, 50n, 0n],
    ['INTENT_EXPIRED', intent({ deadline: '40' }), policy, 41n, 0n],
    ['INVALID_WINDOW', intent({ validAfter: '90', deadline: '80' }), policy, 50n, 0n],
  ];
  for (const [code, item, snapshot, now, pending] of cases) {
    assert.throws(() => assertIntentAllowed(item, snapshot, now, pending), (error: unknown) => error instanceof IntentRejected && error.code === code, code);
  }
});
