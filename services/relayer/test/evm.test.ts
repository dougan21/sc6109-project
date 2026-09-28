import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BaseContract, ContractFactory, JsonRpcProvider, Transaction, TypedDataEncoder, Wallet, keccak256, verifyTypedData, type InterfaceAbi, type Signer } from 'ethers';
import { EthersGateway } from '../src/adapters/evm.js';
import { Store } from '../src/store.js';
import { Coordinator, DEFAULT_COORDINATOR_OPTIONS } from '../src/coordinator.js';
import { normalizeSubmission, TRANSFER_TYPES } from '../src/intent.js';
import { EXECUTOR_ABI } from '../src/adapters/executor-abi.js';
import { DOMAIN, signed, signer } from './helpers.js';

const root = new URL('../../../', import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
// Forge output, built by `npm run build` or `npm run test:contracts`; checked against the frozen bytecode below.
function artifact(name: string) {
  try { return json(`contracts/out/${name}.sol/${name}.json`) as { abi: InterfaceAbi; bytecode: { object: string } }; }
  catch { throw new Error('Run npm run build before the relayer EVM tests.'); }
}

test('relayer signing types, domain, and ABI match the frozen executor interface', async () => {
  const fixture = json('interfaces/signing-fixture.json');
  assert.deepEqual(TRANSFER_TYPES, fixture.types);
  assert.deepEqual({ ...DOMAIN, chainId: String(DOMAIN.chainId), verifyingContract: fixture.domain.verifyingContract }, fixture.domain);
  assert.equal(TypedDataEncoder.hash(fixture.domain, TRANSFER_TYPES, fixture.intent), fixture.digest);
  assert.equal(verifyTypedData(fixture.domain, TRANSFER_TYPES, fixture.intent, fixture.signature), fixture.intent.agent);
  assert.deepEqual(EXECUTOR_ABI, json('interfaces/AgentIntentExecutor.json'));
  const freeze = json('interfaces/freeze.json');
  for (const name of ['AgentIntentExecutor', 'MockToken'])
    assert.equal(keccak256(artifact(name).bytecode.object), freeze.contracts[name].creationBytecodeHash, `${name} build differs from the frozen interface`);
});

test('EVM transport against a local Anvil node and the deployed AgentIntentExecutor', { timeout: 45_000 }, async t => {
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const require = createRequire(import.meta.url);
  const child = spawn(process.execPath, [require.resolve('@foundry-rs/anvil/bin.mjs'), '--host','127.0.0.1','--port',String(port),'--chain-id','31337','--hardfork','cancun','--silent'], { stdio: 'ignore' });
  const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const directory = mkdtempSync(join(tmpdir(),'sc6109-evm-'));
  let gateway: EthersGateway | undefined;
  let store: Store | undefined;
  try {
    let ready = false;
    for(let n=0;n<100;n++) {
      if (child.exitCode !== null) throw new Error('Anvil failed to start.');
      try {
        const r = await fetch(`http://127.0.0.1:${port}`, { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}) });
        if (r.ok) { ready=true; break; }
      } catch { /* Node still starting. */ }
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(ready,'Anvil starts within five seconds');
    const deployer = Wallet.createRandom().connect(provider), owner = Wallet.createRandom().connect(provider), relayer = Wallet.createRandom();
    const recipient = Wallet.createRandom().address;
    for (const address of [deployer.address,owner.address,relayer.address]) await provider.send('anvil_setBalance',[address,'0x56BC75E2D63100000']);
    const deploy = async (name: string, from: Signer) => {
      const deployed = await new ContractFactory(artifact(name).abi,artifact(name).bytecode.object,from).deploy();
      await deployed.waitForDeployment(); return deployed;
    };
    const contract = await deploy('AgentIntentExecutor',deployer), token = await deploy('MockToken',deployer);
    const executorAddress = await contract.getAddress(), tokenAddress = await token.getAddress();
    const send = async (target: BaseContract, from: Signer, fn: string, ...args: unknown[]) =>
      (await target.connect(from).getFunction(fn)(...args)).wait();
    await send(token,deployer,'mint',owner.address,20_000_000n);
    await send(token,owner,'approve',executorAddress,20_000_000n);
    await send(contract,owner,'configureAgent',signer.address,
      { token: tokenAddress, recipient, maxAmountPerIntent: 5_000_000n, totalBudget: 20_000_000n, validUntil: BigInt(Math.floor(Date.now()/1000)+3600) });
    const balance = async (address: string) => await token.getFunction('balanceOf')(address) as bigint;
    const policy = async () => await contract.getFunction('getAgentPolicy')(owner.address,signer.address) as { spent: bigint; epoch: bigint };
    const domain={...DOMAIN,verifyingContract:executorAddress};
    const options={domain,rpcUrl:`http://127.0.0.1:${port}`,privateKey:relayer.privateKey,maxGasPerBatch:'5000000',confirmations:1,indexFromBlock:0};
    gateway=new EthersGateway(options); await gateway.initialize();
    const metadata={mode:'evm',domain,relayerAddress:gateway.relayerAddress};
    store=new Store(join(directory,'queue.sqlite'),metadata);
    const make=async(nonce:string,amount='1000000') => normalizeSubmission(await signed(nonce,
      {owner:owner.address,token:tokenAddress,recipient,amount,deadline:String(Math.floor(Date.now()/1000)+600)},domain),domain,Date.now());

    await t.test('wrong network or missing executor fails initialization',async()=>{
      for(const changed of [{...domain,chainId:1},{...domain,verifyingContract:DOMAIN.verifyingContract}]) {
        const bad=new EthersGateway({...options,domain:changed});
        try {await assert.rejects(()=>bad.initialize());} finally {bad.close();}
      }
    });
    await t.test('full batch is signed, broadcast once, recovered, and matched to exact EIP-712 events',async()=>{
      const a=await make('0'), b=await make('1');
      store!.insertIntent(a,Date.now()); store!.insertIntent(b,Date.now());
      const c=new Coordinator(store!,gateway!,{...DEFAULT_COORDINATOR_OPTIONS,batchSize:2,maxWaitMs:0});
      await c.tick();
      const batch=store!.activeBatch(); assert.ok(batch);
      const tx=Transaction.from(batch.transaction.rawTransaction);
      assert.equal(tx.to,domain.verifyingContract); assert.equal(tx.from,relayer.address); assert.equal(tx.hash,batch.transaction.txHash);
      store!.close(); store=new Store(join(directory,'queue.sqlite'),metadata);
      const recovered=new Coordinator(store,gateway!,DEFAULT_COORDINATOR_OPTIONS);
      for(let n=0;n<50 && store.getIntent(a.intentId)!.state!=='CONFIRMED';n++) {await recovered.tick();await new Promise(resolve=>setTimeout(resolve,20));}
      assert.equal(store.getIntent(a.intentId)!.state,'CONFIRMED'); assert.equal(store.getIntent(b.intentId)!.state,'CONFIRMED');
      assert.equal(await balance(recipient),2_000_000n); assert.equal(await balance(owner.address),18_000_000n);
      assert.equal((await policy()).spent,2_000_000n);
      for (const nonce of [0n,1n]) assert.equal(await contract.getFunction('consumed')(owner.address,signer.address,1n,nonce),true);
      assert.equal(store.getIntent(a.intentId)!.attemptCount,1);
      assert.ok(BigInt(store.metrics('test',Date.now()).gasUsed)>0n);
      assert.deepEqual(new Set(store.listBatches()[0]!.receipt!.intentIds),new Set([a.intentId,b.intentId]));
    });
    await t.test('preflight detects replay, invalid signature, atomic failure, and gas limit',async()=>{
      const fresh=await make('2'), bad=await make('3','5000001');
      assert.equal((await gateway!.preflight([fresh,bad])).ok,false);
      assert.equal((await gateway!.preflight([{...fresh,signature:'0x'+'00'.repeat(65)}])).ok,false);
      const existing=store!.listIntents()[0]!; assert.equal((await gateway!.preflight([existing])).ok,false);
      const tiny=new EthersGateway({...options,maxGasPerBatch:'21000'}); await tiny.initialize();
      try {const result=await tiny.preflight([fresh]); assert.equal(result.ok,false); if(!result.ok) assert.equal(result.kind,'oversized');} finally {tiny.close();}
    });
    await t.test('agent policies are discovered from events and read on-chain',async()=>{
      const view=await gateway!.agents(owner.address);
      assert.equal(view.indexedFromBlock,0); assert.ok(view.blockNumber>0);
      assert.deepEqual(view.agents.map(p=>[p.agent,p.token,p.recipient,p.spent,p.totalBudget,p.active,p.epoch]),
        [[signer.address,tokenAddress,recipient,'2000000','20000000',true,'1']]);
      assert.deepEqual((await gateway!.agents(deployer.address)).agents,[]);
    });
    await t.test('revocation after prepare produces a real reverted receipt without partial state',async()=>{
      const fresh=await make('4'); const tx=await gateway!.prepare([fresh]);
      await send(contract,owner,'revokeAgent',signer.address);
      await gateway!.broadcast(tx);
      let receipt=await gateway!.receipt(tx.txHash);
      for(let n=0;n<50&&!receipt;n++){await new Promise(resolve=>setTimeout(resolve,20));receipt=await gateway!.receipt(tx.txHash);}
      assert.ok(receipt); assert.equal(receipt.success,false); assert.equal(receipt.intentIds.length,0);
      assert.equal(await balance(recipient),2_000_000n); assert.equal((await policy()).spent,2_000_000n);
      assert.equal(await contract.getFunction('consumed')(owner.address,signer.address,1n,4n),false);
      const [revoked]=(await gateway!.agents(owner.address)).agents;
      assert.equal(revoked!.active,false); assert.equal(revoked!.epoch,'2');
    });
  } finally {
    store?.close(); gateway?.close(); provider.destroy(); rmSync(directory,{recursive:true,force:true});
    if (child.exitCode === null) {const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
  }
});
