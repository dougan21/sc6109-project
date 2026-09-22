import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { ContractFactory, HDNodeWallet, JsonRpcProvider, TypedDataEncoder, parseEther } from 'ethers';
import { domain, types } from './typed-data.mjs';
import { rpc } from './env.mjs';

// Public Anvil development mnemonic. This script is intentionally local-chain only.
const mnemonic = 'test test test test test test test test test test test junk';
const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
provider.pollingInterval = 100;
try {
  const { chainId } = await provider.getNetwork();
  assert.equal(chainId, 31337n, 'Expected local chain 31337');
  const owner = await provider.getSigner(0);
  const relayer = await provider.getSigner(2);
  const agent = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/1");
  const recipient = await (await provider.getSigner(3)).getAddress();
  const ownerAddress = await owner.getAddress();
  const artifact = async name => JSON.parse(await readFile(`contracts/out/${name}.sol/${name}.json`, 'utf8'));
  const executorArtifact = await artifact('AgentIntentExecutor');
  const tokenArtifact = await artifact('MockToken');
  const deploy = async artifact => {
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode.object, owner).deploy();
    await contract.waitForDeployment();
    return contract;
  };
  const executor = await deploy(executorArtifact);
  const token = await deploy(tokenArtifact);
  const executorAddress = await executor.getAddress();
  const tokenAddress = await token.getAddress();
  const unit = parseEther('1');
  await (await token.mint(ownerAddress, 20n * unit)).wait();
  await (await token.approve(executorAddress, 20n * unit)).wait();
  const now = (await provider.getBlock('latest')).timestamp;
  const policy = [tokenAddress, recipient, unit, 20n * unit, now + 1800];
  await (await executor.configureAgent(agent.address, policy)).wait();
  const signingDomain = domain(chainId, executorAddress);
  const makeIntent = nonce => ({ owner: ownerAddress, agent: agent.address, token: tokenAddress,
    recipient, amount: unit, nonce, epoch: 1n, validAfter: BigInt(now), deadline: BigInt(now + 1200) });
  const intents = [makeIntent(0n), makeIntent(1n)];
  const signatures = await Promise.all(intents.map(item => agent.signTypedData(signingDomain, types, item)));
  const ids = intents.map(item => TypedDataEncoder.hash(signingDomain, types, item));
  for (let i = 0; i < intents.length; i++) assert.equal(await executor.hashIntent(intents[i]), ids[i]);
  const receipt = await (await executor.connect(relayer).executeBatch(intents, signatures)).wait();
  const events = receipt.logs.filter(log => log.address.toLowerCase() === executorAddress.toLowerCase())
    .map(log => executor.interface.parseLog(log)).filter(event => event?.name === 'IntentExecuted');
  assert.deepEqual(events.map(event => event.args.intentId), ids);
  assert.equal(await token.balanceOf(recipient), 2n * unit);
  assert.equal(await token.balanceOf(ownerAddress), 18n * unit);
  assert.equal((await executor.getAgentPolicy(ownerAddress, agent.address)).spent, 2n * unit);
  for (const item of intents) assert.equal(await executor.consumed(ownerAddress, agent.address, 1, item.nonce), true);
  async function rejectsWith(items, sigs, name) {
    try {
      await executor.connect(relayer).executeBatch.staticCall(items, sigs);
      assert.fail(`Expected ${name}`);
    } catch (error) {
      assert.equal(executor.interface.parseError(error.data)?.name, name);
    }
  }
  await rejectsWith([intents[0]], [signatures[0]], 'NonceConsumed');
  const pending = makeIntent(2n);
  const pendingSignature = await agent.signTypedData(signingDomain, types, pending);
  await (await executor.revokeAgent(agent.address)).wait();
  await rejectsWith([pending], [pendingSignature], 'InactiveAuthorization');
  await (await executor.configureAgent(agent.address, policy)).wait();
  await rejectsWith([pending], [pendingSignature], 'WrongEpoch');
  const fresh = { ...pending, epoch: 3n };
  await (await executor.connect(relayer).executeBatch([fresh], [await agent.signTypedData(signingDomain, types, fresh)])).wait();
  assert.equal(await token.balanceOf(recipient), 3n * unit);
  assert.equal((await executor.getAgentPolicy(ownerAddress, agent.address)).spent, unit);
  const encode = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
  await mkdir('deployments', { recursive: true });
  await writeFile('deployments/local.json', encode({ chainId, executor: executorAddress, token: tokenAddress,
    owner: ownerAddress, agent: agent.address, relayer: await relayer.getAddress(), recipient,
    batchTransactionHash: receipt.hash, intentIds: ids, gasUsed: receipt.gasUsed, finalEpoch: 3,
    domain: signingDomain, types, fixture: { intent: intents[0], signature: signatures[0], digest: ids[0] },
    abi: { AgentIntentExecutor: executorArtifact.abi, MockToken: tokenArtifact.abi } }));
  console.log(`Batch confirmed: ${receipt.hash}`);
  console.log(`2 matching events; balances reconciled; replay and revocation rejected; reauthorization executed.`);
  console.log('Deployment addresses, ABI, and verified signing fixture: deployments/local.json');
} finally {
  provider.destroy();
}
