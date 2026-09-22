import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApi } from '../src/api.js';
import { normalizeSubmission, TRANSFER_TYPES } from '../src/intent.js';
import { TypedDataEncoder } from 'ethers';
import { BASE_TIME, DOMAIN, harness, signed } from './helpers.js';

test('POST returns durable 202 before execution; read routes omit signatures and raw transactions', async () => {
  const h = harness(), app = buildApi(h);
  try {
    const body = await signed();
    const response = await app.inject({ method: 'POST', url: '/intents', payload: body });
    assert.equal(response.statusCode, 202);
    const record = response.json().intent;
    assert.equal(record.state, 'QUEUED'); assert.equal(record.txHash, null); assert.equal(record.signature, undefined);
    const duplicate = await app.inject({ method: 'POST', url: '/intents', payload: body });
    assert.equal(duplicate.statusCode, 200); assert.equal(duplicate.json().created, false);
    h.advance(1000); await h.coordinator.tick(); await h.coordinator.tick();
    const detail = await app.inject(`/intents/${record.intentId}`);
    assert.equal(detail.json().intent.state, 'CONFIRMED');
    assert.deepEqual(detail.json().events.slice(0,3).map((e: { state: string }) => e.state), ['RECEIVED','VALIDATED','QUEUED']);
    const batch = (await app.inject('/batches')).json().batches[0];
    assert.equal(batch.transaction.rawTransaction, undefined);
    assert.equal((await app.inject(`/batches/${batch.batchId}`)).json().batch.receipt.success, true);
    assert.equal((await app.inject('/intents?runId=test')).json().intents.length, 1);
    const metrics = (await app.inject('/metrics?runId=test')).json();
    assert.equal(metrics.confirmed, 1); assert.equal(metrics.mode, 'mock');
  } finally { await app.close(); h.cleanup(); }
});

test('deduplication still works after expiry; same nonce with different contents conflicts', async () => {
  const h = harness(), app = buildApi(h);
  try {
    const body = await signed('0', { deadline: String(BASE_TIME/1000 + 1) });
    assert.equal((await app.inject({ method: 'POST', url: '/intents', payload: body })).statusCode, 202);
    h.advance(2000);
    assert.equal((await app.inject({ method: 'POST', url: '/intents', payload: body })).statusCode, 200);
    const conflict = await app.inject({ method: 'POST', url: '/intents', payload: await signed('0', { amount: '2' }) });
    assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().error.code, 'NONCE_CONFLICT');
    const expired = await app.inject({ method: 'POST', url: '/intents', payload: await signed('1', { deadline: '1' }) });
    assert.equal(expired.statusCode, 400); assert.equal(expired.json().error.code, 'INTENT_EXPIRED');
  } finally { await app.close(); h.cleanup(); }
});

test('strict schema, amounts, addresses, run labels, domain signatures, and tampering are rejected', async () => {
  const h = harness(), app = buildApi(h);
  try {
    const body = await signed();
    const bad = [
      { ...body, privateKey: 'DO_NOT_LOG_THIS_SECRET' },
      { ...body, domain: DOMAIN },
      { ...body, runId: '../private' },
      { ...body, intent: { ...body.intent, amount: 1 } },
      { ...body, intent: { ...body.intent, amount: '01' } },
      { ...body, intent: { ...body.intent, amount: '9'.repeat(79) } },
      { ...body, intent: { ...body.intent, owner: '0x0000000000000000000000000000000000000000' } },
      { ...body, intent: { ...body.intent, amount: '2' } },
      await signed('0', {}, { ...DOMAIN, chainId: 1 }),
      await signed('0', {}, { ...DOMAIN, verifyingContract: '0x6000000000000000000000000000000000000006' }),
      await signed('0', { amount: '0' }),
      await signed('0', { validAfter: '2', deadline: '1' }),
    ];
    for (const payload of bad) {
      const response = await app.inject({ method: 'POST', url: '/intents', payload });
      assert.equal(response.statusCode, 400); assert.ok(!response.body.includes('DO_NOT_LOG_THIS_SECRET'));
    }
    assert.equal(h.store.listIntents().length, 0);
    const digest = normalizeSubmission(body, DOMAIN, BASE_TIME).intentId;
    assert.equal(digest, TypedDataEncoder.hash(DOMAIN, TRANSFER_TYPES, body.intent));
  } finally { await app.close(); h.cleanup(); }
});

test('future intents accepted; pagination, malformed JSON, size limits, and unknown routes handled', async () => {
  const h = harness(), app = buildApi(h);
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/intents', payload: await signed('0', { validAfter: String(BASE_TIME/1000+100) }) })).statusCode, 202);
    await h.coordinator.tick(); assert.equal(h.store.activeBatch(), undefined);
    for (const url of ['/intents?limit=1000','/intents?offset=-1','/intents?x=1','/metrics?runId=..%2Fsecret','/intents/not-a-hash'])
      assert.equal((await app.inject(url)).statusCode, 400);
    assert.equal((await app.inject('/missing')).statusCode, 404);
    assert.equal((await app.inject(`/intents/0x${'a'.repeat(64)}`)).statusCode, 404);
    assert.equal((await app.inject('/agents?owner=0x5000000000000000000000000000000000000005')).statusCode, 501);
    assert.equal((await app.inject('/info')).json().domain.chainId, DOMAIN.chainId);
    assert.equal((await app.inject('/health')).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/intents', headers: { 'content-type': 'application/json' }, payload: '{' })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/intents', payload: { data: 'a'.repeat(70_000) } })).statusCode, 413);
  } finally { await app.close(); h.cleanup(); }
});

test('concurrent duplicate HTTP submissions reserve only one intent', async () => {
  const h = harness(), app = buildApi(h);
  try {
    const payload = await signed();
    const responses = await Promise.all(Array.from({length: 8}, () => app.inject({ method: 'POST', url: '/intents', payload })));
    assert.equal(responses.filter(r => r.statusCode === 202).length, 1);
    assert.equal(responses.filter(r => r.statusCode === 200).length, 7);
    assert.equal(h.store.listIntents().length, 1);
  } finally { await app.close(); h.cleanup(); }
});
