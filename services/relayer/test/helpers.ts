import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { normalizeSubmission, TRANSFER_TYPES } from '../src/intent.js';
import { MockGateway } from '../src/adapters/mock.js';
import { Store } from '../src/store.js';
import { Coordinator, DEFAULT_COORDINATOR_OPTIONS } from '../src/coordinator.js';
import type { IntentDomain, TransferIntent } from '../src/types.js';

export const DOMAIN: IntentDomain = { name: 'AgentIntentBatchExecutor', version: '1', chainId: 31337,
  verifyingContract: '0x1000000000000000000000000000000000000001' };
export const signer = Wallet.createRandom();
export const BASE_TIME = 1_800_000_000_000;
export async function signed(nonce = '0', overrides: Partial<TransferIntent> = {}, domain: IntentDomain = DOMAIN) {
  const intent: TransferIntent = { owner: '0x5000000000000000000000000000000000000005', agent: signer.address,
    token: '0x3000000000000000000000000000000000000003', recipient: '0x4000000000000000000000000000000000000004',
    amount: '1000000', nonce, epoch: '1', validAfter: '0', deadline: String(BASE_TIME/1000 + 3600), ...overrides };
  return { intent, signature: await signer.signTypedData(domain, TRANSFER_TYPES, intent), runId: 'test' };
}
export async function normalized(nonce = '0', overrides: Partial<TransferIntent> = {}) {
  return normalizeSubmission(await signed(nonce, overrides), DOMAIN, BASE_TIME);
}
export function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'sc6109-relayer-'));
  let now = BASE_TIME;
  const clock = () => now;
  const gateway = new MockGateway({ domain: DOMAIN, ledgerPath: join(directory, 'chain.json'), clock });
  const metadata = { mode: gateway.mode, domain: DOMAIN, relayerAddress: gateway.relayerAddress };
  const databasePath = join(directory, 'queue.sqlite');
  const store = new Store(databasePath, metadata);
  const coordinator = new Coordinator(store, gateway, { ...DEFAULT_COORDINATOR_OPTIONS, batchSize: 2, maxWaitMs: 1000, rebroadcastAfterMs: 100 }, clock);
  return { directory, databasePath, metadata, store, gateway, coordinator, clock,
    advance: (ms: number) => { now += ms; }, cleanup: () => { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
