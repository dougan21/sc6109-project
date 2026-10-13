import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Occurrence, OccurrenceState, TransferIntent, TransferSchedule } from './types.js';
import { address, IntentRejected, uint256 } from './typed-data.js';

interface OccurrenceRow {
  schedule_id: string;
  occurrence_index: number;
  due_at: number;
  state: OccurrenceState;
  intent_json: string | null;
  signature: string | null;
  intent_id: string | null;
  error: string | null;
}

const TERMINAL = new Set<OccurrenceState>(['CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED', 'SKIPPED']);

function scheduleId(value: string): string {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(value)) {
    throw new IntentRejected('INVALID_SCHEDULE', 'Schedule id must contain 1 to 64 letters, digits, dots, underscores, or hyphens.');
  }
  return value;
}

function positiveInt(value: number, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new IntentRejected('INVALID_SCHEDULE', `${label} is outside the supported range.`);
  }
  return value;
}

export function normalizeSchedule(input: TransferSchedule): TransferSchedule {
  const count = positiveInt(input.count, 'count', 1_000);
  const intervalSec = positiveInt(input.intervalSec, 'intervalSec', 31_536_000);
  const windowSec = positiveInt(input.windowSec, 'windowSec', 31_536_000);
  const amount = uint256(input.amount, 'amount');
  if (amount === '0') throw new IntentRejected('INVALID_AMOUNT', 'Transfer amount must be greater than zero.');
  if (!Number.isSafeInteger(input.startAt) || input.startAt < 0) {
    throw new IntentRejected('INVALID_SCHEDULE', 'startAt must be a nonnegative unix second.');
  }
  const lastDue = input.startAt + (count - 1) * intervalSec;
  if (!Number.isSafeInteger(lastDue) || !Number.isSafeInteger(lastDue + windowSec)) {
    throw new IntentRejected('INVALID_SCHEDULE', 'The schedule extends past the supported time range.');
  }
  return {
    id: scheduleId(input.id),
    owner: address(input.owner, 'owner'),
    token: address(input.token, 'token'),
    recipient: address(input.recipient, 'recipient'),
    amount,
    intervalSec,
    startAt: input.startAt,
    count,
    windowSec,
  };
}

function rowToOccurrence(row: OccurrenceRow): Occurrence {
  return {
    scheduleId: row.schedule_id,
    index: row.occurrence_index,
    dueAt: row.due_at,
    state: row.state,
    intent: row.intent_json ? JSON.parse(row.intent_json) as TransferIntent : null,
    signature: row.signature,
    intentId: row.intent_id,
    error: row.error,
  };
}

/**
 * Durable schedule journal and nonce counter. One process should own a file.
 * A nonce is committed only together with the signature that uses it.
 */
export class AgentJournal {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, spec TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS counters (
        owner TEXT NOT NULL, agent TEXT NOT NULL, epoch TEXT NOT NULL, next_nonce TEXT NOT NULL,
        PRIMARY KEY (owner, agent, epoch));
      CREATE TABLE IF NOT EXISTS occurrences (
        schedule_id TEXT NOT NULL, occurrence_index INTEGER NOT NULL, due_at INTEGER NOT NULL,
        state TEXT NOT NULL, intent_json TEXT, signature TEXT, intent_id TEXT, error TEXT,
        updated_at INTEGER NOT NULL, PRIMARY KEY (schedule_id, occurrence_index));`);
  }

  close(): void { this.db.close(); }

  register(input: TransferSchedule): TransferSchedule {
    const schedule = normalizeSchedule(input);
    const spec = JSON.stringify(schedule);
    const existing = this.db.prepare('SELECT spec FROM schedules WHERE id=?').get(schedule.id) as { spec: string } | undefined;
    if (existing && existing.spec !== spec) {
      throw new IntentRejected('SCHEDULE_CONFLICT', 'This schedule id is already stored with a different specification.');
    }
    this.db.prepare('INSERT OR IGNORE INTO schedules(id, spec) VALUES (?, ?)').run(schedule.id, spec);
    return schedule;
  }

  listSchedules(): TransferSchedule[] {
    const rows = this.db.prepare('SELECT spec FROM schedules ORDER BY id').all() as Array<{ spec: string }>;
    return rows.map((row) => JSON.parse(row.spec) as TransferSchedule);
  }

  getOccurrence(scheduleId: string, index: number): Occurrence | undefined {
    const row = this.db.prepare('SELECT * FROM occurrences WHERE schedule_id=? AND occurrence_index=?').get(scheduleId, index) as OccurrenceRow | undefined;
    return row ? rowToOccurrence(row) : undefined;
  }

  listOccurrences(): Occurrence[] {
    const rows = this.db.prepare('SELECT * FROM occurrences ORDER BY schedule_id, occurrence_index').all() as unknown as OccurrenceRow[];
    return rows.map(rowToOccurrence);
  }

  /**
   * Confirmed amounts, and every not-yet-confirmed signature, for this authorization epoch.
   * Failed and expired signatures stay reserved so a later occurrence cannot exceed the budget.
   */
  spend(owner: string, agent: string, epoch: string): { confirmed: bigint; reserved: bigint } {
    const wantedOwner = address(owner, 'owner');
    const wantedAgent = address(agent, 'agent');
    const wantedEpoch = uint256(epoch, 'epoch');
    let confirmed = 0n;
    let reserved = 0n;
    for (const occurrence of this.listOccurrences()) {
      if (!occurrence.intent || !occurrence.signature) continue;
      if (occurrence.intent.owner !== wantedOwner || occurrence.intent.agent !== wantedAgent || occurrence.intent.epoch !== wantedEpoch) continue;
      const amount = BigInt(occurrence.intent.amount);
      if (occurrence.state === 'CONFIRMED') confirmed += amount;
      else if (occurrence.state !== 'SKIPPED') reserved += amount;
    }
    return { confirmed, reserved };
  }

  markSkipped(scheduleId: string, index: number, dueAt: number, reason: string, at: number): Occurrence {
    return this.insertTerminal(scheduleId, index, dueAt, 'SKIPPED', reason, at);
  }

  /** Persist the signature before any network call. A second call for the same occurrence returns the original. */
  async signNew(args: {
    scheduleId: string;
    index: number;
    dueAt: number;
    owner: string;
    agent: string;
    epoch: string;
    at: number;
    sign: (nonce: string) => Promise<{ intent: TransferIntent; signature: string; intentId: string }>;
  }): Promise<Occurrence> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.getOccurrence(args.scheduleId, args.index);
      if (existing) {
        this.db.exec('COMMIT');
        return existing;
      }
      const owner = address(args.owner, 'owner');
      const agent = address(args.agent, 'agent');
      const epoch = uint256(args.epoch, 'epoch');
      const counter = this.db.prepare('SELECT next_nonce FROM counters WHERE owner=? AND agent=? AND epoch=?').get(owner, agent, epoch) as { next_nonce: string } | undefined;
      const nonce = counter ? uint256(counter.next_nonce, 'nonce') : '0';
      const next = (BigInt(nonce) + 1n).toString();
      const signed = await args.sign(nonce);
      if (signed.intent.nonce !== nonce || signed.intent.owner !== owner || signed.intent.agent !== agent || signed.intent.epoch !== epoch) {
        throw new IntentRejected('SIGNER_MISMATCH', 'The signature does not match the reserved nonce and authorization.');
      }
      if (counter) this.db.prepare('UPDATE counters SET next_nonce=? WHERE owner=? AND agent=? AND epoch=?').run(next, owner, agent, epoch);
      else this.db.prepare('INSERT INTO counters(owner, agent, epoch, next_nonce) VALUES (?, ?, ?, ?)').run(owner, agent, epoch, next);
      this.db.prepare(`INSERT INTO occurrences(schedule_id, occurrence_index, due_at, state, intent_json, signature, intent_id, error, updated_at)
        VALUES (?, ?, ?, 'SIGNED', ?, ?, ?, NULL, ?)`).run(
        args.scheduleId, args.index, args.dueAt, JSON.stringify(signed.intent), signed.signature, signed.intentId.toLowerCase(), args.at,
      );
      this.db.exec('COMMIT');
      const created = this.getOccurrence(args.scheduleId, args.index);
      if (!created) throw new Error('The signed occurrence was not stored.');
      return created;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  setState(scheduleId: string, index: number, state: OccurrenceState, at: number, error: string | null = null): Occurrence {
    const current = this.getOccurrence(scheduleId, index);
    if (!current) throw new IntentRejected('UNKNOWN_OCCURRENCE', 'That schedule occurrence does not exist.');
    if (TERMINAL.has(current.state) && current.state !== state) return current;
    this.db.prepare('UPDATE occurrences SET state=?, error=?, updated_at=? WHERE schedule_id=? AND occurrence_index=?').run(state, error, at, scheduleId, index);
    const updated = this.getOccurrence(scheduleId, index);
    if (!updated) throw new Error('The occurrence disappeared during update.');
    return updated;
  }

  private insertTerminal(scheduleId: string, index: number, dueAt: number, state: OccurrenceState, reason: string, at: number): Occurrence {
    const existing = this.getOccurrence(scheduleId, index);
    if (existing) return existing;
    this.db.prepare(`INSERT INTO occurrences(schedule_id, occurrence_index, due_at, state, intent_json, signature, intent_id, error, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`).run(scheduleId, index, dueAt, state, reason, at);
    const created = this.getOccurrence(scheduleId, index);
    if (!created) throw new Error('The occurrence was not stored.');
    return created;
  }
}
