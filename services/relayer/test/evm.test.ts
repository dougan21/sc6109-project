import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import solc from 'solc';
import { ContractFactory, JsonRpcProvider, Transaction, Wallet, type InterfaceAbi } from 'ethers';
import { EthersGateway } from '../src/adapters/evm.js';
import { Store } from '../src/store.js';
import { Coordinator, DEFAULT_COORDINATOR_OPTIONS } from '../src/coordinator.js';
import { normalizeSubmission } from '../src/intent.js';
import { DOMAIN, signed } from './helpers.js';

test('EVM transport against a local Anvil node and a TEST-ONLY executor fixture', { timeout: 45_000 }, async t => {
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
    const deployer = Wallet.createRandom().connect(provider), relayer = Wallet.createRandom();
    for (const address of [deployer.address,relayer.address]) await provider.send('anvil_setBalance',[address,'0x56BC75E2D63100000']);
    const input = {language:'Solidity',sources:{'BExecutorFixture.sol':{content:readFileSync(new URL('./fixtures/BExecutorFixture.sol',import.meta.url),'utf8')}},
      settings:{evmVersion:'cancun',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
    const compiled = JSON.parse(solc.compile(JSON.stringify(input))) as {
      errors?:Array<{severity:string;formattedMessage:string}>;
      contracts: Record<string,Record<string,{abi:InterfaceAbi;evm:{bytecode:{object:string}}}>>;
    };
    assert.deepEqual(compiled.errors?.filter(e=>e.severity==='error') ?? [],[]);
    const artifact=compiled.contracts['BExecutorFixture.sol']!['BExecutorFixture']!;
    const contract=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,deployer).deploy();
    await contract.waitForDeployment();
    const domain={...DOMAIN,verifyingContract:await contract.getAddress()};
    const options={domain,rpcUrl:`http://127.0.0.1:${port}`,privateKey:relayer.privateKey,maxGasPerBatch:'5000000',confirmations:1};
    gateway=new EthersGateway(options); await gateway.initialize();
    const metadata={mode:'evm',domain,relayerAddress:gateway.relayerAddress};
    store=new Store(join(directory,'queue.sqlite'),metadata);
    const make=async(nonce:string,amount='1000000') => normalizeSubmission(await signed(nonce,{amount,deadline:String(Math.floor(Date.now()/1000)+600)},domain),domain,Date.now());

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
      assert.equal(await contract.getFunction('executedCount')(),2n);
      assert.equal(store.getIntent(a.intentId)!.attemptCount,1);
      assert.ok(BigInt(store.metrics('test',Date.now()).gasUsed)>0n);
      assert.deepEqual(new Set(store.listBatches()[0]!.receipt!.intentIds),new Set([a.intentId,b.intentId]));
    });
    await t.test('preflight detects replay, invalid signature, atomic failure, and gas limit',async()=>{
      const fresh=await make('2'), bad=await make('3','13');
      assert.equal((await gateway!.preflight([fresh,bad])).ok,false);
      assert.equal((await gateway!.preflight([{...fresh,signature:'0x'+'00'.repeat(65)}])).ok,false);
      const existing=store!.listIntents()[0]!; assert.equal((await gateway!.preflight([existing])).ok,false);
      const tiny=new EthersGateway({...options,maxGasPerBatch:'21000'}); await tiny.initialize();
      try {const result=await tiny.preflight([fresh]); assert.equal(result.ok,false); if(!result.ok) assert.equal(result.kind,'oversized');} finally {tiny.close();}
    });
    await t.test('state changes after prepare produce a real reverted receipt without partial fixture state',async()=>{
      const fresh=await make('4'); const tx=await gateway!.prepare([fresh]);
      await (await contract.getFunction('setForceFailure')(true)).wait();
      await gateway!.broadcast(tx);
      let receipt=await gateway!.receipt(tx.txHash);
      for(let n=0;n<50&&!receipt;n++){await new Promise(resolve=>setTimeout(resolve,20));receipt=await gateway!.receipt(tx.txHash);}
      assert.ok(receipt); assert.equal(receipt.success,false); assert.equal(receipt.intentIds.length,0);
      assert.equal(await contract.getFunction('executedCount')(),2n);
      await (await contract.getFunction('setForceFailure')(false)).wait();
    });
  } finally {
    store?.close(); gateway?.close(); provider.destroy(); rmSync(directory,{recursive:true,force:true});
    if (child.exitCode === null) {const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
  }
});
