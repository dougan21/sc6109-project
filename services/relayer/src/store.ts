import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SubmissionError, type NormalizedSubmission } from './intent.js';
import type { BatchRecord, ExecutionReceipt, IntentRecord, IntentState, PreparedTransaction, Problem, StateEvent } from './types.js';

type Row = { data: string };
function decode<T>(row: unknown): T | undefined { return row ? JSON.parse((row as Row).data) as T : undefined; }
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
const terminal = new Set<IntentState>(['CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED']);

/** Durable inbox + transaction outbox. One process owns this database (see main's PID lock). */
export class Store {
  private readonly db: DatabaseSync;
  readonly metadata: Record<string, unknown>;

  constructor(path: string, metadata: Record<string, unknown> = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS intents (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL, nonce_key TEXT UNIQUE NOT NULL,
        state TEXT NOT NULL, received_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS intents_queue ON intents(state, received_at);
      CREATE INDEX IF NOT EXISTS intents_run ON intents(run_id, received_at);
      CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES intents(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rejections (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, at INTEGER NOT NULL, code TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    // Binding includes mode, domain and sender: prevent accidental replay after changing environments.
    const identity = stable({ mode: metadata.mode, domain: metadata.domain, relayerAddress: metadata.relayerAddress });
    const prior = this.db.prepare('SELECT data FROM metadata WHERE key=?').get('identity') as Row | undefined;
    if (prior && prior.data !== identity) { this.db.close(); throw new Error('Database belongs to another chain, executor, mode, or relayer. Use a separate database.'); }
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('identity', identity);
    this.metadata = metadata;
  }

  close() { this.db.close(); }
  private atomic<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private writeIntent(record: IntentRecord) {
    this.db.prepare('UPDATE intents SET state=?, data=? WHERE id=?').run(record.state, JSON.stringify(record), record.intentId);
  }
  private event(record: IntentRecord, at: number) {
    const event = { intentId: record.intentId, state: record.state, at, batchId: record.batchId, error: record.error };
    this.db.prepare('INSERT INTO events(intent_id,data) VALUES (?,?)').run(record.intentId, JSON.stringify(event));
  }
  private transition(record: IntentRecord, state: IntentState, at: number, error: Problem | null = null) {
    record.state = state; record.error = error; this.writeIntent(record); this.event(record, at);
  }
  private writeBatch(batch: BatchRecord) {
    this.db.prepare('UPDATE batches SET state=?,data=? WHERE id=?').run(batch.state, JSON.stringify(batch), batch.batchId);
  }

  insertIntent(submission: NormalizedSubmission, now: number): { record: IntentRecord; created: boolean } {
    return this.atomic(() => {
      const existing = this.getIntent(submission.intentId);
      if (existing) return { record: existing, created: false };
      const { owner, agent, epoch, nonce } = submission.intent;
      const key = [owner.toLowerCase(), agent.toLowerCase(), epoch, nonce].join(':');
      if (this.db.prepare('SELECT id FROM intents WHERE nonce_key=?').get(key))
        throw new SubmissionError('NONCE_CONFLICT', 'Nonce is already reserved by a different intent.', 409);
      const count = this.db.prepare("SELECT COUNT(*) AS n FROM intents WHERE state NOT IN ('CONFIRMED','REJECTED','EXPIRED','FAILED')").get() as { n: number };
      if (count.n >= 10_000) throw new SubmissionError('QUEUE_FULL', 'The durable inbox is full. Try again later.', 503);
      const run = this.db.prepare('SELECT data FROM runs WHERE id=?').get(submission.runId) as Row | undefined;
      if (run && stable(JSON.parse(run.data)) !== stable(this.metadata))
        throw new SubmissionError('RUN_CONFIG_CHANGED', 'Use a new runId after changing coordinator configuration.', 409);
      this.db.prepare('INSERT OR IGNORE INTO runs VALUES (?,?)').run(submission.runId, JSON.stringify(this.metadata));
      const record: IntentRecord = { ...submission, state: 'RECEIVED', receivedAt: now, submittedAt: null, confirmedAt: null,
        attemptCount: 0, batchId: null, txHash: null, error: null };
      this.db.prepare('INSERT INTO intents VALUES (?,?,?,?,?,?)').run(record.intentId, record.runId, key, record.state, now, JSON.stringify(record));
      this.event(record, now); this.transition(record, 'VALIDATED', now); this.transition(record, 'QUEUED', now);
      return { record, created: true };
    });
  }

  getIntent(id: string) { return decode<IntentRecord>(this.db.prepare('SELECT data FROM intents WHERE id=?').get(id)); }
  getBatch(id: string) { return decode<BatchRecord>(this.db.prepare('SELECT data FROM batches WHERE id=?').get(id)); }
  listIntents({ runId, limit = 50, offset = 0 }: { runId?: string; limit?: number; offset?: number } = {}) {
    const rows = runId === undefined
      ? this.db.prepare('SELECT data FROM intents ORDER BY received_at,id LIMIT ? OFFSET ?').all(limit, offset)
      : this.db.prepare('SELECT data FROM intents WHERE run_id=? ORDER BY received_at,id LIMIT ? OFFSET ?').all(runId, limit, offset);
    return rows.map(row => decode<IntentRecord>(row)!);
  }
  listBatches({ runId, limit = 50, offset = 0 }: { runId?: string; limit?: number; offset?: number } = {}) {
    const rows = runId === undefined
      ? this.db.prepare('SELECT data FROM batches ORDER BY created_at,id LIMIT ? OFFSET ?').all(limit, offset)
      : this.db.prepare('SELECT data FROM batches WHERE run_id=? ORDER BY created_at,id LIMIT ? OFFSET ?').all(runId, limit, offset);
    return rows.map(row => decode<BatchRecord>(row)!);
  }
  listEvents(id: string): StateEvent[] {
    return this.db.prepare('SELECT id,data FROM events WHERE intent_id=? ORDER BY id').all(id)
      .map(row => ({ ...JSON.parse((row as Row).data), id: Number(row.id) }) as StateEvent);
  }
  recordRejection(body: unknown, runId: string, error: Problem, now: number) {
    // Retain only a canonical fingerprint and a code, never rejected bodies or secrets.
    const id = createHash('sha256').update(runId + ':' + stable(body)).digest('hex');
    this.db.prepare('INSERT OR IGNORE INTO rejections VALUES (?,?,?,?)').run(id, runId, now, error.code);
  }
  queued() {
    return this.db.prepare("SELECT data FROM intents WHERE state='QUEUED' ORDER BY received_at,rowid").all().map(row => decode<IntentRecord>(row)!);
  }
  activeBatch() {
    return decode<BatchRecord>(this.db.prepare("SELECT data FROM batches WHERE state IN ('PREPARED','SUBMITTED','RECONCILING') ORDER BY created_at LIMIT 1").get());
  }
  markTerminal(id: string, state: 'REJECTED' | 'EXPIRED' | 'FAILED', error: Problem, now: number) {
    this.atomic(() => {
      const record = this.getIntent(id);
      if (!record || record.state !== 'QUEUED') throw new Error('Only queued intents may be rejected before broadcast.');
      this.transition(record, state, now, error);
    });
  }
  prepareBatch(records: IntentRecord[], tx: PreparedTransaction, now: number): BatchRecord {
    return this.atomic(() => {
      if (this.activeBatch()) throw new Error('A transaction is already unresolved.');
      if (!records.length || new Set(records.map(i => i.runId)).size !== 1) throw new Error('Batch must belong to one run.');
      const batch: BatchRecord = { batchId: randomUUID(), runId: records[0]!.runId, intentIds: records.map(i => i.intentId), state: 'PREPARED',
        transaction: tx, createdAt: now, submittedAt: null, lastBroadcastAt: null, broadcastCount: 0, resolvedAt: null, receipt: null, error: null };
      this.db.prepare('INSERT INTO batches VALUES (?,?,?,?,?)').run(batch.batchId, batch.runId, batch.state, now, JSON.stringify(batch));
      for (const supplied of records) {
        const record = this.getIntent(supplied.intentId)!;
        if (record.state !== 'QUEUED') throw new Error('Batch contains an unavailable intent.');
        record.batchId = batch.batchId; record.txHash = tx.txHash;
        this.transition(record, 'BATCHED', now);
      }
      return batch;
    });
  }
  noteBroadcast(id: string, now: number) {
    return this.atomic(() => {
      const batch = this.getBatch(id)!;
      const first = batch.broadcastCount === 0;
      batch.broadcastCount++; batch.lastBroadcastAt = now; batch.submittedAt ??= now; batch.state = 'SUBMITTED'; batch.error = null;
      this.writeBatch(batch);
      for (const intentId of batch.intentIds) {
        const record = this.getIntent(intentId)!;
        if (first) record.attemptCount++;
        record.submittedAt ??= now;
        this.transition(record, 'SUBMITTED', now);
      }
      return batch;
    });
  }
  reconcile(id: string, error: Problem, now: number, receipt?: ExecutionReceipt) {
    this.atomic(() => {
      const batch = this.getBatch(id)!;
      const changed = batch.state !== 'RECONCILING' || batch.error?.code !== error.code;
      batch.state = 'RECONCILING'; batch.error = error;
      if (receipt) batch.receipt = receipt;
      this.writeBatch(batch);
      if (changed) for (const intentId of batch.intentIds) this.transition(this.getIntent(intentId)!, 'RECONCILING', now, error);
    });
  }
  finish(id: string, receipt: ExecutionReceipt, now: number, maxAttempts: number) {
    this.atomic(() => {
      const batch = this.getBatch(id)!;
      if (receipt.txHash.toLowerCase() !== batch.transaction.txHash.toLowerCase()) throw new Error('Receipt hash mismatch.');
      if (receipt.success && (receipt.intentIds.length !== batch.intentIds.length
        || new Set(receipt.intentIds.map(i => i.toLowerCase())).size !== batch.intentIds.length
        || batch.intentIds.some(i => !receipt.intentIds.map(x => x.toLowerCase()).includes(i.toLowerCase()))))
        throw new Error('Receipt does not prove every exact intent.');
      batch.receipt = receipt; batch.resolvedAt = now; batch.state = receipt.success ? 'CONFIRMED' : 'REVERTED';
      batch.error = receipt.success ? null : { code: 'TRANSACTION_REVERTED', message: 'The atomic batch reverted.' };
      this.writeBatch(batch);
      for (const intentId of batch.intentIds) {
        const record = this.getIntent(intentId)!;
        if (receipt.success) { record.confirmedAt = now; this.transition(record, 'CONFIRMED', now); }
        else if (BigInt(record.intent.deadline) < BigInt(Math.floor(now / 1000))) this.transition(record, 'EXPIRED', now, batch.error);
        else if (record.attemptCount >= maxAttempts) this.transition(record, 'FAILED', now, { code: 'ATTEMPTS_EXHAUSTED', message: 'Automatic execution attempts are exhausted; the signature is not revoked.' });
        else this.transition(record, 'QUEUED', now, batch.error);
      }
    });
  }

  metrics(runId: string, now: number) {
    const intents = this.listIntents({ runId, limit: -1 });
    const batches = this.listBatches({ runId, limit: -1 });
    const rejected = (this.db.prepare('SELECT COUNT(*) AS n FROM rejections WHERE run_id=?').get(runId) as { n: number }).n;
    const confirmed = intents.filter(i => i.state === 'CONFIRMED');
    const attempted = intents.filter(i => i.attemptCount > 0);
    const failed = attempted.filter(i => i.state === 'FAILED' || i.state === 'EXPIRED' || i.state === 'REJECTED');
    const receipts = batches.filter(b => b.receipt !== null);
    const reverted = receipts.filter(b => !b.receipt!.success);
    const unresolved = intents.filter(i => !terminal.has(i.state)).length;
    const gas = receipts.reduce((sum, b) => sum + BigInt(b.receipt!.gasUsed), 0n);
    const fees = receipts.reduce((sum, b) => sum + BigInt(b.receipt!.gasUsed) * BigInt(b.receipt!.effectiveGasPrice), 0n);
    const earliest = intents.length ? Math.min(...intents.map(i => i.receivedAt)) : null;
    const seconds = earliest === null ? 0 : Math.max(0, now - earliest) / 1000;
    const fraction = (n: number, d: number) => d ? n / d : null;
    const distribution = (values: number[]) => {
      values.sort((a,b) => a-b);
      const percentile = (p: number) => values.length ? values[Math.max(0, Math.ceil(p*values.length)-1)]! : null;
      return { sampleCount: values.length, p50: percentile(.5), p95: percentile(.95) };
    };
    const counts: Record<string, number> = {};
    for (const i of intents) counts[i.state] = (counts[i.state] ?? 0) + 1;
    return {
      runId, mode: this.metadata.mode ?? 'unknown', observedAt: now,
      configuration: decode<Record<string, unknown>>(this.db.prepare('SELECT data FROM runs WHERE id=?').get(runId)) ?? this.metadata,
      window: { from: earliest, to: now, seconds, kind: 'cumulative_since_first_acceptance' },
      accepted: intents.length, apiRejectedUniquePayloads: rejected, states: counts,
      confirmed: confirmed.length, attempted: attempted.length, failedAfterAttempt: failed.length, unfinished: unresolved,
      throughputIntentsPerSecond: fraction(confirmed.length, seconds),
      executionFailureRate: fraction(failed.length, attempted.length), unfinishedRate: fraction(unresolved, intents.length),
      transactionFailureRate: fraction(reverted.length, receipts.length),
      transactions: { distinctBroadcast: batches.filter(b => b.broadcastCount > 0).length, withReceipt: receipts.length, reverted: reverted.length,
        unresolved: batches.filter(b => ['PREPARED','SUBMITTED','RECONCILING'].includes(b.state)).length },
      endToEndLatencyMs: distribution(confirmed.map(i => i.confirmedAt! - i.receivedAt)),
      queueLatencyMs: distribution(attempted.map(i => i.submittedAt! - i.receivedAt)),
      afterFirstBroadcastMs: distribution(confirmed.map(i => i.confirmedAt! - i.submittedAt!)),
      gasUsed: gas.toString(), executionFeesWei: fees.toString(),
      gasPerSuccessfulIntent: confirmed.length ? { numerator: gas.toString(), denominator: confirmed.length } : null,
      notes: ['Mock gas and receipts are simulated, not blockchain measurements.', 'API rejection fingerprints are not unique valid intent IDs; no combined rejection percentage is inferred.',
        'Includes reverted transaction gas; excludes setup/approval costs.', 'Latency samples include successful intents only; queue samples include all attempted intents.',
        'Wall-clock milliseconds; use raw records and controlled windows for formal experiments.'],
    };
  }
}
