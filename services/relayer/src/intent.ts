import { getAddress, Signature, TypedDataEncoder, verifyTypedData, ZeroAddress } from 'ethers';
import type { IntentDomain, TransferIntent } from './types.js';

// Local B-side contract draft. A and C must agree this exact type and domain before integration.
export const TRANSFER_TYPES = {
  TransferIntent: [
    { name: 'owner', type: 'address' },
    { name: 'agent', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'epoch', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export class SubmissionError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'SubmissionError';
  }
}

export interface NormalizedSubmission {
  intentId: string;
  intent: TransferIntent;
  signature: string;
  runId: string;
}

const UINT256_MAX = (1n << 256n) - 1n;
const addressFields = ['owner', 'agent', 'token', 'recipient'] as const;
const integerFields = ['amount', 'nonce', 'epoch', 'validAfter', 'deadline'] as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SubmissionError('INVALID_SCHEMA', 'A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))
      || required.some((key) => !Object.hasOwn(value, key))) {
    throw new SubmissionError('INVALID_SCHEMA', 'The request contains missing or unsupported fields.');
  }
}

export function normalizeRunId(value: unknown = 'default'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(value)) {
    throw new SubmissionError('INVALID_RUN_ID', 'runId must contain 1 to 64 letters, digits, dots, underscores, or hyphens.');
  }
  return value;
}

export function normalizeAddress(value: unknown): string {
  try {
    if (typeof value !== 'string') throw new Error('invalid');
    const address = getAddress(value);
    if (address === ZeroAddress) throw new Error('zero');
    return address;
  } catch {
    throw new SubmissionError('INVALID_ADDRESS', 'Addresses must be valid nonzero Ethereum addresses.');
  }
}

function uint256(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)
      || BigInt(value) > UINT256_MAX) {
    throw new SubmissionError('INVALID_INTEGER', 'Integer fields must be canonical decimal strings within uint256 range.');
  }
  return value;
}

/** Schema and signature validation only: check existing IDs before rejecting newly expired requests. */
export function normalizeSubmission(body: unknown, domain: IntentDomain, _nowMs: number): NormalizedSubmission {
  const submission = object(body);
  exactKeys(submission, ['intent', 'signature', 'runId'], ['intent', 'signature']);
  const source = object(submission.intent);
  const fields = [...addressFields, ...integerFields];
  exactKeys(source, fields, fields);
  const intent = {} as TransferIntent;
  for (const key of addressFields) intent[key] = normalizeAddress(source[key]);
  for (const key of integerFields) intent[key] = uint256(source[key]);
  if (BigInt(intent.amount) === 0n) {
    throw new SubmissionError('INVALID_AMOUNT', 'Transfer amount must be greater than zero.');
  }
  if (BigInt(intent.validAfter) > BigInt(intent.deadline)) {
    throw new SubmissionError('INVALID_TIME_WINDOW', 'validAfter must not be later than deadline.');
  }
  const runId = normalizeRunId(submission.runId);
  let signature: string;
  let signer: string;
  let intentId: string;
  try {
    if (typeof submission.signature !== 'string' || !/^0x(?:[a-fA-F0-9]{128}|[a-fA-F0-9]{130})$/.test(submission.signature)) {
      throw new Error('invalid');
    }
    signature = Signature.from(submission.signature).serialized;
    signer = verifyTypedData(domain, TRANSFER_TYPES, intent, signature);
    intentId = TypedDataEncoder.hash(domain, TRANSFER_TYPES, intent);
  } catch {
    throw new SubmissionError('INVALID_SIGNATURE', 'The intent signature is invalid for the configured domain.');
  }
  if (signer !== intent.agent) {
    throw new SubmissionError('INVALID_SIGNATURE', 'The intent must be signed by its agent for the configured domain.');
  }
  return { intentId, intent, signature, runId };
}
