import { Wallet, type TypedDataDomain } from 'ethers';
import { ScheduledTransferAgent } from '../src/agent.js';
import { AgentJournal } from '../src/journal.js';
import { staticPolicySource } from '../src/policy-source.js';
import { RelayerClient } from '../src/relayer-client.js';
import { assertExecutorDomain } from '../src/typed-data.js';

const url = process.env.RELAYER_URL ?? 'http://127.0.0.1:3000';
const client = new RelayerClient(url);
let info;
try {
  info = await client.info();
} catch {
  throw new Error('Start the relayer with npm run dev first.');
}
if (info.mode !== 'mock') {
  throw new Error('demo:agent is for mock mode only. It uses an explicit static policy and does not move tokens or configure an owner authorization.');
}
assertExecutorDomain(info.domain as TypedDataDomain);

const signer = Wallet.createRandom();
const owner = Wallet.createRandom();
const now = Math.floor(Date.now() / 1000);
const runId = `agent-${now}`;
const token = '0x3000000000000000000000000000000000000003';
const recipient = '0x4000000000000000000000000000000000000004';
const journal = new AgentJournal(`data/${runId}.sqlite`);
const agent = new ScheduledTransferAgent({
  signer,
  domain: info.domain as TypedDataDomain,
  policies: staticPolicySource({
    owner: owner.address,
    agent: signer.address,
    token,
    recipient,
    maxAmountPerIntent: '1000000',
    totalBudget: '4000000',
    spent: '0',
    validUntil: String(now + 3600),
    active: true,
    epoch: '1',
  }),
  submitter: client,
  journal,
});
agent.register({
  id: 'allowance',
  owner: owner.address,
  token,
  recipient,
  amount: '1000000',
  intervalSec: 1,
  startAt: now - 10,
  count: 4,
  windowSec: 600,
});

const terminal = new Set(['CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED', 'SKIPPED']);
const timeout = Date.now() + 30_000;
let last = await agent.tick(runId);
try {
  let summary = agent.summary();
  while (Date.now() < timeout && !(summary.length === 4 && summary.every((item) => terminal.has(item.state)))) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    last = await agent.tick(runId);
    summary = agent.summary();
  }
  if (summary.length !== 4 || summary.some((item) => !terminal.has(item.state))) {
    throw new Error(`Demo timed out. Last tick: ${JSON.stringify(last)}. Inspect /health and /intents.`);
  }
  const metricsResponse = await fetch(`${url}/metrics?runId=${encodeURIComponent(runId)}`);
  console.log(JSON.stringify({
    simulation: true,
    policySource: 'static-mock',
    runId,
    agent: signer.address,
    owner: owner.address,
    journal: `data/${runId}.sqlite`,
    occurrences: summary,
    metrics: metricsResponse.ok ? await metricsResponse.json() : null,
  }, null, 2));
  if (summary.some((item) => item.state !== 'CONFIRMED')) {
    throw new Error('A scheduled intent was not confirmed. Inspect the relayer record. The local signature was not replaced.');
  }
} finally {
  journal.close();
}
