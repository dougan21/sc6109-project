import type { BatchRecord, ChainGateway, CoordinatorOptions, IntentRecord, Problem } from './types.js';
import { Store } from './store.js';

export const DEFAULT_COORDINATOR_OPTIONS: CoordinatorOptions = {
  batchSize: 10, maxWaitMs: 1000, maxAttempts: 3, rebroadcastAfterMs: 5000, maxBroadcasts: 3, maxGasPerBatch: '5000000',
};

export class Coordinator {
  private running = false;
  private lastError: Problem | null = null;
  private lastTickAt: number | null = null;
  constructor(readonly store: Store, readonly gateway: ChainGateway,
    readonly options: CoordinatorOptions = DEFAULT_COORDINATOR_OPTIONS, private clock: () => number = Date.now) {}

  status(): Record<string, unknown> {
    const active = this.store.activeBatch();
    return { running: this.running, lastTickAt: this.lastTickAt, lastError: this.lastError,
      activeBatchId: active?.batchId ?? null, activeBatchState: active?.state ?? null };
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.lastTickAt = this.clock();
    try {
      this.lastError = null;
      const pending = this.store.activeBatch();
      if (pending) { await this.recover(pending); return; }
      const now = this.clock(), seconds = BigInt(Math.floor(now / 1000));
      const ready: IntentRecord[] = [];
      for (const record of this.store.queued()) {
        if (BigInt(record.intent.deadline) < seconds) this.store.markTerminal(record.intentId, 'EXPIRED', { code: 'INTENT_EXPIRED', message: 'Intent expired before another execution attempt.' }, now);
        else if (BigInt(record.intent.validAfter) <= seconds) ready.push(record);
      }
      if (!ready.length) return;
      const runId = ready[0]!.runId;
      const candidates = ready.filter(i => i.runId === runId).slice(0, this.options.batchSize);
      if (candidates.length < this.options.batchSize && now - candidates[0]!.receivedAt < this.options.maxWaitMs) return;
      // Prefix simulation accounts for shared balances/budgets. Never assume individual validity implies batch validity.
      const selected: IntentRecord[] = [];
      for (const record of candidates) {
        const result = await this.gateway.preflight([...selected, record]);
        if (result.ok && BigInt(result.gasEstimate) <= BigInt(this.options.maxGasPerBatch)) { selected.push(record); continue; }
        if (selected.length) break; // Dispatch the valid prefix; reconsider the next request against updated state.
        this.store.markTerminal(record.intentId, record.attemptCount ? 'FAILED' : 'REJECTED', {
          code: result.ok || result.kind === 'oversized' ? 'GAS_LIMIT_EXCEEDED' : 'PREFLIGHT_REJECTED',
          message: result.ok || result.kind === 'oversized' ? 'A single intent exceeds the configured gas budget.' : 'The executor rejected this intent during preflight.',
        }, this.clock());
      }
      if (!selected.length) return;
      // A RPC failure before this commit has not broadcast anything and leaves all intents queued.
      const tx = await this.gateway.prepare(selected);
      const batch = this.store.prepareBatch(selected, tx, this.clock());
      await this.broadcast(batch);
    } catch {
      // Provider errors can contain private RPC credentials or signed bytes. Never expose them as telemetry.
      this.lastError = { code: 'COORDINATOR_UNAVAILABLE', message: 'Coordinator operation failed; durable state is retained for recovery.' };
    } finally { this.running = false; }
  }

  private async broadcast(batch: BatchRecord) {
    // Persist the broadcast intention before the network call. A crash here remains conservatively unresolved.
    const updated = this.store.noteBroadcast(batch.batchId, this.clock());
    try { await this.gateway.broadcast(updated.transaction); }
    catch {
      this.lastError = { code: 'BROADCAST_UNCERTAIN', message: 'Broadcast outcome is unknown; reconcile before sending new transactions.' };
      this.store.reconcile(batch.batchId, this.lastError, this.clock());
    }
  }

  private async recover(batch: BatchRecord) {
    let receipt;
    try { receipt = await this.gateway.receipt(batch.transaction.txHash); }
    catch {
      this.lastError = { code: 'RECEIPT_UNAVAILABLE', message: 'Receipt lookup failed; sender remains blocked.' };
      this.store.reconcile(batch.batchId, this.lastError, this.clock()); return;
    }
    if (receipt) {
      try { this.store.finish(batch.batchId, receipt, this.clock(), this.options.maxAttempts); }
      catch {
        this.lastError = { code: 'RECEIPT_MISMATCH', message: 'Receipt does not prove the complete batch; manual reconciliation is required.' };
        this.store.reconcile(batch.batchId, this.lastError, this.clock(), receipt);
      }
      return;
    }
    if (batch.broadcastCount >= this.options.maxBroadcasts) {
      this.lastError = { code: 'RECONCILIATION_REQUIRED', message: 'Identical-transaction rebroadcast limit reached. Sender stays blocked until a receipt is found.' };
      this.store.reconcile(batch.batchId, this.lastError, this.clock()); return;
    }
    if (batch.lastBroadcastAt === null || this.clock() - batch.lastBroadcastAt >= this.options.rebroadcastAfterMs)
      await this.broadcast(batch); // Same signed bytes, txHash and sender nonce, including after expiry.
  }
}
