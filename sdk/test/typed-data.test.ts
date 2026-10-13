import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HDNodeWallet, Wallet } from 'ethers';
import { TRANSFER_TYPES as relayerTypes } from '../../services/relayer/src/intent.js';
import { hashIntent, IntentRejected, signIntent, TRANSFER_TYPES } from '../src/typed-data.js';
import type { TransferIntent } from '../src/types.js';

const fixture = JSON.parse(readFileSync(new URL('../../interfaces/signing-fixture.json', import.meta.url), 'utf8')) as {
  domain: { name: string; version: string; chainId: string; verifyingContract: string };
  types: typeof TRANSFER_TYPES;
  intent: TransferIntent;
  digest: string;
  signature: string;
};

test('SDK, relayer, and frozen fixture use one TransferIntent type', () => {
  assert.equal(relayerTypes, TRANSFER_TYPES);
  assert.deepEqual(TRANSFER_TYPES, fixture.types);
  assert.equal(fixture.domain.name, 'AgentIntentExecutor');
  assert.equal(fixture.domain.version, '1');
  assert.equal(hashIntent(fixture.domain, fixture.intent), fixture.digest);
});

test('the public test mnemonic reproduces the frozen signature', async () => {
  // Anvil/Hardhat account m/44'/60'/0'/0/1. Public development key, also used by scripts/export.mjs.
  const signer = HDNodeWallet.fromPhrase(
    'test test test test test test test test test test test junk',
    undefined,
    "m/44'/60'/0'/0/1",
  );
  const signed = await signIntent(signer, fixture.domain, fixture.intent);
  assert.equal(signed.intentId, fixture.digest);
  assert.equal(signed.signature, fixture.signature);
  assert.equal(signed.intent.agent, signer.address);
});

test('schema rejects numbers, leading zeros, zero addresses, and the wrong signer', async () => {
  const signer = Wallet.createRandom();
  const domain = { name: 'AgentIntentExecutor', version: '1', chainId: 31337, verifyingContract: '0x0000000000000000000000000000000000000010' };
  const intent = { ...fixture.intent, agent: signer.address };
  await assert.rejects(() => signIntent(signer, domain, { ...intent, amount: '01' }), (error: unknown) => error instanceof IntentRejected && error.code === 'INVALID_INTEGER');
  await assert.rejects(() => signIntent(signer, domain, { ...intent, amount: 1 as unknown as string }), (error: unknown) => error instanceof IntentRejected && error.code === 'INVALID_INTEGER');
  await assert.rejects(() => signIntent(signer, domain, { ...intent, owner: '0x0000000000000000000000000000000000000000' }), (error: unknown) => error instanceof IntentRejected && error.code === 'INVALID_ADDRESS');
  await assert.rejects(() => signIntent(signer, domain, { ...intent, agent: Wallet.createRandom().address }), (error: unknown) => error instanceof IntentRejected && error.code === 'SIGNER_MISMATCH');
  await assert.rejects(() => signIntent(signer, { ...domain, name: 'Other' }, intent), (error: unknown) => error instanceof IntentRejected && error.code === 'WRONG_DOMAIN');
});
