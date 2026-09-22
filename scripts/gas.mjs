import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { ContractFactory, HDNodeWallet, JsonRpcProvider, TypedDataEncoder, parseEther } from 'ethers';
import { domain, types } from './typed-data.mjs';
import { rpc } from './env.mjs';

// Equal workload and identical initial state for every batch size. No timing claims.
const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
provider.pollingInterval = 50;
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
try {
  const { chainId } = await provider.getNetwork();
  assert.equal(chainId, 31337n);
  const owner = await provider.getSigner(0);
  const relayer = await provider.getSigner(2);
  const ownerAddress = await owner.getAddress();
  const recipient = await (await provider.getSigner(3)).getAddress();
  const agent = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, "m/44'/60'/0'/0/1");
  const setup = [];
  const record = async (label, tx) => {
    const receipt = await tx.wait();
    assert.equal(receipt.status, 1);
    return { label, transactionHash: receipt.hash, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.gasPrice,
      executionFee: receipt.gasUsed * receipt.gasPrice, receipt: receipt.toJSON() };
  };
  const deploy = async name => {
    const artifact = JSON.parse(await readFile(`contracts/out/${name}.sol/${name}.json`, 'utf8'));
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode.object, owner).deploy();
    setup.push(await record(`deploy ${name}`, contract.deploymentTransaction()));
    return contract;
  };
  const executor = await deploy('AgentIntentExecutor');
  const token = await deploy('MockToken');
  const executorAddress = await executor.getAddress();
  const tokenAddress = await token.getAddress();
  const amount = parseEther('1');
  const count = 20;
  setup.push(await record('mint', await token.mint(ownerAddress, amount * 20n)));
  setup.push(await record('approve', await token.approve(executorAddress, amount * 20n)));
  const now = (await provider.getBlock('latest')).timestamp;
  setup.push(await record('configure', await executor.configureAgent(agent.address, [tokenAddress, recipient, amount, amount * 20n, now + 3600])));
  const signingDomain = domain(chainId, executorAddress);
  const intents = Array.from({ length: count }, (_, nonce) => ({ owner: ownerAddress, agent: agent.address,
    token: tokenAddress, recipient, amount, nonce: BigInt(nonce), epoch: 1n, validAfter: BigInt(now), deadline: BigInt(now + 3600) }));
  const signatures = await Promise.all(intents.map(i => agent.signTypedData(signingDomain, types, i)));
  const ids = intents.map(i => TypedDataEncoder.hash(signingDomain, types, i));
  let snapshot = await provider.send('evm_snapshot', []);
  const rows = [];
  for (const batchSize of [1, 2, 5, 10, 20]) {
    assert.equal(await provider.send('evm_revert', [snapshot]), true);
    snapshot = await provider.send('evm_snapshot', []);
    const attempts = [];
    const observed = [];
    for (let offset = 0; offset < count; offset += batchSize) {
      const tx = await executor.connect(relayer).executeBatch(intents.slice(offset, offset + batchSize), signatures.slice(offset, offset + batchSize));
      const attempt = await record(`intents ${offset}-${offset + batchSize - 1}`, tx);
      const events = attempt.receipt.logs.filter(log => log.address.toLowerCase() === executorAddress.toLowerCase())
        .map(log => executor.interface.parseLog(log)).filter(event => event?.name === 'IntentExecuted');
      observed.push(...events.map(event => event.args.intentId));
      attempts.push(attempt);
    }
    assert.deepEqual(observed, ids);
    assert.equal(await token.balanceOf(ownerAddress), 0n);
    assert.equal(await token.balanceOf(recipient), amount * 20n);
    assert.equal((await executor.getAgentPolicy(ownerAddress, agent.address)).spent, amount * 20n);
    const gas = attempts.reduce((sum, a) => sum + a.gasUsed, 0n);
    rows.push({ batchSize, successfulIntents: count, transactions: attempts.length, failedTransactions: 0,
      totalGas: gas, gasPerIntent: Number(gas) / count, attempts });
  }
  const baseline = Number(rows[0].totalGas);
  for (const row of rows) row.gasReductionPercent = (1 - Number(row.totalGas) / baseline) * 100;
  const result = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    environment: { node: process.version, platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model,
      client: await provider.send('web3_clientVersion', []), compiler: '0.8.30', hardfork: 'cancun', optimizerRuns: 200,
      chainId, mining: 'automine, one confirmation', repetitions: 1 },
    method: '20 identical signed transfers; snapshot restore before each batch size; setup excluded; gas units, not throughput.',
    initial: { ownerBalance: amount * 20n, recipientBalance: '0', allowance: amount * 20n, budget: amount * 20n, spent: '0', epoch: '1' },
    domain: signingDomain, workload: intents, signatures, setup, rows };
  await mkdir('evidence', { recursive: true });
  await writeFile('evidence/gas.json', json(result));
  await writeFile('evidence/gas.csv', 'batchSize,intents,transactions,totalGas,gasPerIntent,reductionPercent\n' +
    rows.map(r => [r.batchSize, count, r.transactions, r.totalGas, r.gasPerIntent, r.gasReductionPercent.toFixed(2)].join(',')).join('\n') + '\n');
  console.table(rows.map(({ attempts, ...row }) => row));
} finally { provider.destroy(); }
