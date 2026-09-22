import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Coordinator, DEFAULT_COORDINATOR_OPTIONS } from '../src/coordinator.js';
import { MockGateway } from '../src/adapters/mock.js';
import type { PreparedTransaction, PreflightResult, SignedIntent } from '../src/types.js';
import { BASE_TIME, DOMAIN, harness, normalized } from './helpers.js';

test('size threshold groups two intents, preserves exact receipt IDs, and uses a single transaction', async () => {
  const h = harness();
  try {
    const a = await normalized('0'), b = await normalized('1');
    h.store.insertIntent(a, h.clock()); h.store.insertIntent(b, h.clock());
    await h.coordinator.tick();
    assert.equal(h.store.getIntent(a.intentId)!.state, 'SUBMITTED');
    assert.equal(h.store.listBatches().length, 1);
    assert.equal(h.store.getIntent(a.intentId)!.txHash, h.store.getIntent(b.intentId)!.txHash);
    await h.coordinator.tick();
    assert.equal(h.store.getIntent(a.intentId)!.state, 'CONFIRMED');
    assert.equal(h.store.metrics('test', h.clock()+1000).confirmed, 2);
  } finally { h.cleanup(); }
});

test('timeout flushes low load, future intents wait, and expired requests never broadcast', async () => {
  const h = harness();
  try {
    const a = await normalized(), future = await normalized('1', { validAfter: String(BASE_TIME/1000+5) });
    const expired = await normalized('2', { deadline: '1' });
    h.store.insertIntent(a,h.clock()); h.store.insertIntent(future,h.clock()); h.store.insertIntent(expired,h.clock());
    await h.coordinator.tick(); assert.equal(h.store.getIntent(a.intentId)!.state,'QUEUED');
    assert.equal(h.store.getIntent(expired.intentId)!.state,'EXPIRED');
    h.advance(1000); await h.coordinator.tick(); await h.coordinator.tick();
    assert.equal(h.store.getIntent(a.intentId)!.state,'CONFIRMED'); assert.equal(h.store.getIntent(future.intentId)!.state,'QUEUED');
    h.advance(4000); await h.coordinator.tick(); await h.coordinator.tick(); assert.equal(h.store.getIntent(future.intentId)!.state,'CONFIRMED');
  } finally { h.cleanup(); }
});

test('crash after simulated chain commit recovers from SQLite outbox and durable mock ledger', async () => {
  const h = harness();
  try {
    const a = await normalized(); h.store.insertIntent(a,h.clock()); h.advance(1000);
    const coordinator = new Coordinator(h.store,h.gateway,{ ...DEFAULT_COORDINATOR_OPTIONS, batchSize: 1 },h.clock);
    await coordinator.tick(); // Broadcast succeeded, no receipt was yet persisted.
    const txHash = h.store.getIntent(a.intentId)!.txHash;
    // A second connection models a restarted process; main's lock prevents concurrent real workers.
    const restartedStore = new Store(h.databasePath,h.metadata);
    const restartedGateway = new MockGateway({domain: DOMAIN,ledgerPath: join(h.directory,'chain.json'),clock: h.clock});
    try {
      const restarted = new Coordinator(restartedStore,restartedGateway,DEFAULT_COORDINATOR_OPTIONS,h.clock);
      await restarted.tick();
      const result = restartedStore.getIntent(a.intentId)!;
      assert.equal(result.state,'CONFIRMED'); assert.equal(result.txHash,txHash); assert.equal(result.attemptCount,1);
      assert.equal(restartedStore.listBatches().length,1);
    } finally { restartedStore.close(); }
  } finally { h.cleanup(); }
});

test('prepared-but-not-broadcast transaction is recovered with identical bytes', async () => {
  const h = harness();
  try {
    const a = h.store.insertIntent(await normalized(),h.clock()).record;
    const tx = await h.gateway.prepare([a]); h.store.prepareBatch([a],tx,h.clock());
    await h.coordinator.tick(); await h.coordinator.tick();
    assert.equal(h.store.getIntent(a.intentId)!.state,'CONFIRMED');
    assert.equal(h.store.getIntent(a.intentId)!.txHash,tx.txHash);
    assert.equal(h.store.getIntent(a.intentId)!.attemptCount,1);
  } finally { h.cleanup(); }
});

test('RPC timeout after mining is reconciled before any new transaction', async () => {
  const h = harness();
  try {
    const original = h.gateway.broadcast.bind(h.gateway);
    h.gateway.broadcast = async tx => { await original(tx); throw new Error('RPC password MUST_NOT_ESCAPE'); };
    const a = await normalized(); h.store.insertIntent(a,h.clock()); h.advance(1000);
    await h.coordinator.tick();
    assert.equal(h.store.getIntent(a.intentId)!.state,'RECONCILING');
    assert.ok(!JSON.stringify(h.coordinator.status()).includes('MUST_NOT_ESCAPE'));
    await h.coordinator.tick(); assert.equal(h.store.getIntent(a.intentId)!.state,'CONFIRMED');
    assert.equal(h.store.listBatches()[0]!.broadcastCount,1);
  } finally { h.cleanup(); }
});

test('dropped broadcasts retry identical bytes within limit and leave unknown outcome blocked', async () => {
  const h = harness();
  try {
    const hashes: string[] = [];
    h.gateway.broadcast = async tx => { hashes.push(tx.txHash); throw new Error('network down'); };
    const a = await normalized(), b = await normalized('1');
    h.store.insertIntent(a,h.clock()); h.advance(1000); await h.coordinator.tick();
    h.store.insertIntent(b,h.clock());
    for (let n=0;n<4;n++) { h.advance(100); await h.coordinator.tick(); }
    assert.equal(hashes.length,3); assert.equal(new Set(hashes).size,1);
    assert.equal(h.store.getIntent(a.intentId)!.state,'RECONCILING');
    assert.equal(h.store.getIntent(b.intentId)!.state,'QUEUED');
    assert.equal(h.store.getIntent(a.intentId)!.attemptCount,1);
    assert.equal((h.coordinator.status().lastError as {code:string}).code,'RECONCILIATION_REQUIRED');
  } finally { h.cleanup(); }
});

test('atomic reverts retry only after definitive receipt, stop at limit and retain failed gas', async () => {
  const h = harness();
  class RevertingMock extends MockGateway {
    reverting = false;
    override async preflight(intents: readonly SignedIntent[]): Promise<PreflightResult> {
      return this.reverting ? { ok:false,kind:'invalid',code:'TEST_REVERT',message:'test' } : super.preflight(intents);
    }
    override async broadcast(tx: PreparedTransaction) { this.reverting=true; try { await super.broadcast(tx); } finally { this.reverting=false; } }
  }
  try {
    const gateway = new RevertingMock({domain:DOMAIN,ledgerPath:':memory:',clock:h.clock});
    const coordinator = new Coordinator(h.store,gateway,{...DEFAULT_COORDINATOR_OPTIONS,batchSize:1,maxAttempts:3},h.clock);
    const a = await normalized(); h.store.insertIntent(a,h.clock());
    for (let n=0;n<6;n++) { await coordinator.tick(); h.advance(10); }
    const record = h.store.getIntent(a.intentId)!;
    assert.equal(record.state,'FAILED'); assert.equal(record.attemptCount,3);
    assert.equal(new Set(h.store.listBatches().map(b=>b.transaction.nonce)).size,3);
    const metrics = h.store.metrics('test',h.clock());
    assert.equal(metrics.gasUsed,'213000'); assert.equal(metrics.executionFailureRate,1); assert.equal(metrics.gasPerSuccessfulIntent,null);
  } finally { h.cleanup(); }
});

test('gas-limited batches split by valid prefix; a single oversized intent is rejected', async () => {
  const h = harness();
  try {
    const options={...DEFAULT_COORDINATOR_OPTIONS,batchSize:2,maxWaitMs:0,maxGasPerBatch:'80000'};
    const coordinator=new Coordinator(h.store,h.gateway,options,h.clock);
    for(let n=0;n<2;n++) h.store.insertIntent(await normalized(String(n)),h.clock());
    for(let n=0;n<4;n++) await coordinator.tick();
    assert.equal(h.store.listBatches().length,2); assert.equal(h.store.metrics('test',h.clock()+1000).confirmed,2);
    const a=await normalized('2'); h.store.insertIntent(a,h.clock());
    const small=new Coordinator(h.store,h.gateway,{...options,maxGasPerBatch:'30000'},h.clock);
    await small.tick(); assert.equal(h.store.getIntent(a.intentId)!.state,'REJECTED');
  } finally { h.cleanup(); }
});

test('whole-prefix validation respects shared resources and does not discard a later recoverable intent', async () => {
  const h = harness();
  try {
    const base=h.gateway.preflight.bind(h.gateway);
    h.gateway.preflight=async intents=>intents.length>1 ? {ok:false,kind:'invalid',code:'SHARED_BUDGET',message:'test'} : base(intents);
    const a=await normalized(), b=await normalized('1'); h.store.insertIntent(a,h.clock()); h.store.insertIntent(b,h.clock());
    await h.coordinator.tick(); assert.equal(h.store.getIntent(b.intentId)!.state,'QUEUED');
    await h.coordinator.tick(); h.advance(1000); await h.coordinator.tick(); await h.coordinator.tick();
    assert.equal(h.store.getIntent(b.intentId)!.state,'CONFIRMED');
  } finally { h.cleanup(); }
});

test('success receipt with wrong intent digest halts; provider exception leaves queued work untouched', async () => {
  const h = harness();
  try {
    const a=await normalized(); h.store.insertIntent(a,h.clock()); h.advance(1000);
    const preflight=h.gateway.preflight.bind(h.gateway);
    h.gateway.preflight=async()=>{throw new Error('RPC unavailable');}; await h.coordinator.tick();
    assert.equal(h.store.getIntent(a.intentId)!.state,'QUEUED'); assert.equal(h.store.listBatches().length,0);
    h.gateway.preflight=preflight; await h.coordinator.tick();
    const receipt=h.gateway.receipt.bind(h.gateway);
    h.gateway.receipt=async hash=>{const r=await receipt(hash); return r?{...r,intentIds:['0x'+'a'.repeat(64)]}:null;};
    await h.coordinator.tick(); assert.equal(h.store.getIntent(a.intentId)!.state,'RECONCILING');
    assert.equal((h.coordinator.status().lastError as {code:string}).code,'RECEIPT_MISMATCH');
  } finally { h.cleanup(); }
});

test('run IDs never share a batch and database identity cannot silently change', async () => {
  const h=harness();
  try {
    h.store.insertIntent(await normalized(),h.clock()); h.store.insertIntent({...await normalized('1'),runId:'other'},h.clock());
    h.advance(1000); for(let n=0;n<4;n++) await h.coordinator.tick();
    assert.equal(h.store.listBatches({runId:'test'}).length,1); assert.equal(h.store.listBatches({runId:'other'}).length,1);
    assert.throws(()=>new Store(h.databasePath,{...h.metadata,domain:{...DOMAIN,chainId:1}}),/another chain/);
  } finally { h.cleanup(); }
});

test('concurrent ticks cannot double-claim the inbox', async () => {
  const h=harness();
  try {
    h.store.insertIntent(await normalized(),h.clock()); h.advance(1000);
    await Promise.all(Array.from({length:10},()=>h.coordinator.tick()));
    assert.equal(h.store.listBatches().length,1);
    await h.coordinator.tick(); assert.equal(h.store.metrics('test',h.clock()+1000).confirmed,1);
  } finally { h.cleanup(); }
});
