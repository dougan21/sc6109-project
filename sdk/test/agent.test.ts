import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { ScheduledTransferAgent } from '../src/agent.js';
import { AgentJournal } from '../src/journal.js';
import { staticPolicySource } from '../src/policy-source.js';
import { hashIntent, intentDomain, IntentRejected } from '../src/typed-data.js';
import { RelayerError } from '../src/relayer-client.js';
import type { IntentStatus, IntentSubmitter, PolicySnapshot, SubmissionReceipt, TransferIntent } from '../src/types.js';

const domain = intentDomain(31337, '0x1000000000000000000000000000000000000001');
const token = '0x3000000000000000000000000000000000000003';
const recipient = '0x4000000000000000000000000000000000000004';

function policyFor(owner: string, agent: string, overrides: Partial<PolicySnapshot> = {}): PolicySnapshot {
  return {
    owner, agent, token, recipient, maxAmountPerIntent: '5', totalBudget: '5', spent: '0', validUntil: '5000', active: true, epoch: '1', ...overrides,
  };
}

function submitter(): IntentSubmitter & { items: Array<{ intent: TransferIntent; signature: string }>; states: Map<string, IntentStatus> } {
  const items: Array<{ intent: TransferIntent; signature: string }> = [];
  const states = new Map<string, IntentStatus>();
  return {
    items,
    states,
    async submit(signed): Promise<SubmissionReceipt> {
      const intentId = hashIntent(domain, signed.intent);
      items.push(signed);
      const status = { state: 'QUEUED' as const, txHash: null, error: null };
      states.set(intentId, status);
      return { intentId, created: true, state: 'QUEUED' };
    },
    async status(intentId): Promise<IntentStatus> {
      return states.get(intentId) ?? { state: 'QUEUED', txHash: null, error: null };
    },
  };
}

test('a due occurrence is signed once and a restart resubmits the same signature', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sc6109-agent-'));
  const path = join(directory, 'agent.sqlite');
  const signer = Wallet.createRandom();
  const owner = Wallet.createRandom().address;
  let offline = true;
  const seen: Array<{ intent: TransferIntent; signature: string }> = [];
  const flaky: IntentSubmitter = {
    async submit(signed) {
      seen.push({ intent: signed.intent, signature: signed.signature });
      if (offline) throw new RelayerError(0, 'RELAYER_UNREACHABLE', 'down');
      return { intentId: hashIntent(domain, signed.intent), created: true, state: 'QUEUED' };
    },
    async status(): Promise<IntentStatus> { return { state: 'QUEUED', txHash: null, error: null }; },
  };
  let now = 999;
  const first = new AgentJournal(path);
  const agent = new ScheduledTransferAgent({
    signer, domain, policies: staticPolicySource(policyFor(owner, signer.address)), submitter: flaky, journal: first, nowSec: () => now,
  });
  agent.register({ id: 'rent', owner, token, recipient, amount: '5', intervalSec: 10, startAt: 1_000, count: 2, windowSec: 20 });
  assert.deepEqual(await agent.tick('run-1'), []);
  now = 1_000;
  const opened = await agent.tick('run-1');
  assert.equal(opened[0]?.state, 'SIGNED');
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.intent.nonce, '0');
  const intentId = opened[0]?.intentId;
  first.close();

  offline = false;
  const second = new AgentJournal(path);
  const restarted = new ScheduledTransferAgent({
    signer, domain, policies: staticPolicySource(policyFor(owner, signer.address)), submitter: flaky, journal: second, nowSec: () => now,
  });
  const again = await restarted.tick('run-1');
  assert.equal(again[0]?.state, 'QUEUED');
  assert.equal(again[0]?.intentId, intentId);
  assert.equal(seen.length, 2);
  assert.equal(seen[0]?.signature, seen[1]?.signature);
  assert.equal(second.listOccurrences().filter((item) => item.signature).length, 1);
  second.close();
  rmSync(directory, { recursive: true, force: true });
});

test('a missed window is skipped and never signed', async () => {
  const signer = Wallet.createRandom();
  const owner = Wallet.createRandom().address;
  const sent = submitter();
  const journal = new AgentJournal(':memory:');
  const agent = new ScheduledTransferAgent({
    signer, domain, policies: staticPolicySource(policyFor(owner, signer.address)), submitter: sent, journal, nowSec: () => 2_000,
  });
  agent.register({ id: 'late', owner, token, recipient, amount: '5', intervalSec: 10, startAt: 1_000, count: 1, windowSec: 20 });
  const actions = await agent.tick('run-1');
  assert.equal(actions[0]?.state, 'SKIPPED');
  assert.equal(sent.items.length, 0);
  assert.equal((await agent.tick('run-1')).length, 0);
  journal.close();
});

test('an inactive policy and a second signature over the budget do not sign', async () => {
  const signer = Wallet.createRandom();
  const owner = Wallet.createRandom().address;
  const sent = submitter();
  const journal = new AgentJournal(':memory:');
  let snapshot = policyFor(owner, signer.address, { active: false });
  const agent = new ScheduledTransferAgent({
    signer, domain, policies: staticPolicySource(snapshot), submitter: sent, journal, nowSec: () => 1_100,
  });
  // staticPolicySource captured the object. Mutating snapshot.active is visible if the source returns the same object.
  agent.register({ id: 'budget', owner, token, recipient, amount: '5', intervalSec: 1, startAt: 1_000, count: 2, windowSec: 500 });
  const inactive = await agent.tick('run-1');
  assert.equal(inactive[0]?.state, 'BLOCKED');
  assert.match(inactive[0]?.reason ?? '', /INACTIVE/);
  assert.equal(sent.items.length, 0);
  snapshot.active = true;
  const first = await agent.tick('run-1');
  assert.equal(first[0]?.state, 'QUEUED');
  const second = await agent.tick('run-1');
  assert.equal(second.find((item) => item.index === 1)?.state, 'BLOCKED');
  assert.match(second.find((item) => item.index === 1)?.reason ?? '', /BUDGET_EXCEEDED/);
  assert.equal(sent.items.length, 1);
  journal.close();
});

test('a changed schedule id is rejected and a permanent relayer rejection is not signed again', async () => {
  const signer = Wallet.createRandom();
  const owner = Wallet.createRandom().address;
  const journal = new AgentJournal(':memory:');
  const agent = new ScheduledTransferAgent({
    signer,
    domain,
    policies: staticPolicySource(policyFor(owner, signer.address, { totalBudget: '10', maxAmountPerIntent: '5' })),
    submitter: {
      async submit() { throw new RelayerError(409, 'NONCE_CONFLICT', 'reserved'); },
      async status(): Promise<IntentStatus> { return { state: 'QUEUED', txHash: null, error: null }; },
    },
    journal,
    nowSec: () => 1_100,
  });
  const spec = { id: 'once', owner, token, recipient, amount: '5', intervalSec: 1, startAt: 1_000, count: 1, windowSec: 500 };
  agent.register(spec);
  assert.throws(() => agent.register({ ...spec, amount: '4' }), (error: unknown) => error instanceof IntentRejected && error.code === 'SCHEDULE_CONFLICT');
  const failed = await agent.tick('run-1');
  assert.equal(failed[0]?.state, 'FAILED');
  assert.equal((await agent.tick('run-1')).length, 0);
  assert.equal(journal.listOccurrences().length, 1);
  journal.close();
});
