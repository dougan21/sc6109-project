import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HDNodeWallet, TypedDataEncoder, Interface, keccak256 } from 'ethers';
import { domain, types } from './typed-data.mjs';

await mkdir('interfaces', { recursive: true });
const outputs = new Map();
const manifest = { version: 1, status: 'frozen', compiler: '0.8.30', evmVersion: 'cancun', optimizerRuns: 200, contracts: {} };
for (const name of ['AgentIntentExecutor', 'MockToken']) {
  const artifact = JSON.parse(await readFile(`contracts/out/${name}.sol/${name}.json`, 'utf8'));
  const abi = JSON.stringify(artifact.abi, null, 2) + '\n';
  outputs.set(`interfaces/${name}.json`, abi);
  const iface = new Interface(artifact.abi);
  manifest.contracts[name] = {
    abiSha256: createHash('sha256').update(abi).digest('hex'),
    creationBytecodeHash: keccak256(artifact.bytecode.object),
    functions: Object.fromEntries(iface.fragments.filter(f => f.type === 'function').map(f => [f.format('sighash'), iface.getFunction(f.format('sighash')).selector])),
    events: Object.fromEntries(iface.fragments.filter(f => f.type === 'event').map(f => [f.format('sighash'), iface.getEvent(f.format('sighash')).topicHash])),
  };
}
const agent = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, "m/44'/60'/0'/0/1");
const signingDomain = domain('31337', '0x0000000000000000000000000000000000000010');
const intent = {
  owner: '0x0000000000000000000000000000000000000020', agent: agent.address,
  token: '0x0000000000000000000000000000000000000030',
  recipient: '0x0000000000000000000000000000000000000040',
  amount: '1000000000000000000', nonce: '7', epoch: '1', validAfter: '1000', deadline: '2000',
};
outputs.set('interfaces/signing-fixture.json', JSON.stringify({
  description: 'Static encoding fixture; placeholder addresses, not a live authorization.',
  domain: signingDomain, types, intent,
  digest: TypedDataEncoder.hash(signingDomain, types, intent),
  signature: await agent.signTypedData(signingDomain, types, intent),
}, null, 2) + '\n');
manifest.signingFixtureSha256 = createHash('sha256').update(outputs.get('interfaces/signing-fixture.json')).digest('hex');
outputs.set('interfaces/freeze.json', JSON.stringify(manifest, null, 2) + '\n');
for (const [path, content] of outputs) {
  if (process.argv.includes('--check')) assert.equal(await readFile(path, 'utf8'), content, `Frozen interface drift: ${path}`);
  else await writeFile(path, content);
}
console.log(process.argv.includes('--check') ? 'Frozen ABI, bytecode, event topics and signing fixture match.' : 'Exported frozen interfaces and signing fixture.');
