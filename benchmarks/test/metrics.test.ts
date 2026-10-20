import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRunMetrics, decimalRatio, percentile, type BatchView, type IntentView } from '../metrics.js';

const intent = (id: string, state: string, receivedAt: number, extra: Partial<IntentView> = {}): IntentView => ({
  intentId: id, state, receivedAt, submittedAt: null, confirmedAt: null, attemptCount: 0, batchId: null, ...extra,
});
const batch = (ids: string[], success: boolean, gasUsed: string): BatchView => ({
  batchId: ids.join('+'), intentIds: ids, broadcastCount: 1, receipt: { success, gasUsed, effectiveGasPrice: '2' },
});

test('nearest-rank percentile matches the relayer definition', () => {
  const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(v, 0.5), 50);
  assert.equal(percentile(v, 0.95), 100);
  assert.equal(percentile([7], 0.95), 7);
  assert.equal(percentile([], 0.5), null);
});

test('decimalRatio is exact and rounds half up', () => {
  assert.equal(decimalRatio(963168n, 20n), '48158.4');
  assert.equal(decimalRatio(10n, 3n), '3.3333');
  assert.equal(decimalRatio(2n, 3n), '0.6667');
  assert.equal(decimalRatio(100n, 4n), '25');
});

test('denominators: failures count only attempted intents; reverted gas is charged to successes', () => {
  const intents = [
    intent('a', 'CONFIRMED', 1000, { submittedAt: 1100, confirmedAt: 2000, attemptCount: 2 }),
    intent('b', 'CONFIRMED', 1000, { submittedAt: 1100, confirmedAt: 3000, attemptCount: 2 }),
    intent('c', 'FAILED', 1200, { submittedAt: 1300, attemptCount: 3, events: [{ state: 'FAILED', at: 3500 }] }),
    intent('d', 'REJECTED', 1300, { events: [{ state: 'REJECTED', at: 1400 }] }), // preflight rejection before any attempt
  ];
  const batches = [batch(['a', 'b', 'c'], false, '90000'), batch(['a', 'b'], true, '110000')];
  const m = computeRunMetrics(intents, batches, 9999);
  assert.deepEqual(m.failureRate, { value: 1 / 3, numerator: 1, denominator: 3 });
  assert.equal(m.counts.rejectedBeforeAttempt, 1);
  assert.equal(m.gas.totalReceiptGas, '200000');
  assert.equal(m.gas.revertedReceiptGas, '90000');
  assert.equal(m.gas.perSuccessfulIntent, '100000');
  assert.equal(m.gas.executionFeesWei, '400000');
  assert.deepEqual([m.window.startMs, m.window.endMs, m.window.endedBy], [1000, 3500, 'drained']);
  assert.equal(m.throughput, 2 / 2.5);
  assert.deepEqual([m.latencyMs.endToEnd.p50, m.latencyMs.endToEnd.p95], [1000, 2000]);
  assert.equal(m.transactions.transactionFailureRate, 0.5);
  assert.equal(m.transactions.aggregationRatio, 1);
});

test('unfinished work is not a failure and extends the window to the observation time', () => {
  const m = computeRunMetrics([
    intent('a', 'CONFIRMED', 0, { submittedAt: 10, confirmedAt: 500, attemptCount: 1 }),
    intent('b', 'RECONCILING', 0, { submittedAt: 600, attemptCount: 1 }),
  ], [batch(['a'], true, '50000')], 4000);
  assert.equal(m.counts.unfinished, 1);
  assert.equal(m.failureRate.value, 0);
  assert.deepEqual([m.window.endMs, m.window.endedBy], [4000, 'timeout']);
});

test('zero successes give null unit cost and zero throughput', () => {
  const m = computeRunMetrics([intent('a', 'EXPIRED', 0, { events: [{ state: 'EXPIRED', at: 100 }] })], [], 200);
  assert.equal(m.throughput, 0);
  assert.equal(m.gas.perSuccessfulIntent, null);
  assert.equal(m.latencyMs.endToEnd.p50, null);
  assert.equal(m.failureRate.denominator, 0);
});
