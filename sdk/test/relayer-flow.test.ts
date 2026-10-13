import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { buildApi } from '../../services/relayer/src/api.js';
import { BASE_TIME, DOMAIN, harness } from '../../services/relayer/test/helpers.js';
import { ScheduledTransferAgent } from '../src/agent.js';
import { AgentJournal } from '../src/journal.js';
import { staticPolicySource } from '../src/policy-source.js';
import { RelayerClient } from '../src/relayer-client.js';

test('scheduled signatures are accepted by the relayer and confirmed by its coordinator', async () => {
  const setup = harness();
  const journal = new AgentJournal(':memory:');
  const app = buildApi({ store: setup.store, gateway: setup.gateway, coordinator: setup.coordinator, clock: setup.clock });
  const signer = Wallet.createRandom();
  const owner = Wallet.createRandom().address;
  const now = BASE_TIME / 1000;
  const token = '0x3000000000000000000000000000000000000003';
  const recipient = '0x4000000000000000000000000000000000000004';
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('The test relayer did not bind a port.');
    const client = new RelayerClient(`http://127.0.0.1:${address.port}`);
    const agent = new ScheduledTransferAgent({
      signer,
      domain: DOMAIN,
      policies: staticPolicySource({
        owner, agent: signer.address, token, recipient, maxAmountPerIntent: '1000000', totalBudget: '2000000',
        spent: '0', validUntil: String(now + 10_000), active: true, epoch: '1',
      }),
      submitter: client,
      journal,
      nowSec: () => now,
    });
    agent.register({ id: 'batch', owner, token, recipient, amount: '1000000', intervalSec: 1, startAt: now - 5, count: 2, windowSec: 3_600 });
    const queued = await agent.tick('sdk-flow');
    assert.equal(queued.length, 2);
    assert.ok(queued.every((item) => item.state === 'QUEUED' && item.intentId));
    for (let n = 0; n < 10 && setup.store.listIntents().some((item) => item.state !== 'CONFIRMED'); n += 1) await setup.coordinator.tick();
    const confirmed = await agent.tick('sdk-flow');
    assert.equal(confirmed.length, 2);
    assert.ok(confirmed.every((item) => item.state === 'CONFIRMED'));
    assert.deepEqual(setup.store.listIntents().map((item) => item.intentId).sort(), confirmed.map((item) => item.intentId).sort());
    assert.equal((await agent.tick('sdk-flow')).length, 0);
    const info = await client.info();
    assert.equal(info.mode, 'mock');
    assert.equal(info.domain.verifyingContract, DOMAIN.verifyingContract);
  } finally {
    await app.close();
    journal.close();
    setup.cleanup();
  }
});
