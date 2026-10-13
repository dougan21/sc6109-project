import { getAddress, TypedDataEncoder, ZeroAddress, type TypedDataDomain, type TypedDataField } from 'ethers';
import type { SignedTransfer, TransferIntent } from './types.js';

/** Must stay aligned with contracts/src/AgentIntentExecutor.sol and scripts/typed-data.mjs. */
export const DOMAIN_NAME = 'AgentIntentExecutor';
export const DOMAIN_VERSION = '1';

export const TRANSFER_TYPES: Record<string, TypedDataField[]> = {
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

const UINT256_MAX = (1n << 256n) - 1n;
const ADDRESS_FIELDS = ['owner', 'agent', 'token', 'recipient'] as const;
const INTEGER_FIELDS = ['amount', 'nonce', 'epoch', 'validAfter', 'deadline'] as const;

export class IntentRejected extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'IntentRejected';
  }
}

export function uint256(value: unknown, label = 'Integer field'): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > UINT256_MAX) {
    throw new IntentRejected('INVALID_INTEGER', `${label} must be a canonical decimal string within uint256 range.`);
  }
  return value;
}

export function address(value: unknown, label = 'Address'): string {
  try {
    if (typeof value !== 'string') throw new Error('invalid');
    const parsed = getAddress(value);
    if (parsed === ZeroAddress) throw new Error('zero');
    return parsed;
  } catch {
    throw new IntentRejected('INVALID_ADDRESS', `${label} must be a valid nonzero Ethereum address.`);
  }
}

export function normalizeIntent(value: TransferIntent): TransferIntent {
  const intent = {} as TransferIntent;
  for (const key of ADDRESS_FIELDS) intent[key] = address(value[key], key);
  for (const key of INTEGER_FIELDS) intent[key] = uint256(value[key], key);
  if (BigInt(intent.amount) === 0n) throw new IntentRejected('INVALID_AMOUNT', 'Transfer amount must be greater than zero.');
  if (BigInt(intent.validAfter) > BigInt(intent.deadline)) {
    throw new IntentRejected('INVALID_WINDOW', 'validAfter must not be later than deadline.');
  }
  return intent;
}

export function intentDomain(chainId: number, verifyingContract: string): TypedDataDomain {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new IntentRejected('INVALID_DOMAIN', 'chainId must be a positive safe integer.');
  }
  return { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId, verifyingContract: address(verifyingContract, 'verifyingContract') };
}

export function assertExecutorDomain(domain: TypedDataDomain): void {
  if (domain.name !== DOMAIN_NAME || domain.version !== DOMAIN_VERSION) {
    throw new IntentRejected('WRONG_DOMAIN', `Signatures must use ${DOMAIN_NAME} version ${DOMAIN_VERSION}.`);
  }
  address(domain.verifyingContract, 'verifyingContract');
}

/** Full EIP-712 digest. This is the intent id the contract returns from hashIntent. */
export function hashIntent(domain: TypedDataDomain, intent: TransferIntent): string {
  assertExecutorDomain(domain);
  return TypedDataEncoder.hash(domain, TRANSFER_TYPES, normalizeIntent(intent)).toLowerCase();
}

export interface IntentSigner {
  readonly address: string;
  signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, unknown>): Promise<string>;
}

export async function signIntent(signer: IntentSigner, domain: TypedDataDomain, intent: TransferIntent): Promise<SignedTransfer> {
  const normalized = normalizeIntent(intent);
  if (getAddress(signer.address) !== normalized.agent) {
    throw new IntentRejected('SIGNER_MISMATCH', 'The signer address must equal intent.agent.');
  }
  const signature = await signer.signTypedData(domain, TRANSFER_TYPES, { ...normalized });
  return { intent: normalized, signature, intentId: hashIntent(domain, normalized) };
}
