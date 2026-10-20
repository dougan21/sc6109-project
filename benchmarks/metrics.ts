// Member E: pure metric calculations for one measured run. Definitions follow plan §11.4
// and apps/web/E_EXPERIMENT_HANDOFF.md. Inputs are the relayer's own intent/batch records.

export const TERMINAL = new Set(['CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED']);
const FAILED_AFTER_ATTEMPT = new Set(['FAILED', 'EXPIRED', 'REJECTED']);

export interface StateEventView { state: string; at: number }
export interface IntentView {
  intentId: string;
  state: string;
  receivedAt: number;
  submittedAt: number | null;
  confirmedAt: number | null;
  attemptCount: number;
  batchId: string | null;
  events?: StateEventView[];
}
export interface BatchView {
  batchId: string;
  intentIds: string[];
  broadcastCount: number;
  receipt: { success: boolean; gasUsed: string; effectiveGasPrice: string } | null;
}

export interface Distribution { sampleCount: number; p50: number | null; p95: number | null; min: number | null; max: number | null; mean: number | null }

/** Nearest-rank percentile, the same method as the relayer's /metrics (ceil(p·n)−1 on sorted values). */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

export function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    sampleCount: n, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95),
    min: n ? sorted[0]! : null, max: n ? sorted[n - 1]! : null,
    mean: n ? sorted.reduce((s, v) => s + v, 0) / n : null,
  };
}

/** Exact decimal string of numerator/denominator, rounded half-up to `places` digits, trailing zeros trimmed. */
export function decimalRatio(numerator: bigint, denominator: bigint, places = 4): string {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  const scale = 10n ** BigInt(places);
  const scaled = (numerator * scale * 2n + denominator) / (denominator * 2n);
  const whole = scaled / scale, fraction = (scaled % scale).toString().padStart(places, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Time the intent reached its terminal state, from its state history; null when not terminal. */
export function terminalAt(intent: IntentView): number | null {
  if (!TERMINAL.has(intent.state)) return null;
  if (intent.state === 'CONFIRMED' && intent.confirmedAt !== null) return intent.confirmedAt;
  const last = [...(intent.events ?? [])].reverse().find(e => e.state === intent.state);
  return last?.at ?? null;
}

export interface RunMetrics {
  counts: {
    accepted: number; confirmed: number; attempted: number; failedAfterAttempt: number;
    rejectedBeforeAttempt: number; expiredBeforeAttempt: number; unfinished: number;
    states: Record<string, number>;
  };
  window: { startMs: number; endMs: number; seconds: number; kind: 'workload-drain'; endedBy: 'drained' | 'timeout' };
  throughput: number;
  failureRate: { value: number; numerator: number; denominator: number };
  latencyMs: { endToEnd: Distribution; queue: Distribution; afterFirstBroadcast: Distribution };
  gas: { totalReceiptGas: string; revertedReceiptGas: string; executionFeesWei: string; perSuccessfulIntent: string | null };
  transactions: { distinctBroadcast: number; withReceipt: number; reverted: number; unresolved: number;
    transactionFailureRate: number | null; aggregationRatio: number | null; intentsPerSuccessfulTx: Distribution };
}

/**
 * Workload-drain window: from the first durable receipt of a measured intent to the last terminal
 * state observed for one. If the drain timed out, the window ends at `observedAt` and unfinished > 0.
 */
export function computeRunMetrics(intents: readonly IntentView[], batches: readonly BatchView[], observedAt: number): RunMetrics {
  if (!intents.length) throw new Error('A measured run needs at least one accepted intent.');
  const states: Record<string, number> = {};
  for (const i of intents) states[i.state] = (states[i.state] ?? 0) + 1;
  const confirmed = intents.filter(i => i.state === 'CONFIRMED');
  const attempted = intents.filter(i => i.attemptCount > 0);
  const failed = attempted.filter(i => FAILED_AFTER_ATTEMPT.has(i.state));
  const unfinished = intents.filter(i => !TERMINAL.has(i.state)).length;

  const startMs = Math.min(...intents.map(i => i.receivedAt));
  const ends = intents.map(terminalAt).filter((t): t is number => t !== null);
  const endedBy = unfinished ? 'timeout' : 'drained';
  const endMs = unfinished ? observedAt : Math.max(...ends);
  if (!(endMs > startMs)) throw new Error('Measurement window must have positive length.');
  const seconds = (endMs - startMs) / 1000;

  const receipts = batches.filter(b => b.receipt !== null);
  const reverted = receipts.filter(b => !b.receipt!.success);
  const gas = receipts.reduce((s, b) => s + BigInt(b.receipt!.gasUsed), 0n);
  const revertedGas = reverted.reduce((s, b) => s + BigInt(b.receipt!.gasUsed), 0n);
  const fees = receipts.reduce((s, b) => s + BigInt(b.receipt!.gasUsed) * BigInt(b.receipt!.effectiveGasPrice), 0n);
  const broadcast = batches.filter(b => b.broadcastCount > 0);

  return {
    counts: {
      accepted: intents.length, confirmed: confirmed.length, attempted: attempted.length, failedAfterAttempt: failed.length,
      rejectedBeforeAttempt: intents.filter(i => i.state === 'REJECTED' && i.attemptCount === 0).length,
      expiredBeforeAttempt: intents.filter(i => i.state === 'EXPIRED' && i.attemptCount === 0).length,
      unfinished, states,
    },
    window: { startMs, endMs, seconds, kind: 'workload-drain', endedBy },
    throughput: confirmed.length / seconds,
    // With no attempted intents there is nothing to fail; the raw denominator stays visible as 0.
    failureRate: { value: attempted.length ? failed.length / attempted.length : 0, numerator: failed.length, denominator: attempted.length },
    latencyMs: {
      endToEnd: distribution(confirmed.map(i => i.confirmedAt! - i.receivedAt)),
      queue: distribution(attempted.map(i => i.submittedAt! - i.receivedAt)),
      afterFirstBroadcast: distribution(confirmed.map(i => i.confirmedAt! - i.submittedAt!)),
    },
    gas: {
      totalReceiptGas: gas.toString(), revertedReceiptGas: revertedGas.toString(), executionFeesWei: fees.toString(),
      perSuccessfulIntent: confirmed.length ? decimalRatio(gas, BigInt(confirmed.length)) : null,
    },
    transactions: {
      distinctBroadcast: broadcast.length, withReceipt: receipts.length, reverted: reverted.length,
      unresolved: batches.length - receipts.length,
      transactionFailureRate: receipts.length ? reverted.length / receipts.length : null,
      aggregationRatio: broadcast.length ? confirmed.length / broadcast.length : null,
      intentsPerSuccessfulTx: distribution(receipts.filter(b => b.receipt!.success).map(b => b.intentIds.length)),
    },
  };
}
