import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { HDNodeWallet, TypedDataEncoder } from 'ethers';
import { domain, types } from './typed-data.mjs';

await mkdir('interfaces', { recursive: true });
for (const name of ['AgentIntentExecutor', 'MockToken']) {
  const artifact = JSON.parse(await readFile(`contracts/out/${name}.sol/${name}.json`, 'utf8'));
  await writeFile(`interfaces/${name}.json`, JSON.stringify(artifact.abi, null, 2) + '\n');
}
const agent = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, "m/44'/60'/0'/0/1");
const signingDomain = domain('31337', '0x0000000000000000000000000000000000000010');
const intent = {
  owner: '0x0000000000000000000000000000000000000020', agent: agent.address,
  token: '0x0000000000000000000000000000000000000030',
  recipient: '0x0000000000000000000000000000000000000040',
  amount: '1000000000000000000', nonce: '7', epoch: '1', validAfter: '1000', deadline: '2000',
};
await writeFile('interfaces/signing-fixture.json', JSON.stringify({
  description: 'Static encoding fixture; placeholder addresses, not a live authorization.',
  domain: signingDomain, types, intent,
  digest: TypedDataEncoder.hash(signingDomain, types, intent),
  signature: await agent.signTypedData(signingDomain, types, intent),
}, null, 2) + '\n');
console.log('Exported ABI and deterministic EIP-712 signing fixture.');
