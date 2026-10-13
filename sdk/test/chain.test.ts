import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { BaseContract, ContractFactory, JsonRpcProvider, Wallet, type InterfaceAbi, type Signer } from 'ethers';
import { ScheduledTransferAgent } from '../src/agent.js';
import { AgentJournal } from '../src/journal.js';
import { contractPolicySource } from '../src/policy-source.js';
import { assertIntentAllowed } from '../src/policy.js';
import { RelayerError } from '../src/relayer-client.js';
import { hashIntent, intentDomain, IntentRejected, signIntent } from '../src/typed-data.js';
import type { IntentStatus, TransferIntent } from '../src/types.js';

function artifact(name: string): { abi: InterfaceAbi; bytecode: { object: string } } {
  try {
    return JSON.parse(readFileSync(new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url), 'utf8'));
  } catch {
    throw new Error('Run npm run build before the SDK chain test.');
  }
}

test('the SDK signature transfers tokens through the deployed executor', { timeout: 60_000 }, async () => {
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, [
    require.resolve('@foundry-rs/anvil/bin.mjs'),
    '--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', '--hardfork', 'cancun', '--silent',
  ], { stdio: 'ignore' });
  const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const journal = new AgentJournal(':memory:');
  try {
    let ready = false;
    for (let n = 0; n < 100; n += 1) {
      if (child.exitCode !== null) throw new Error('Anvil failed to start.');
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        });
        if (response.ok) { ready = true; break; }
      } catch { /* Node still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'Anvil starts within five seconds');
    const deployer = Wallet.createRandom().connect(provider);
    const owner = Wallet.createRandom().connect(provider);
    const forwarder = Wallet.createRandom().connect(provider);
    const signer = Wallet.createRandom();
    const recipient = Wallet.createRandom().address;
    for (const account of [deployer, owner, forwarder]) await provider.send('anvil_setBalance', [account.address, '0x56BC75E2D63100000']);
    const deploy = async (name: string, from: Signer) => {
      const deployed = await new ContractFactory(artifact(name).abi, artifact(name).bytecode.object, from).deploy();
      await deployed.waitForDeployment();
      return deployed;
    };
    const executor = await deploy('AgentIntentExecutor', deployer);
    const token = await deploy('MockToken', deployer);
    const executorAddress = await executor.getAddress();
    const tokenAddress = await token.getAddress();
    const now = Math.floor(Date.now() / 1000);
    const send = async (target: BaseContract, from: Signer, fn: string, ...args: unknown[]) => (await target.connect(from).getFunction(fn)(...args)).wait();
    await send(token, deployer, 'mint', owner.address, 5_000n);
    await send(token, owner, 'approve', executorAddress, 5_000n);
    await send(executor, owner, 'configureAgent', signer.address, {
      token: tokenAddress, recipient, maxAmountPerIntent: 1_000n, totalBudget: 1_000n, validUntil: BigInt(now + 7_200),
    });
    const domain = intentDomain(31337, executorAddress);
    let executions = 0;
    const agent = new ScheduledTransferAgent({
      signer,
      domain,
      policies: contractPolicySource(provider, executorAddress),
      submitter: {
        async submit(signed) {
          const intentId = hashIntent(domain, signed.intent);
          const onChain = await executor.getFunction('hashIntent')(signed.intent);
          assert.equal(String(onChain).toLowerCase(), intentId);
          const sent = await executor.connect(forwarder).getFunction('executeBatch')([signed.intent], [signed.signature]);
          const receipt = await sent.wait();
          if (!receipt || receipt.status !== 1) throw new RelayerError(400, 'EXECUTION_REVERTED', 'The executor reverted the transfer.');
          executions += 1;
          return { intentId, created: true, state: 'CONFIRMED' as const };
        },
        async status(): Promise<IntentStatus> {
          return { state: 'CONFIRMED', txHash: null, error: null };
        },
      },
      journal,
      nowSec: () => now,
    });
    agent.register({
      id: 'once', owner: owner.address, token: tokenAddress, recipient, amount: '1000', intervalSec: 1, startAt: now - 120, count: 1, windowSec: 3_600,
    });
    const done = await agent.tick('chain');
    assert.equal(done[0]?.state, 'CONFIRMED');
    assert.equal(executions, 1);
    assert.equal(await token.getFunction('balanceOf')(recipient), 1_000n);
    assert.equal(await token.getFunction('balanceOf')(owner.address), 4_000n);
    const spent = await executor.getFunction('getAgentPolicy')(owner.address, signer.address);
    assert.equal(spent.spent, 1_000n);
    assert.equal((await agent.tick('chain')).length, 0);
    assert.equal(executions, 1);

    const stored = journal.listOccurrences()[0];
    assert.ok(stored?.intent && stored.signature);
    await assert.rejects(() => executor.connect(forwarder).getFunction('executeBatch')([stored.intent], [stored.signature]));

    const policy = await contractPolicySource(provider, executorAddress).read(owner.address, signer.address);
    const over: TransferIntent = { ...stored.intent, nonce: '1', amount: '1001' };
    assert.throws(() => assertIntentAllowed(over, policy, BigInt(now), 0n), (error: unknown) => error instanceof IntentRejected && error.code === 'AMOUNT_EXCEEDS_LIMIT');
    const bypass = await signIntent(signer, domain, over);
    await assert.rejects(() => executor.connect(forwarder).getFunction('executeBatch')([bypass.intent], [bypass.signature]));
    assert.equal(await token.getFunction('balanceOf')(recipient), 1_000n);
  } finally {
    journal.close();
    provider.destroy();
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
});
