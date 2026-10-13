import { getAddress } from 'ethers';
import type { PolicySnapshot, TransferIntent } from './types.js';
import { IntentRejected, uint256 } from './typed-data.js';

/**
 * Client-side guardrail. The contract repeats these checks at execution.
 * deadline is capped by the caller to policy.validUntil so a schedule window cannot outlive the authorization.
 */
export function assertIntentAllowed(intent: TransferIntent, policy: PolicySnapshot, nowSec: bigint, pendingSpend: bigint = 0n): void {
  if (pendingSpend < 0n) throw new IntentRejected('INVALID_INTEGER', 'Pending spend cannot be negative.');
  if (!policy.active) throw new IntentRejected('INACTIVE', 'The agent policy is not active.');
  const validUntil = uint256(policy.validUntil, 'validUntil');
  if (nowSec < 0n) throw new IntentRejected('INVALID_WINDOW', 'Current time is invalid.');
  if (nowSec > BigInt(validUntil)) throw new IntentRejected('POLICY_EXPIRED', 'The agent policy has expired.');
  if (getAddress(intent.owner) !== getAddress(policy.owner)) throw new IntentRejected('WRONG_OWNER', 'Intent owner does not match the policy.');
  if (getAddress(intent.agent) !== getAddress(policy.agent)) throw new IntentRejected('WRONG_AGENT', 'Intent agent does not match the policy.');
  if (getAddress(intent.token) !== getAddress(policy.token)) throw new IntentRejected('WRONG_TOKEN', 'Intent token is outside the policy.');
  if (getAddress(intent.recipient) !== getAddress(policy.recipient)) throw new IntentRejected('WRONG_RECIPIENT', 'Intent recipient is outside the policy.');
  if (uint256(intent.epoch, 'epoch') !== uint256(policy.epoch, 'epoch')) {
    throw new IntentRejected('WRONG_EPOCH', 'Intent epoch does not match the current authorization.');
  }
  const amount = BigInt(uint256(intent.amount, 'amount'));
  if (amount === 0n) throw new IntentRejected('INVALID_AMOUNT', 'Transfer amount must be greater than zero.');
  if (amount > BigInt(uint256(policy.maxAmountPerIntent, 'maxAmountPerIntent'))) {
    throw new IntentRejected('AMOUNT_EXCEEDS_LIMIT', 'Amount exceeds the per-intent limit.');
  }
  const budget = BigInt(uint256(policy.totalBudget, 'totalBudget'));
  const spent = BigInt(uint256(policy.spent, 'spent'));
  if (spent > budget || pendingSpend > budget - spent || amount > budget - spent - pendingSpend) {
    throw new IntentRejected('BUDGET_EXCEEDED', 'Amount exceeds the remaining budget, including signatures already created.');
  }
  const validAfter = BigInt(uint256(intent.validAfter, 'validAfter'));
  const deadline = BigInt(uint256(intent.deadline, 'deadline'));
  if (validAfter > deadline) throw new IntentRejected('INVALID_WINDOW', 'validAfter must not be later than deadline.');
  if (deadline > BigInt(validUntil)) {
    throw new IntentRejected('DEADLINE_AFTER_POLICY', 'deadline must not extend past the policy expiration.');
  }
  if (nowSec > deadline) throw new IntentRejected('INTENT_EXPIRED', 'The intent window has already ended.');
}

/** Use the earlier of the schedule window and the on-chain authorization expiry. */
export function cappedDeadline(windowEndSec: number, validUntil: string): bigint {
  if (!Number.isSafeInteger(windowEndSec) || windowEndSec < 0) {
    throw new IntentRejected('INVALID_WINDOW', 'Schedule window end is invalid.');
  }
  const until = BigInt(uint256(validUntil, 'validUntil'));
  const end = BigInt(windowEndSec);
  return end < until ? end : until;
}
