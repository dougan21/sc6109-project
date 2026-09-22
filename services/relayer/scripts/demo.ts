import { Wallet } from 'ethers';
import { TRANSFER_TYPES } from '../src/intent.js';
import type { IntentDomain } from '../src/types.js';

const url = process.env.RELAYER_URL ?? 'http://127.0.0.1:3000';
const infoResponse = await fetch(`${url}/info`);
if (!infoResponse.ok) throw new Error('Start the relayer with npm run dev first.');
const info = await infoResponse.json() as { mode: string; domain: IntentDomain };
if (info.mode !== 'mock') throw new Error('This demonstration is for mock mode only; it does not configure actual owner authorization.');
const signer = Wallet.createRandom();
const owner = Wallet.createRandom().address;
const runId = `demo-${Date.now()}`;
const ids: string[] = [];
for (let n = 0; n < 12; n++) {
  const intent = { owner, agent: signer.address, token: '0x3000000000000000000000000000000000000003',
    recipient: '0x4000000000000000000000000000000000000004', amount: '1000000', nonce: String(n), epoch: '1',
    validAfter: '0', deadline: String(Math.floor(Date.now()/1000) + 120) };
  const signature = await signer.signTypedData(info.domain, TRANSFER_TYPES, intent);
  const response = await fetch(`${url}/intents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent, signature, runId }) });
  if (!response.ok) throw new Error(`Submission failed with HTTP ${response.status}.`);
  const result = await response.json() as { intent: { intentId: string } };
  ids.push(result.intent.intentId);
}
const timeout = Date.now() + 30_000;
let complete = false;
while (Date.now() < timeout) {
  const response = await fetch(`${url}/intents?runId=${runId}&limit=100`);
  const result = await response.json() as { intents: Array<{ state: string }> };
  if (result.intents.length === ids.length && result.intents.every(i => i.state === 'CONFIRMED')) { complete = true; break; }
  if (result.intents.some(i => ['FAILED','REJECTED','EXPIRED'].includes(i.state))) throw new Error('A simulated intent failed. Inspect the API record.');
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!complete) throw new Error('Demo timed out; inspect /health and /intents.');
console.log(JSON.stringify({ simulation: true, runId, intents: ids.length, metrics: await (await fetch(`${url}/metrics?runId=${runId}`)).json() }, null, 2));
