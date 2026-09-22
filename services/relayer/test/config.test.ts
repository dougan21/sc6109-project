import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';
import { acquireLock } from '../src/lock.js';
import { Store } from '../src/store.js';
import { harness, normalized } from './helpers.js';

test('safe defaults, integer limits, loopback binding, and explicit EVM readiness',()=>{
  const c=loadConfig({}); assert.equal(c.mode,'mock'); assert.equal(c.host,'127.0.0.1');
  for(const env of [{RELAYER_MODE:'other'},{HOST:'0.0.0.0'},{BATCH_SIZE:'0'},{MAX_WAIT_MS:'-1'},{CHAIN_ID:'NaN'},{RELAYER_MODE:'evm'},
    {RELAYER_MODE:'evm',EVM_ABI_CONFIRMED:'true'},{DATABASE_PATH:'same',MOCK_LEDGER_PATH:'same'}]) assert.throws(()=>loadConfig(env));
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
