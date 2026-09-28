import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';
import { acquireLock } from '../src/lock.js';
import { Store } from '../src/store.js';
import { harness, normalized } from './helpers.js';

const KEY='0x'+'11'.repeat(32);
const EVM={RELAYER_MODE:'evm',RELAYER_PRIVATE_KEY:KEY,RPC_URL:'http://127.0.0.1:8545',EXECUTOR_ADDRESS:'0x5FbDB2315678afecb367f032d93F642f64180aa3'};
test('safe defaults, integer limits, loopback binding, and explicit EVM readiness',()=>{
  const c=loadConfig({}); assert.equal(c.mode,'mock'); assert.equal(c.host,'127.0.0.1');
  for(const env of [{RELAYER_MODE:'other'},{HOST:'0.0.0.0'},{BATCH_SIZE:'0'},{MAX_WAIT_MS:'-1'},{CHAIN_ID:'NaN'},{RELAYER_MODE:'evm'},
    {RELAYER_MODE:'evm',RELAYER_PRIVATE_KEY:KEY,RPC_URL:'http://127.0.0.1:8545'},{...EVM,EXECUTOR_ADDRESS:'0x1000000000000000000000000000000000000001'},
    {...EVM,RELAYER_PRIVATE_KEY:'0x12'},{...EVM,RPC_URL:'ws://127.0.0.1:8545'},{AGENT_INDEX_FROM_BLOCK:'-1'},{DATABASE_PATH:'same',MOCK_LEDGER_PATH:'same'}]) assert.throws(()=>loadConfig(env));
  const evm=loadConfig({...EVM,AGENT_INDEX_FROM_BLOCK:'7'});
  assert.equal(evm.domain.name,'AgentIntentExecutor'); assert.equal(evm.domain.verifyingContract,EVM.EXECUTOR_ADDRESS); assert.equal(evm.agentIndexFromBlock,7);
});
test('exclusive process lock prevents a second sender and releases safely',()=>{
  const dir=mkdtempSync(join(tmpdir(),'sc6109-lock-')),path=join(dir,'db');
  try {const release=acquireLock(path);assert.throws(()=>acquireLock(path),/locked/);release();acquireLock(path)();} finally {rmSync(dir,{recursive:true,force:true});}
});
test('changed experiment configuration requires new run label and rejection statistics deduplicate payloads',async()=>{
  const h=harness();
  try {
    h.store.insertIntent(await normalized(),h.clock());
    const changed=new Store(h.databasePath,{...h.metadata,coordinator:{batchSize:1}});
    try {
      const fresh=await normalized('1');
      assert.throws(()=>changed.insertIntent(fresh,h.clock()),/new runId/);
      assert.equal(changed.insertIntent({...fresh,runId:'baseline'},h.clock()).created,true);
    } finally {changed.close();}
    h.store.recordRejection({x:1,y:2},'test',{code:'BAD',message:'bad'},h.clock());
    h.store.recordRejection({y:2,x:1},'test',{code:'BAD',message:'bad'},h.clock());
    assert.equal(h.store.metrics('test',h.clock()).apiRejectedUniquePayloads,1);
  } finally {h.cleanup();}
});
